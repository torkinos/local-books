/**
 * Sync-engine tests: the D8 durability handshake as the ENGINE experiences it,
 * hydration shortfall retries, endpoint rotation (D9), cancellation, and the
 * incremental path. All against fakes; the wall clock never runs (sleep is injected).
 */
import { describe, expect, it } from 'vitest';
import type { BackfillOptions } from '@local-books/core';
import { RateLimitedError, asUnixSeconds, sortByRecency } from '@local-books/core';
import { RpcHttpError } from '../src/adapters/rpc.js';
import { syncAddress } from '../src/sync/engine.js';
import type { SyncDeps, SyncEngineOptions, SyncProgress } from '../src/sync/engine.js';
import {
  HistoryRpc,
  RecordingStorage,
  WATCHED,
  fixedClock,
  history,
  sig,
} from './helpers/syncFakes.js';

const backfillOpts = (overrides: Partial<BackfillOptions> = {}): BackfillOptions => ({
  pageSize: 3,
  maxPagesPerRun: 10,
  basePaceMs: 5,
  maxBackoffMs: 100,
  maxConsecutiveRateLimits: 3,
  ...overrides,
});

const engineOpts = (overrides: Partial<BackfillOptions> = {}): SyncEngineOptions => ({
  backfill: backfillOpts(overrides),
  hydrationChunkSize: 2,
});

function recordedSleep(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

function makeDeps(
  endpoints: readonly HistoryRpc[],
  storage: RecordingStorage,
  extra: Partial<SyncDeps> = {},
): SyncDeps {
  return { endpoints, storage, clock: fixedClock(), ...extra };
}

describe('syncAddress: initial backfill', () => {
  it('walks history to exhaustion: every signature hydrated, normalized, stored', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(7));
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    expect(result.totals).toEqual({
      pages: 3,
      signaturesSeen: 7,
      transactionsFetched: 7,
      eventsStored: 7,
    });
    const events = storage.events.get(WATCHED) ?? [];
    expect(events).toHaveLength(7);
    expect(sortByRecency(events).map((e) => e.signature)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map(sig),
    );
    const checkpoint = storage.checkpoints.get(WATCHED);
    expect(checkpoint?.complete).toBe(true);
    expect(checkpoint?.newestSeen).toBe(sig(7));
  });

  it('D8 interleaving: every page fully persisted before the checkpoint that covers it', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(7));
    const { sleep } = recordedSleep();

    await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(storage.log).toEqual([
      { write: 'events', signatures: [sig(7), sig(6)] },
      { write: 'events', signatures: [sig(5)] },
      { write: 'checkpoint', oldestSeen: sig(5), newestSeen: sig(7), complete: false },
      { write: 'events', signatures: [sig(4), sig(3)] },
      { write: 'events', signatures: [sig(2)] },
      { write: 'checkpoint', oldestSeen: sig(2), newestSeen: sig(7), complete: false },
      { write: 'events', signatures: [sig(1)] },
      { write: 'checkpoint', oldestSeen: sig(1), newestSeen: sig(7), complete: false },
      { write: 'checkpoint', oldestSeen: sig(1), newestSeen: sig(7), complete: true },
    ]);
  });

  it('page-budget-reached: returns to the caller; the next run resumes from the cursor', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(7));
    const { sleep } = recordedSleep();
    const opts = engineOpts({ maxPagesPerRun: 2 });

    const first = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), opts);
    expect(first.kind).toBe('page-budget-reached');
    expect(storage.events.get(WATCHED)).toHaveLength(6);

    const callsBefore = rpc.sigCalls.length;
    const second = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), opts);
    expect(second.kind).toBe('complete');
    expect(rpc.sigCalls[callsBefore]?.before).toBe(sig(2));
    expect(storage.events.get(WATCHED)).toHaveLength(7);
  });
});

