/**
 * Resumable, checkpointed signature backfill.
 *
 * The riskiest component in v0.1 (PROJECT.md line 130) and the one everything else
 * sits on. Three constraints shape the design:
 *
 *   1. Public RPC rate-limits per IP, so pacing and failover are core concerns rather
 *      than adapter details.
 *   2. Android will kill the app mid-sync, so progress must be durable *between pages*
 *      -- not at the end of the run (line 71).
 *   3. Mobile connections are metered and flaky, so the driver yields control between
 *      pages instead of running to completion in one blocking call.
 *
 * The driver is a generator: it yields after every checkpointed page, letting the UI
 * render progress, letting a background task stop at a time budget, and making the
 * "kill it mid-sync" test trivial to write -- the test just stops pulling.
 *
 * Pure: no timers, no network, no clock. Delay is *requested* via the yielded value and
 * performed by the caller, so tests advance instantly and Spike 1 can measure real
 * pacing without core knowing what a millisecond is.
 */
import type {
  BackfillCheckpoint,
  RpcPort,
  SignatureInfo,
  StoragePort,
  ClockPort,
} from '../ports/index.js';
import { RateLimitedError } from '../ports/index.js';
import type { Address, Signature } from '../types/index.js';

export interface BackfillOptions {
  /** Signatures per page. 1000 is the RPC maximum and the fewest round-trips. */
  readonly pageSize: number;
  /** Stop after this many pages in one run; resume later. Guards battery and quota. */
  readonly maxPagesPerRun: number;
  /** Base pause between pages, in ms. Backoff multiplies this. */
  readonly basePaceMs: number;
  /** Ceiling for exponential backoff, in ms. */
  readonly maxBackoffMs: number;
  /** Consecutive rate-limit hits before giving up and asking for failover. */
  readonly maxConsecutiveRateLimits: number;
}

export const DEFAULT_BACKFILL_OPTIONS: BackfillOptions = {
  pageSize: 1000,
  maxPagesPerRun: 50,
  basePaceMs: 250,
  maxBackoffMs: 30_000,
  maxConsecutiveRateLimits: 5,
};

export type BackfillProgress =
  | {
      readonly kind: 'page';
      readonly signatures: readonly SignatureInfo[];
      readonly checkpoint: BackfillCheckpoint;
      /** Caller should wait this long before resuming. Zero means proceed. */
      readonly pauseMs: number;
      readonly pagesFetched: number;
    }
  | {
      readonly kind: 'rate-limited';
      readonly checkpoint: BackfillCheckpoint;
      readonly pauseMs: number;
      readonly consecutiveHits: number;
      readonly endpointLabel: string;
    }
  | {
      readonly kind: 'done';
      readonly checkpoint: BackfillCheckpoint;
      readonly reason: 'history-exhausted' | 'page-budget-reached' | 'caught-up';
    }
  | {
      readonly kind: 'failover-needed';
      readonly checkpoint: BackfillCheckpoint;
      readonly endpointLabel: string;
    };

/**
 * Walk an address's history backwards, checkpointing after every page.
 *
 * Resume is exactly-once at page granularity: the checkpoint is persisted *after* the
 * page's signatures are handed to the caller but the cursor only advances past
 * signatures actually yielded. A crash mid-page re-fetches that page, and dedup by
 * (signature, instructionIndex) downstream makes the replay harmless. Re-fetching one
 * page beats the alternative -- advancing the cursor first and losing a page for good.
 */
