/**
 * The app-side sync engine: drives core's backfill/incremental generators against the
 * real RPC and storage adapters.
 *
 * Core's driver (ingest/backfill.ts, D8) owns WHAT to fetch and when to checkpoint;
 * this engine owns everything core is forbidden to know: wall-clock sleeps, endpoint
 * rotation (D9), transaction hydration, and persistence. The division of labor per
 * page is:
 *
 *   driver yields page ->
 *     engine hydrates it   (getTransactions; partial returns are contractual, the
 *                           shortfall is retried via missingSignatures)
 *     engine normalizes    (normalizeTransactions -- core, pure)
 *     engine persists      (putChainEvents -- BEFORE pulling the next item)
 *     engine sleeps        (the driver's requested pauseMs)
 *   engine pulls next   -> driver writes the checkpoint, fetches the next page
 *
 * THE DURABILITY HANDSHAKE (D8, amended): the driver persists a page's checkpoint
 * only when the consumer pulls the item AFTER that page. So this engine must not pull
 * until the page's events are stored -- and when a page cannot be fully persisted
 * (hydration exhausted its retries, an endpoint died), the engine must abandon the
 * generator WITHOUT pulling. The checkpoint then still points at the previous page;
 * the next run re-fetches this one, dedup absorbs replayed events, and
 * missingSignatures keeps the replay from re-buying transactions already stored.
 * Replay is recoverable; a checkpoint past unstored data is a permanent hole.
 *
 * ENDPOINT ROTATION (D9): endpoints are an ordered failover list, not peers. One
 * cursor covers both paging and hydration -- when either exhausts an endpoint
 * (failover-needed from the driver, maxConsecutiveRateLimits during hydration, or a
 * transport error), the engine restarts the generator on the next endpoint; the
 * checkpoint in storage makes that restart seamless. When the list runs out the run
 * ends 'endpoints-exhausted' -- the caller retries on the next app-open/poll, and the
 * error copy's first remedy is a user-supplied RPC URL (PROJECT.md line 72).
 *
 * Failed transactions (err != null) are hydrated like any other: they are chain facts,
 * the normalizer marks their events succeeded:false, and matching/projection already
 * know to ignore them. Skipping them would save quota but make the event store lie by
 * omission.
 *
 * No React and no native modules in this file: the whole engine runs under vitest in
 * a plain Node process against fakes (test/engine.test.ts).
 */
import type {
  Address,
  BackfillOptions,
  BackfillProgress,
  ClockPort,
  RpcPort,
  SignatureInfo,
  StoragePort,
} from '@local-books/core';
import {
  DEFAULT_BACKFILL_OPTIONS,
  RateLimitedError,
  backfillAddress,
  backoffMs,
  missingSignatures,
  normalizeTransactions,
  syncNewSignatures,
} from '@local-books/core';
import { RpcHttpError, RpcResponseError } from '../adapters/rpc.js';

export interface SyncTotals {
  /** Signature pages consumed this run (across endpoint rotations). */
  pages: number;
  /** Signatures seen in those pages. */
  signaturesSeen: number;
  /** Full transactions fetched (hydration round-trips that returned). */
  transactionsFetched: number;
  /** ChainEvents handed to putChainEvents. Counts normalized, not deduped-new. */
  eventsStored: number;
}

export type SyncPhase = 'paging' | 'hydrating' | 'backoff';

export interface SyncProgress extends Readonly<SyncTotals> {
  readonly address: Address;
  readonly endpointLabel: string;
  /** 'backfill' walks history; 'incremental' checks for new payments since. */
  readonly mode: 'backfill' | 'incremental';
  readonly phase: SyncPhase;
  /** Hydration progress within the current page, when phase is 'hydrating'. */
  readonly pageHydration?: { readonly fetched: number; readonly total: number };
  /** How long the engine is about to sleep, when phase is 'backoff'. */
  readonly backoffMs?: number;
}

export type SyncResult =
  | { readonly kind: 'complete'; readonly totals: SyncTotals }
  | { readonly kind: 'page-budget-reached'; readonly totals: SyncTotals }
  | { readonly kind: 'cancelled'; readonly totals: SyncTotals }
  | {
      readonly kind: 'endpoints-exhausted';
      readonly totals: SyncTotals;
      /** Why the LAST endpoint was abandoned; earlier failures looked the same. */
      readonly lastError: unknown;
    };