describe('syncAddress: hydration', () => {
  it('retries a partial getTransactions return until the shortfall is closed', async () => {
    const storage = new RecordingStorage();
    // First hydration call serves 1 of 2 -- the adapter's mid-batch-throttle shape.
    const rpc = new HistoryRpc('A', history(3), {
      txBehavior: (call) => (call === 0 ? { partial: 1 } : undefined),
    });
    const { sleeps, sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    expect(rpc.txCalls[0]).toEqual([sig(3), sig(2)]);
    // The shortfall (sig 2) leads the retry; already-fetched sig 3 is not re-bought.
    expect(rpc.txCalls[1]).toEqual([sig(2), sig(1)]);
    expect(storage.events.get(WATCHED)).toHaveLength(3);
    // The engine breathed between the partial return and the retry.
    expect(sleeps).toContain(10); // backoffMs(1): 5 * 2^1
  });

  it('sleeps on zero-progress 429s, honoring retryAfterMs, then rotates when exhausted', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(3), {
      txBehavior: () => ({ throw: new RateLimitedError('A', 50) }),
    });
    const { sleeps, sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('endpoints-exhausted');
    expect(result.kind === 'endpoints-exhausted' && result.lastError).toBeInstanceOf(RateLimitedError);
    // Two backoffs at the server's advised 50ms, then the third hit rotates.
    expect(sleeps).toEqual([50, 50]);
    // The page never fully persisted, so the checkpoint never advanced (D8).
    expect(storage.checkpointWrites()).toHaveLength(0);
  });

  it('a page that cannot persist on endpoint A is re-served by B, skipping stored transactions', async () => {
    const storage = new RecordingStorage();
    // A serves the signature page, then serves ONE transaction and throttles forever:
    // partial progress persists, but the page cannot complete on A.
    const a = new HistoryRpc('A', history(3), {
      txBehavior: (call) =>
        call === 0 ? { partial: 1 } : { throw: new RateLimitedError('A') },
    });
    const b = new HistoryRpc('B', history(3));
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    // B started from scratch (A never checkpointed) ...
    expect(b.sigCalls[0]?.before).toBeUndefined();
    // ... but did NOT re-buy the transaction A already persisted (sig 3).
    expect(b.txCalls.flat()).not.toContain(sig(3));
    expect(storage.events.get(WATCHED)).toHaveLength(3);
  });

  it('treats an empty return for a non-empty request as a broken endpoint, not a loop', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(3), { txBehavior: () => ({ partial: 0 }) });
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('endpoints-exhausted');
    expect(String(result.kind === 'endpoints-exhausted' ? result.lastError : '')).toMatch(
      /returned nothing/,
    );
  });
});