export async function* backfillAddress(
  address: Address,
  deps: { readonly rpc: RpcPort; readonly storage: StoragePort; readonly clock: ClockPort },
  options: BackfillOptions = DEFAULT_BACKFILL_OPTIONS,
): AsyncGenerator<BackfillProgress, void, undefined> {
  const { rpc, storage, clock } = deps;

  const existing = await storage.getCheckpoint(address);
  let checkpoint: BackfillCheckpoint = existing ?? {
    address,
    oldestSeen: null,
    newestSeen: null,
    complete: false,
    updatedAt: clock.now(),
  };

  if (checkpoint.complete) {
    yield { kind: 'done', checkpoint, reason: 'caught-up' };
    return;
  }

  let pagesFetched = 0;
  let consecutiveRateLimits = 0;

  while (pagesFetched < options.maxPagesPerRun) {
    let page;
    try {
      page = await rpc.getSignatures(address, {
        ...(checkpoint.oldestSeen ? { before: checkpoint.oldestSeen } : {}),
        limit: options.pageSize,
      });
      consecutiveRateLimits = 0;
    } catch (err) {
      if (!(err instanceof RateLimitedError)) throw err;

      consecutiveRateLimits += 1;
      if (consecutiveRateLimits >= options.maxConsecutiveRateLimits) {
        // Endpoint is not going to serve us. Hand back to the caller to rotate
        // endpoints (PROJECT.md line 72) rather than burning battery on backoff.
        yield { kind: 'failover-needed', checkpoint, endpointLabel: rpc.endpointLabel };
        return;
      }

      yield {
        kind: 'rate-limited',
        checkpoint,
        pauseMs: backoffMs(consecutiveRateLimits, options, err.retryAfterMs),
        consecutiveHits: consecutiveRateLimits,
        endpointLabel: rpc.endpointLabel,
      };
      continue; // Retry the same cursor; no progress was made.
    }

    pagesFetched += 1;

    // An empty page means history is exhausted. Mark complete so a later run does not
    // re-walk from the tip: initial backfill is a once-per-address cost.
    if (page.signatures.length === 0) {
      checkpoint = { ...checkpoint, complete: true, updatedAt: clock.now() };
      await storage.putCheckpoint(checkpoint);
      yield { kind: 'done', checkpoint, reason: 'history-exhausted' };
      return;
    }

    // `newestSeen` is only ever set from the very first page of the very first run --
    // that is the tip at the moment we started, and it is where future incremental
    // syncs stop.
    const newestSeen = checkpoint.newestSeen ?? page.signatures[0]!.signature;

    checkpoint = {
      ...checkpoint,
      newestSeen,
      oldestSeen: page.nextBefore,
      complete: page.nextBefore === null,
      updatedAt: clock.now(),
    };
    await storage.putCheckpoint(checkpoint);

    yield {
      kind: 'page',
      signatures: page.signatures,
      checkpoint,
      pauseMs: options.basePaceMs,
      pagesFetched,
    };

    if (checkpoint.complete) {
      yield { kind: 'done', checkpoint, reason: 'history-exhausted' };
      return;
    }
  }

  yield { kind: 'done', checkpoint, reason: 'page-budget-reached' };
}

/**
 * Exponential backoff with the server's advice taking precedence.
 *
 * No jitter: this is a single-device app talking to a public endpoint, so there is no
 * thundering herd of our own making to spread out. Spike 1 revisits this if measured
 * 429 behaviour suggests otherwise.
 */
export function backoffMs(
  attempt: number,
  options: BackfillOptions,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, options.maxBackoffMs);
  const exponential = options.basePaceMs * 2 ** attempt;
  return Math.min(exponential, options.maxBackoffMs);
}

/**
 * Incremental sync: fetch only what landed since `newestSeen`.
 *
 * Solana has no "after" cursor, so we page from the tip and stop at the known
 * watermark. Cheap in the common case (one short page) and correct if the app was shut
 * for a month.
 */
export async function* syncNewSignatures(
  address: Address,
  deps: { readonly rpc: RpcPort; readonly storage: StoragePort; readonly clock: ClockPort },
  options: BackfillOptions = DEFAULT_BACKFILL_OPTIONS,
): AsyncGenerator<BackfillProgress, void, undefined> {
  const { rpc, storage, clock } = deps;
  const checkpoint = await storage.getCheckpoint(address);

  // Nothing ingested yet: incremental sync is meaningless, run a backfill instead.
  if (!checkpoint?.newestSeen) {
    yield* backfillAddress(address, deps, options);
    return;
  }

  const watermark = checkpoint.newestSeen;
  let before: Signature | undefined;
  let pagesFetched = 0;
  let newestThisRun: Signature | null = null;

  while (pagesFetched < options.maxPagesPerRun) {
    const page = await rpc.getSignatures(address, {
      ...(before ? { before } : {}),
      limit: options.pageSize,
    });
    pagesFetched += 1;

    if (page.signatures.length === 0) break;
    newestThisRun ??= page.signatures[0]!.signature;

    const hitIndex = page.signatures.findIndex((s) => s.signature === watermark);
    const fresh = hitIndex === -1 ? page.signatures : page.signatures.slice(0, hitIndex);

    if (fresh.length > 0) {
      yield {
        kind: 'page',
        signatures: fresh,
        checkpoint,
        pauseMs: options.basePaceMs,
        pagesFetched,
      };
    }

    if (hitIndex !== -1 || page.nextBefore === null) break;
    before = page.nextBefore;
  }

  const updated: BackfillCheckpoint = {
    ...checkpoint,
    newestSeen: newestThisRun ?? checkpoint.newestSeen,
    updatedAt: clock.now(),
  };
  await storage.putCheckpoint(updated);
  yield { kind: 'done', checkpoint: updated, reason: 'caught-up' };
}
