/**
 * RpcPort over plain JSON-RPC fetch (T9).
 *
 * Not web3.js -- see DECISIONS.md D11: watch-only needs exactly two RPC methods, the
 * S1 harness already proved this adapter shape against live mainnet, and skipping
 * web3.js keeps the Buffer/crypto polyfill swamp out of the app entirely.
 *
 * Contract highlights (ports/index.ts):
 *   - 429s surface as RateLimitedError with the server's Retry-After when present;
 *     the core backfill driver owns pacing and failover (D8/D9), never this adapter.
 *   - getTransactions fetches SEQUENTIALLY, one request per signature. No JSON-RPC
 *     batch arrays: publicnode rejects them outright and mainnet-beta rate-limits
 *     them above ~10 (S1, D9).
 *   - Every request carries a timeout. S1's airplane-mode caveat is exactly this: a
 *     dropped mobile connection must produce a thrown request, not a hung sync.
 */
import type {
  Address,
  RawTransaction,
  RpcPort,
  Signature,
  SignaturePage,
  UnixSeconds,
} from '@local-books/core';
import { RateLimitedError } from '@local-books/core';

export interface JsonRpcAdapterOptions {
  /** Abort a single request after this long. Generous: mobile radios wake slowly. */
  readonly requestTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Endpoint order is a D9 decision, not a preference: publicnode primary,
 * mainnet-beta failover. A user-supplied URL (PROJECT.md line 72) goes FIRST --
 * someone who pasted their own Helius key chose to be on it.
 */
export function mainnetEndpoints(userRpcUrl?: string): readonly JsonRpcAdapter[] {
  const defaults = [
    new JsonRpcAdapter('https://solana-rpc.publicnode.com', 'publicnode'),
    new JsonRpcAdapter('https://api.mainnet-beta.solana.com', 'mainnet-beta'),
  ];
  return userRpcUrl ? [new JsonRpcAdapter(userRpcUrl, 'user-rpc'), ...defaults] : defaults;
}

export function devnetEndpoints(): readonly JsonRpcAdapter[] {
  return [new JsonRpcAdapter('https://api.devnet.solana.com', 'devnet')];
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
}

export class RpcHttpError extends Error {
  constructor(
    readonly endpointLabel: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${endpointLabel}: HTTP ${status} ${detail}`);
    this.name = 'RpcHttpError';
  }
}

export class RpcResponseError extends Error {
  constructor(
    readonly endpointLabel: string,
    readonly code: number,
    message: string,
  ) {
    super(`${endpointLabel}: RPC ${code}: ${message}`);
    this.name = 'RpcResponseError';
  }
}

export class JsonRpcAdapter implements RpcPort {
  constructor(
    private readonly url: string,
    readonly endpointLabel: string,
    private readonly options: JsonRpcAdapterOptions = {},
  ) {}

  async getSignatures(
    address: Address,
    opts: { readonly before?: Signature; readonly limit: number },
  ): Promise<SignaturePage> {
    const result = (await this.call('getSignaturesForAddress', [
      address,
      {
        limit: opts.limit,
        commitment: 'confirmed',
        ...(opts.before ? { before: opts.before } : {}),
      },
    ])) as ReadonlyArray<{
      signature: string;
      slot: number;
      blockTime: number | null;
      err: unknown;
    }>;

    if (!Array.isArray(result)) {
      // A misconfigured proxy or an arbitrary user-pasted endpoint can answer with
      // null or an object. Label the error so the settings-screen copy can say "your
      // endpoint is the problem" instead of surfacing an anonymous TypeError.
      throw new RpcResponseError(
        this.endpointLabel,
        0,
        `malformed getSignaturesForAddress result: ${result === null ? 'null' : typeof result}`,
      );
    }

    return {
      signatures: result.map((s) => ({
        signature: s.signature as Signature,
        slot: s.slot,
        blockTime: (s.blockTime ?? null) as UnixSeconds | null,
        err: s.err !== null && s.err !== undefined,
      })),
      // Cursor on the last signature of every NON-EMPTY page, even a short one. The
      // wire protocol does not guarantee full pages while older history exists (nodes
      // stitch recent ledger + long-term storage, and user-pasted endpoints promise
      // nothing) -- inferring exhaustion from page size would let one short page mark
      // the checkpoint complete:true forever and silently drop older income. End of
      // history is signalled only by an empty page, which the driver already handles;
      // the cost is one extra round-trip per full backfill.
      nextBefore:
        result.length === 0 ? null : (result[result.length - 1]!.signature as Signature),
    };
  }

  /**
   * Sequential by design (D9): batch arrays are not portable across the two endpoints
   * we actually have, and concurrency is what triggers mainnet-beta's throttling.
   *
   * Progress-preserving: an error mid-sequence returns the transactions fetched SO
   * FAR rather than discarding them -- the hydration pipeline detects the shortfall
   * with `missingSignatures` and retries the remainder later. Without this, a page of
   * 1000 signatures could never complete on an endpoint that 429s every ~10 calls
   * (S1's measured mainnet-beta behaviour): every retry would start from zero, a
   * deterministic livelock. Throttling still surfaces where it matters -- an error
   * with ZERO progress throws, so a caller that is getting nothing sees why.
   */
  async getTransactions(signatures: readonly Signature[]): Promise<readonly RawTransaction[]> {
    const out: RawTransaction[] = [];
    for (const signature of signatures) {
      let raw: { slot?: number; blockTime?: number | null } | null;
      try {
        raw = (await this.call('getTransaction', [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ])) as { slot?: number; blockTime?: number | null } | null;
      } catch (error) {
        if (out.length > 0) return out;
        throw error;
      }
      out.push({
        signature,
        slot: raw?.slot ?? 0,
        blockTime: (raw?.blockTime ?? null) as UnixSeconds | null,
        raw,
      });
    }
    return out;
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // The timer must cover the BODY reads, not just the headers: under streaming
    // fetch (undici, expo/fetch) `fetch` resolves at headers, and a connection that
    // dies mid-body would otherwise hang response.json() forever -- the exact
    // hung-sync failure this timeout exists to prevent (D11, S1 caveat).
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new RateLimitedError(
          this.endpointLabel,
          parseRetryAfterMs(response.headers.get('retry-after')),
        );
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new RpcHttpError(this.endpointLabel, response.status, detail);
      }

      const json = (await response.json()) as { result?: unknown; error?: JsonRpcError };
      if (json.error) {
        // Some providers signal throttling inside a 200 JSON-RPC error instead of an
        // HTTP 429 (OnFinality does exactly this -- observed in S1's endpoint probe).
        if (json.error.code === 429 || /rate.?limit|too many/i.test(json.error.message ?? '')) {
          throw new RateLimitedError(this.endpointLabel);
        }
        throw new RpcResponseError(this.endpointLabel, json.error.code, json.error.message);
      }
      return json.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Retry-After -> milliseconds. RFC 9110 allows delta-seconds OR an HTTP-date, and
 * CDN-fronted endpoints (Cloudflare in front of a user's paid RPC) really do send the
 * date form; some proxies emit fractional seconds. Dropping those would make the
 * driver fall back to exponential backoff and burn its failover budget against the
 * user's own best endpoint. Unparseable values return undefined -- the driver's
 * backoff handles it.
 */
export function parseRetryAfterMs(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}