describe('syncAddress: endpoint rotation (D9)', () => {
  it('rotates on failover-needed and resumes from the durable cursor', async () => {
    const storage = new RecordingStorage();
    // A serves page one, then rate-limits every signature fetch until the driver
    // gives up (maxConsecutiveRateLimits) and asks for failover.
    const a = new HistoryRpc('A', history(7), {
      failGetSignatures: (call) => (call >= 1 ? new RateLimitedError('A', 20) : undefined),
    });
    const b = new HistoryRpc('B', history(7));
    const { sleeps, sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    // The driver's backoff honored the server's advice before giving up.
    expect(sleeps).toContain(20);
    // Continuity: B picked up exactly where A's checkpoint left off.
    expect(b.sigCalls[0]?.before).toBe(sig(5));
    expect(storage.events.get(WATCHED)).toHaveLength(7);
    const checkpoint = storage.checkpoints.get(WATCHED);
    expect(checkpoint?.complete).toBe(true);
  });

  it('rotates on a thrown transport error (dead endpoint), and the run still completes', async () => {
    const storage = new RecordingStorage();
    const a = new HistoryRpc('A', history(3), {
      failGetSignatures: () => new RpcHttpError('A', 503, 'down'),
    });
    const b = new HistoryRpc('B', history(3));
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    expect(storage.events.get(WATCHED)).toHaveLength(3);
  });

  it('rotating to an endpoint that cannot see the cursor must NOT mark history complete', async () => {
    // The critical shape from review: A checkpoints page one, dies; B has shorter
    // retention and does not know A's cursor. B throwing (the adapter's cursor
    // verification) must leave the checkpoint incomplete -- a B that instead served
    // an empty page would have durably marked complete:true and silently truncated
    // the books to a single page.
    const storage = new RecordingStorage();
    const a = new HistoryRpc('A', history(7), {
      failGetSignatures: (call) => (call >= 1 ? new RateLimitedError('A') : undefined),
    });
    const b = new HistoryRpc('B', history(7).slice(0, 2)); // knows only sigs 7,6 -- not cursor sig 5
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('endpoints-exhausted');
    const checkpoint = storage.checkpoints.get(WATCHED);
    expect(checkpoint?.complete).toBe(false); // page one's cursor stands; nothing lost
    expect(checkpoint?.oldestSeen).toBe(sig(5));
  });

  it('reports endpoints-exhausted with the last error when the list runs out', async () => {
    const storage = new RecordingStorage();
    const boom = new RpcHttpError('B', 500, 'boom');
    const a = new HistoryRpc('A', history(3), {
      failGetSignatures: () => new RpcHttpError('A', 503, 'down'),
    });
    const b = new HistoryRpc('B', history(3), { failGetSignatures: () => boom });
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('endpoints-exhausted');
    expect(result.kind === 'endpoints-exhausted' && result.lastError).toBe(boom);
  });
});

describe('syncAddress: cancellation', () => {
  it('stops without checkpointing the in-flight page; the next run replays it for free', async () => {
    const storage = new RecordingStorage();
    const a = new HistoryRpc('A', history(7));
    const controller = new AbortController();
    // Abort during the first sleep -- the pauseMs after page one persisted.
    const sleep = async (): Promise<void> => controller.abort();

    const result = await syncAddress(
      WATCHED,
      makeDeps([a], storage, { sleep, signal: controller.signal }),
      engineOpts(),
    );

    expect(result.kind).toBe('cancelled');
    expect(storage.events.get(WATCHED)).toHaveLength(3); // page one persisted
    expect(storage.checkpointWrites()).toHaveLength(0); // but never checkpointed (D8)

    // Resume: the page replays, dedup absorbs it, and its transactions are not
    // re-fetched because their events are already stored.
    const b = new HistoryRpc('B', history(7));
    const { sleep: quietSleep } = recordedSleep();
    const resumed = await syncAddress(WATCHED, makeDeps([b], storage, { sleep: quietSleep }), engineOpts());

    expect(resumed.kind).toBe('complete');
    expect(storage.events.get(WATCHED)).toHaveLength(7);
    for (const already of [sig(7), sig(6), sig(5)]) {
      expect(b.txCalls.flat()).not.toContain(already);
    }
  });
});

describe('syncAddress: incremental (complete checkpoint)', () => {
  const completeCheckpoint = () => ({
    address: WATCHED,
    oldestSeen: sig(1),
    newestSeen: sig(5),
    complete: true,
    updatedAt: asUnixSeconds(1_700_000_000),
  });

  it('fetches only what landed since the watermark and advances newestSeen', async () => {
    const storage = new RecordingStorage();
    storage.checkpoints.set(WATCHED, completeCheckpoint());
    const rpc = new HistoryRpc('A', history(7)); // sigs 6 and 7 are new
    const { sleep } = recordedSleep();
    const seen: SyncProgress[] = [];

    const result = await syncAddress(
      WATCHED,
      makeDeps([rpc], storage, { sleep, onProgress: (p) => seen.push(p) }),
      engineOpts(),
    );

    expect(result.kind).toBe('complete');
    expect(rpc.txCalls).toEqual([[sig(7), sig(6)]]);
    expect(storage.events.get(WATCHED)).toHaveLength(2);
    expect(storage.checkpoints.get(WATCHED)?.newestSeen).toBe(sig(7));
    expect(storage.checkpoints.get(WATCHED)?.complete).toBe(true);
    expect(seen.every((p) => p.mode === 'incremental')).toBe(true);
  });

  it('an address that was empty at first sync still ingests its first-ever payment', async () => {
    // The T16 demo shape: watch a freshly created wallet (zero history, so the
    // first walk completed with newestSeen null), then a payment lands. The
    // completeness flag must not freeze the address.
    const storage = new RecordingStorage();
    storage.checkpoints.set(WATCHED, {
      address: WATCHED,
      oldestSeen: null,
      newestSeen: null,
      complete: true,
      updatedAt: asUnixSeconds(1_700_000_000),
    });
    const rpc = new HistoryRpc('A', history(1)); // the first payment
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('complete');
    expect(storage.events.get(WATCHED)).toHaveLength(1);
    expect(storage.checkpoints.get(WATCHED)?.newestSeen).toBe(sig(1));
    expect(storage.checkpoints.get(WATCHED)?.complete).toBe(true);
  });

  it('a 429 during incremental paging rotates (the incremental driver does not absorb it)', async () => {
    const storage = new RecordingStorage();
    storage.checkpoints.set(WATCHED, completeCheckpoint());
    const rpc = new HistoryRpc('A', history(7), {
      failGetSignatures: () => new RateLimitedError('A'),
    });
    const { sleep } = recordedSleep();

    const result = await syncAddress(WATCHED, makeDeps([rpc], storage, { sleep }), engineOpts());

    expect(result.kind).toBe('endpoints-exhausted');
    expect(result.kind === 'endpoints-exhausted' && result.lastError).toBeInstanceOf(RateLimitedError);
    // The watermark did not move: those signatures will be found next run.
    expect(storage.checkpoints.get(WATCHED)?.newestSeen).toBe(sig(5));
  });
});

describe('syncAddress: failures that must NOT rotate', () => {
  it('a network TypeError rotates, but a programming TypeError propagates', async () => {
    const storage = new RecordingStorage();
    const flaky = new HistoryRpc('A', history(3), {
      failGetSignatures: (call) => (call === 0 ? new TypeError('Network request failed') : undefined),
    });
    const b = new HistoryRpc('B', history(3));
    const { sleep } = recordedSleep();
    const ok = await syncAddress(WATCHED, makeDeps([flaky, b], storage, { sleep }), engineOpts());
    expect(ok.kind).toBe('complete');

    const buggy = new HistoryRpc('A', history(3), {
      failGetSignatures: () => new TypeError("Cannot read properties of undefined (reading 'slot')"),
    });
    const untouched = new HistoryRpc('B', history(3));
    await expect(
      syncAddress(WATCHED, makeDeps([buggy, untouched], new RecordingStorage(), { sleep }), engineOpts()),
    ).rejects.toThrow(/Cannot read properties/);
    expect(untouched.sigCalls).toHaveLength(0);
  });

  it('a storage failure propagates instead of being retried against other endpoints', async () => {
    const storage = new RecordingStorage();
    storage.failPutChainEvents = (call) => (call === 0 ? new Error('disk full') : undefined);
    const a = new HistoryRpc('A', history(3));
    const b = new HistoryRpc('B', history(3));
    const { sleep } = recordedSleep();

    await expect(
      syncAddress(WATCHED, makeDeps([a, b], storage, { sleep }), engineOpts()),
    ).rejects.toThrow('disk full');
    // B was never consulted -- a broken disk is not an endpoint problem.
    expect(b.sigCalls).toHaveLength(0);
    expect(storage.checkpointWrites()).toHaveLength(0);
  });
});

describe('syncAddress: progress reporting', () => {
  it('reports paging, per-chunk hydration counts, and monotonic totals', async () => {
    const storage = new RecordingStorage();
    const rpc = new HistoryRpc('A', history(7));
    const { sleep } = recordedSleep();
    const seen: SyncProgress[] = [];

    await syncAddress(
      WATCHED,
      makeDeps([rpc], storage, { sleep, onProgress: (p) => seen.push(p) }),
      engineOpts(),
    );

    expect(seen[0]?.phase).toBe('paging');
    expect(seen.every((p) => p.mode === 'backfill' && p.endpointLabel === 'A')).toBe(true);
    const hydration = seen.filter((p) => p.phase === 'hydrating' && p.pageHydration !== undefined);
    expect(hydration[0]?.pageHydration).toEqual({ fetched: 0, total: 3 });
    expect(hydration.some((p) => p.pageHydration?.fetched === 2)).toBe(true);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.transactionsFetched).toBeGreaterThanOrEqual(seen[i - 1]!.transactionsFetched);
      expect(seen[i]!.pages).toBeGreaterThanOrEqual(seen[i - 1]!.pages);
    }
  });
});