export interface SyncDeps {
  /** Ordered failover list (D9): user RPC first when set, then the defaults. */
  readonly endpoints: readonly RpcPort[];
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly onProgress?: (progress: SyncProgress) => void;
  /** Cooperative cancellation. Checked between chunks, pages, and sleeps. */
  readonly signal?: AbortSignal;
  /** Injected for tests. Must RESOLVE (not reject) early when signal aborts. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface SyncEngineOptions {
  readonly backfill?: BackfillOptions;
  /**
   * Signatures per getTransactions call. Not an RPC batch (D9 forbids those; the
   * adapter is sequential inside) -- chunking exists so progress is reported and
   * cancellation is honored every few seconds instead of once per 1000-signature
   * page, which at publicnode's measured ~5 tx/s would be a ~3-minute blind spot.
   */
  readonly hydrationChunkSize?: number;
}

const DEFAULT_HYDRATION_CHUNK = 25;

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/**
 * Errors that indict the ENDPOINT, not our own code: rotating to the next endpoint
 * is a sensible response. Anything else (storage corruption, a programming error)
 * must propagate -- retrying it against a different RPC server would only bury it.
 */
function isTransportError(error: unknown): boolean {
  if (error instanceof RateLimitedError) return true;
  if (error instanceof RpcHttpError) return true;
  if (error instanceof RpcResponseError) return true;
  // fetch network failures are TypeError -- but so is every 'cannot read property of
  // undefined' programming bug on Hermes, and rotating endpoints over one of those
  // would bury it. Only the known network messages qualify: RN's 'Network request
  // failed', undici's 'fetch failed', browsers' 'Failed to fetch'.
  if (error instanceof TypeError && /network|fetch/i.test(error.message)) return true;
  // The adapter's request timeout (AbortError; TimeoutError from AbortSignal.timeout).
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }
  return false;
}

/**
 * Run one sync pass for one address: continue the initial backfill if history is not
 * fully walked yet, otherwise check for new signatures since the stored watermark.
 *
 * One driver-run per call, by design: 'page-budget-reached' returns to the caller,
 * who decides whether to immediately go again (foreground initial sync does) or to
 * stop (a background task at its time budget does). The checkpoint makes either safe.
 */
