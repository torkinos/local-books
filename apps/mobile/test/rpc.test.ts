/**
 * T9 adapter tests. The fetch layer is stubbed; what is under test is the contract
 * the core driver depends on: page/cursor mapping, 429 -> RateLimitedError with the
 * server's advice, sequential (never batched) transaction fetches per D9, and a
 * timeout so a dead mobile connection throws instead of hanging sync forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError } from '@local-books/core';
import type { Address, Signature } from '@local-books/core';
import {
  JsonRpcAdapter,
  RpcHttpError,
  RpcResponseError,
  mainnetEndpoints,
  parseRetryAfterMs,
} from '../src/adapters/rpc.js';

const ADDRESS = 'SomeAddress11111111111111111111111111111111' as Address;
const sig = (n: number): Signature => `sig-${n}` as Signature;

interface CapturedCall {
  url: string;
  body: unknown;
}

function stubFetch(
  responder: (body: Record<string, unknown>, call: number) => Response,
): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, body });
    return responder(body, calls.length);
  });
  return calls;
}

const ok = (result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });

const wireSig = (n: number, blockTime: number | null = 1_700_000_000, err: unknown = null) => ({
  signature: `sig-${n}`,
  slot: n,
  blockTime,
  err,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JsonRpcAdapter.getSignatures', () => {
  it('maps a full page and cursors on its last signature', async () => {
    stubFetch(() => ok([wireSig(1), wireSig(2), wireSig(3)]));
    const page = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      limit: 3,
    });

    expect(page.signatures).toHaveLength(3);
    expect(page.signatures[0]).toEqual({
      signature: sig(1),
      slot: 1,
      blockTime: 1_700_000_000,
      err: false,
    });
    expect(page.nextBefore).toBe(sig(3));
  });

  it('a SHORT page still cursors -- only an EMPTY page signals end of history', async () => {
    // Nodes stitch recent ledger + long-term storage and can return short pages
    // mid-history; inferring exhaustion from page size would mark the checkpoint
    // complete forever and silently drop older income.
    stubFetch(() => ok([wireSig(1)]));
    const short = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      limit: 1000,
    });
    expect(short.nextBefore).toBe(sig(1));

    stubFetch(() => ok([]));
    const empty = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      limit: 1000,
    });
    expect(empty.nextBefore).toBeNull();
    expect(empty.signatures).toHaveLength(0);
  });

  it('labels a malformed result (null / non-array) instead of an anonymous TypeError', async () => {
    stubFetch(() => ok(null));
    const error = await new JsonRpcAdapter('https://user.pasted.example', 'user-rpc')
      .getSignatures(ADDRESS, { limit: 10 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcResponseError);
    expect((error as RpcResponseError).endpointLabel).toBe('user-rpc');
  });

  it('passes the before cursor, limit, and confirmed commitment on the wire', async () => {
    const calls = stubFetch((body) =>
      (body as { method?: string }).method === 'getSignatureStatuses'
        ? ok({ value: [{ slot: 9 }] })
        : ok([]),
    );
    await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      before: sig(9),
      limit: 500,
    });

    expect(calls[0]!.body).toMatchObject({
      method: 'getSignaturesForAddress',
      params: [ADDRESS, { before: 'sig-9', limit: 500, commitment: 'confirmed' }],
    });
  });

  it('trusts an empty page mid-backfill only if the cursor is known AND the empty page reproduces', async () => {
    // An empty page durably ends the backfill (the driver writes complete:true), so
    // "no more history" from a node that merely cannot SEE the cursor -- a lagging
    // balancer sibling, a user RPC with short retention -- must throw instead.
    const calls = stubFetch((body) =>
      (body as { method?: string }).method === 'getSignatureStatuses'
        ? ok({ value: [{ slot: 9, confirmationStatus: 'finalized' }] })
        : ok([]),
    );
    const page = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      before: sig(9),
      limit: 1000,
    });
    expect(page.signatures).toHaveLength(0);
    expect(page.nextBefore).toBeNull();
    // gSFA (empty) -> status check -> gSFA again (exhaustion must reproduce).
    expect(calls.map((c) => (c.body as { method: string }).method)).toEqual([
      'getSignaturesForAddress',
      'getSignatureStatuses',
      'getSignaturesForAddress',
    ]);
    expect(calls[1]!.body).toMatchObject({
      method: 'getSignatureStatuses',
      params: [['sig-9'], { searchTransactionHistory: true }],
    });

    stubFetch((body) =>
      (body as { method?: string }).method === 'getSignatureStatuses'
        ? ok({ value: [null] })
        : ok([]),
    );
    const error = await new JsonRpcAdapter('https://rpc.test', 'failover')
      .getSignatures(ADDRESS, { before: sig(9), limit: 1000 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcResponseError);
    expect((error as RpcResponseError).message).toMatch(/cursor is unknown/);
  });

  it('a lagging backend behind a load balancer is self-corrected: the retry answer wins', async () => {
    // Split routing: the first gSFA hits a backend blind to the cursor (empty), the
    // status check hits a healthy sibling (cursor known). Blindly trusting the
    // empty page here would truncate the books; the retry reaches a healthy backend
    // and its REAL history is what gets served.
    let gsfaCalls = 0;
    stubFetch((body) => {
      const method = (body as { method?: string }).method;
      if (method === 'getSignatureStatuses') return ok({ value: [{ slot: 9 }] });
      gsfaCalls += 1;
      return gsfaCalls === 1 ? ok([]) : ok([wireSig(1)]);
    });
    const page = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      before: sig(9),
      limit: 1000,
    });
    expect(page.signatures.map((s) => s.signature)).toEqual([sig(1)]);
    expect(page.nextBefore).toBe(sig(1));
  });

  it('a fresh backfill (no cursor) takes an empty page at face value -- no extra round-trip', async () => {
    const calls = stubFetch(() => ok([]));
    const page = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      limit: 1000,
    });
    expect(page.nextBefore).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('marks failed transactions via the err field', async () => {
    stubFetch(() => ok([wireSig(1, 1_700_000_000, { InstructionError: [0, 'Custom'] })]));
    const page = await new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, {
      limit: 10,
    });
    expect(page.signatures[0]!.err).toBe(true);
  });
});

describe('JsonRpcAdapter rate limiting', () => {
  it('surfaces HTTP 429 as RateLimitedError carrying the server Retry-After in ms', async () => {
    stubFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '10' } }));
    const adapter = new JsonRpcAdapter('https://rpc.test', 'test');

    const error = await adapter.getSignatures(ADDRESS, { limit: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(10_000);
    expect((error as RateLimitedError).endpointLabel).toBe('test');
  });

  it('429 without Retry-After leaves retryAfterMs undefined for the driver backoff', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }));
    const error = await new JsonRpcAdapter('https://rpc.test', 'test')
      .getSignatures(ADDRESS, { limit: 10 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBeUndefined();
  });

  it('recognises throttling hidden inside a 200 JSON-RPC error (the OnFinality shape)', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32029, message: 'Too Many Requests' } }),
          { status: 200 },
        ),
    );
    await expect(
      new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, { limit: 10 }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('other RPC errors and HTTP failures throw their typed errors, never RateLimitedError', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } }), {
          status: 200,
        }),
    );
    await expect(
      new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, { limit: 10 }),
    ).rejects.toBeInstanceOf(RpcResponseError);

    stubFetch(() => new Response('gateway exploded', { status: 502 }));
    await expect(
      new JsonRpcAdapter('https://rpc.test', 'test').getSignatures(ADDRESS, { limit: 10 }),
    ).rejects.toBeInstanceOf(RpcHttpError);
  });
});

describe('JsonRpcAdapter.getTransactions', () => {
  it('fetches sequentially, one single-object request per signature -- never a batch array (D9)', async () => {
    // Concurrency is measured, not assumed: the stub holds each request open across a
    // real timer tick, so a Promise.all "optimization" would push inFlight above 1 --
    // exactly the change that turns mainnet-beta into a 429 storm (S1 Finding 2).
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: CapturedCall[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({ url, body: JSON.parse(init.body as string) });
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ok({ slot: 5, blockTime: 1_700_000_000 });
    });

    const txs = await new JsonRpcAdapter('https://rpc.test', 'test').getTransactions([
      sig(1),
      sig(2),
      sig(3),
    ]);

    expect(txs).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(maxInFlight).toBe(1);
    for (const call of calls) {
      expect(Array.isArray(call.body)).toBe(false);
      expect(call.body).toMatchObject({ method: 'getTransaction' });
    }
    expect((calls[0]!.body as { params: unknown[] }).params[1]).toMatchObject({
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    });
  });

  it('preserves progress: a 429 mid-sequence returns what was fetched so far', async () => {
    stubFetch((_body, call) =>
      call === 3 ? new Response('slow down', { status: 429 }) : ok({ slot: call, blockTime: null }),
    );
    const txs = await new JsonRpcAdapter('https://rpc.test', 'test').getTransactions([
      sig(1),
      sig(2),
      sig(3),
      sig(4),
    ]);
    // Two landed before the throttle; the caller retries sig-3/sig-4 later via
    // missingSignatures instead of re-paying for sig-1/sig-2 forever.
    expect(txs.map((t) => t.signature)).toEqual([sig(1), sig(2)]);
  });

  it('an error with ZERO progress still throws, so throttling stays visible', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }));
    await expect(
      new JsonRpcAdapter('https://rpc.test', 'test').getTransactions([sig(1), sig(2)]),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('a null result (transaction unknown to this node) is OMITTED, never counted as fetched', async () => {
    // Wrapping the null would let the hydration pipeline mark the signature done
    // and durably checkpoint past a payment that was never obtained. Omitted, it
    // stays in missingSignatures and is retried here and on the next endpoint.
    stubFetch((_body, call) => (call === 1 ? ok(null) : ok({ slot: 7, blockTime: null })));
    const txs = await new JsonRpcAdapter('https://rpc.test', 'test').getTransactions([
      sig(1),
      sig(2),
    ]);
    expect(txs.map((t) => t.signature)).toEqual([sig(2)]);
  });
});

describe('JsonRpcAdapter timeout', () => {
  it('aborts a hung request instead of hanging sync forever (the airplane-mode case)', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const adapter = new JsonRpcAdapter('https://rpc.test', 'test', { requestTimeoutMs: 25 });
    await expect(adapter.getSignatures(ADDRESS, { limit: 10 })).rejects.toThrow('aborted');
  });

  it('aborts a hung BODY read: headers arrived (200 OK) but json() never settles on its own', async () => {
    // Streaming fetch (undici, expo/fetch) resolves at HEADERS; a connection dying
    // mid-body then hangs response.json() forever. The abort timer must stay armed
    // across the body read -- clearTimeout lives in `finally`, so it only disarms
    // after json() settles -- or the airplane-mode hang comes back one layer deeper.
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '',
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    }));
    const adapter = new JsonRpcAdapter('https://rpc.test', 'test', { requestTimeoutMs: 25 });
    await expect(adapter.getSignatures(ADDRESS, { limit: 10 })).rejects.toThrow('aborted');
  });
});

describe('parseRetryAfterMs (RFC 9110: delta-seconds and HTTP-date forms)', () => {
  it('parses integer and fractional delta-seconds', () => {
    expect(parseRetryAfterMs('10')).toBe(10_000);
    expect(parseRetryAfterMs(' 1.5 ')).toBe(1_500);
  });

  it('parses the HTTP-date form Cloudflare-fronted endpoints send', () => {
    const now = Date.parse('2026-08-23T12:00:00Z');
    expect(parseRetryAfterMs('Sun, 23 Aug 2026 12:00:30 GMT', now)).toBe(30_000);
    // A date in the past clamps to zero rather than going negative.
    expect(parseRetryAfterMs('Sun, 23 Aug 2026 11:59:30 GMT', now)).toBe(0);
  });

  it('returns undefined for absent or unparseable values -- the driver backs off on its own', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });
});

describe('endpoint order (D9)', () => {
  it('defaults to publicnode primary, mainnet-beta failover', () => {
    expect(mainnetEndpoints().map((e) => e.endpointLabel)).toEqual(['publicnode', 'mainnet-beta']);
  });

  it('a user-supplied RPC URL goes first', () => {
    expect(mainnetEndpoints('https://my.helius.example').map((e) => e.endpointLabel)).toEqual([
      'user-rpc',
      'publicnode',
      'mainnet-beta',
    ]);
  });
});