export async function syncAddress(
  address: Address,
  deps: SyncDeps,
  options: SyncEngineOptions = {},
): Promise<SyncResult> {
  const opts = options.backfill ?? DEFAULT_BACKFILL_OPTIONS;
  const chunkSize = options.hydrationChunkSize ?? DEFAULT_HYDRATION_CHUNK;
  const sleep = deps.sleep ?? defaultSleep;
  const { storage, clock, signal } = deps;

  const totals: SyncTotals = { pages: 0, signaturesSeen: 0, transactionsFetched: 0, eventsStored: 0 };
  let lastError: unknown;

  const cancelled = (): SyncResult => ({ kind: 'cancelled', totals });
  // A function, not an inline check: `aborted` flips DURING awaits, and an inline
  // property access would let control-flow narrowing "prove" later checks dead.
  const aborted = (): boolean => signal?.aborted === true;

  for (const rpc of deps.endpoints) {
    if (aborted()) return cancelled();

    // Recomputed per endpoint: a rotation mid-backfill must resume the backfill, and
    // a checkpoint completed on a previous endpoint means incremental from here on.
    const checkpoint = await storage.getCheckpoint(address);
    const mode: 'backfill' | 'incremental' = checkpoint?.complete === true ? 'incremental' : 'backfill';
    const generator =
      mode === 'incremental'
        ? syncNewSignatures(address, { rpc, storage, clock }, opts)
        : backfillAddress(address, { rpc, storage, clock }, opts);

    const report = (
      phase: SyncPhase,
      extra?: { pageHydration?: { fetched: number; total: number }; backoffMs?: number },
    ): void => {
      deps.onProgress?.({
        address,
        endpointLabel: rpc.endpointLabel,
        mode,
        phase,
        ...totals,
        ...(extra?.pageHydration ? { pageHydration: extra.pageHydration } : {}),
        ...(extra?.backoffMs !== undefined ? { backoffMs: extra.backoffMs } : {}),
      });
    };

    /**
     * Hydrate and persist one page. 'ok' means every signature of the page has its
     * transaction stored (or was already stored) and the caller may pull the next
     * generator item -- which is what durably advances the checkpoint.
     */
    const hydratePage = async (pageSignatures: readonly SignatureInfo[]): Promise<'ok' | 'rotate' | 'cancelled'> => {
      const signatures = pageSignatures.map((s) => s.signature);
      // A replayed page (crash, rotation, budget-resume) re-buys nothing: whatever
      // already produced stored events is skipped. Transactions that normalized to
      // zero events are re-fetched on replay -- the cheap, correct direction.
      const known = await storage.getChainEvents(address);
      let missing = missingSignatures(signatures, known);
      const pageTotal = missing.length;
      let fetchedThisPage = 0;
      let zeroProgressHits = 0;

      report('hydrating', { pageHydration: { fetched: 0, total: pageTotal } });

      while (missing.length > 0) {
        if (aborted()) return 'cancelled';
        const chunk = missing.slice(0, chunkSize);

        let fetched;
        try {
          fetched = await rpc.getTransactions(chunk);
        } catch (error) {
          if (aborted()) return 'cancelled';
          if (error instanceof RateLimitedError) {
            zeroProgressHits += 1;
            if (zeroProgressHits >= opts.maxConsecutiveRateLimits) {
              lastError = error;
              return 'rotate';
            }
            const waitMs = backoffMs(zeroProgressHits, opts, error.retryAfterMs);
            report('backoff', { backoffMs: waitMs });
            await sleep(waitMs, signal);
            continue;
          }
          if (isTransportError(error)) {
            lastError = error;
            return 'rotate';
          }
          throw error;
        }

        if (fetched.length === 0) {
          // Either the endpoint knows NONE of these transactions (the adapter omits
          // null results by contract -- a lagging node, retention limits) or the
          // adapter is broken. Both mean this endpoint cannot finish the page, and
          // looping on it would hang sync forever: rotate, and let the next
          // endpoint -- or the next run -- try again. The page stays
          // un-checkpointed, so nothing is lost.
          lastError = new Error(`${rpc.endpointLabel}: getTransactions returned nothing for ${chunk.length} signatures`);
          return 'rotate';
        }
        zeroProgressHits = 0;

        // Persist THIS chunk before anything else -- partial progress survives a
        // kill or a rotation, and is what makes the retry-the-shortfall loop cheap.
        const events = normalizeTransactions(fetched, address);
        await storage.putChainEvents(events);
        totals.transactionsFetched += fetched.length;
        totals.eventsStored += events.length;
        fetchedThisPage += fetched.length;

        const got = new Set(fetched.map((tx) => tx.signature));
        missing = missing.filter((s) => !got.has(s));
        report('hydrating', { pageHydration: { fetched: fetchedThisPage, total: pageTotal } });

        // Fewer than asked = the adapter either hit throttling mid-chunk and
        // preserved progress, or omitted transactions this node does not serve
        // (null results) -- its contract documents both. Breathe before retrying
        // the shortfall; if the remainder keeps coming back empty, the zero-return
        // guard above rotates.
        if (fetched.length < chunk.length) {
          const waitMs = backoffMs(1, opts);
          report('backoff', { backoffMs: waitMs });
          await sleep(waitMs, signal);
        }
      }
      return 'ok';
    };

    // Manual pulls, not for-await: WHEN .next() is called is the durability
    // handshake, and it must be impossible to pull by falling through a loop.
    try {
      pulls: while (true) {
        if (aborted()) return cancelled();

        let item: IteratorResult<BackfillProgress, void>;
        try {
          report('paging');
          item = await generator.next();
        } catch (error) {
          if (aborted()) return cancelled();
          if (isTransportError(error)) {
            // Includes RateLimitedError thrown by the incremental generator, which
            // (unlike backfill) does not absorb 429s itself. Rotation is the blunt
            // but safe answer; the next run starts back at the primary endpoint.
            lastError = error;
            break pulls;
          }
          throw error;
        }
        if (item.done === true) {
          // The driver returned without a terminal yield -- not reachable today
          // (every return is preceded by a yield). Defensive: treat as this
          // endpoint being done with nothing more to give.
          break pulls;
        }

        const progress = item.value;
        switch (progress.kind) {
          case 'page': {
            totals.pages += 1;
            totals.signaturesSeen += progress.signatures.length;
            const hydrated = await hydratePage(progress.signatures);
            if (hydrated === 'cancelled') return cancelled();
            if (hydrated === 'rotate') {
              break pulls; // WITHOUT pulling: the page stays un-checkpointed.
            }
            if (progress.pauseMs > 0) await sleep(progress.pauseMs, signal);
            continue; // The pull at the top of the loop advances the checkpoint.
          }
          case 'rate-limited': {
            report('backoff', { backoffMs: progress.pauseMs });
            await sleep(progress.pauseMs, signal);
            continue; // Retry the same cursor.
          }
          case 'failover-needed': {
            lastError = new RateLimitedError(progress.endpointLabel);
            break pulls;
          }
          case 'done': {
            return {
              kind: progress.reason === 'page-budget-reached' ? 'page-budget-reached' : 'complete',
              totals,
            };
          }
        }
      }
    } finally {
      // Release the generator on every exit path (rotation, cancellation, 'done',
      // a thrown error) WITHOUT executing its checkpoint write: injected return
      // runs no driver code after the yield point (the driver has no finally
      // blocks), so this can never advance the cursor. Rotation depends on that.
      await generator.return().then(
        () => undefined,
        () => undefined,
      );
    }
  }

  if (aborted()) return cancelled();
  return { kind: 'endpoints-exhausted', totals, lastError };
}
