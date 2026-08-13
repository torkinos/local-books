/**
 * Backfill tests -- the riskiest logic in v0.1 (PROJECT.md line 130).
 *
 * The interesting cases are all failure cases: the app being killed mid-sync, the
 * endpoint throttling us, and history running out. These run instantly because the
 * generator only *requests* pauses; nothing here sleeps.
 */
import { describe, expect, it } from 'vitest';
import {
  backfillAddress,
  backoffMs,
  DEFAULT_BACKFILL_OPTIONS,
  syncNewSignatures,
} from '../src/ingest/backfill.js';
import type { BackfillProgress } from '../src/ingest/backfill.js';
import { asAddress } from '../src/types/index.js';
import {
  FakeRpc,
  FakeStorage,
  fixedClock,
  page,
  rateLimited,
  sig,
  sigInfo,
} from './fixtures/fakes.js';

const ADDRESS = asAddress('watched-address');
const OPTIONS = { ...DEFAULT_BACKFILL_OPTIONS, pageSize: 2, basePaceMs: 10 };

async function drain(gen: AsyncGenerator<BackfillProgress, void, undefined>) {
  const out: BackfillProgress[] = [];
  for await (const p of gen) out.push(p);
  return out;
}

describe('backfillAddress', () => {
  it('pages backwards to the end of history and reports completion', async () => {
    const rpc = new FakeRpc([
      page([sigInfo(5), sigInfo(4)], sig(4)),
      page([sigInfo(3), sigInfo(2)], sig(2)),
      page([sigInfo(1)], null),
    ]);
    const storage = new FakeStorage();

    const progress = await drain(
      backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS),
    );

    const pages = progress.filter((p) => p.kind === 'page');
    expect(pages).toHaveLength(3);
    expect(progress.at(-1)).toMatchObject({ kind: 'done', reason: 'history-exhausted' });

    // Each page must advance the cursor via `before`, or we would loop on the tip.
    expect(rpc.calls.map((c) => c.before)).toEqual([undefined, sig(4), sig(2)]);

    const checkpoint = await storage.getCheckpoint(ADDRESS);
    expect(checkpoint?.complete).toBe(true);
    // The tip at the moment the run started, for later incremental syncs.
    expect(checkpoint?.newestSeen).toBe(sig(5));
  });

  it('checkpoints after every page, not just at the end', async () => {
    // This is what makes an Android process kill survivable (PROJECT.md line 71).
    const rpc = new FakeRpc([
      page([sigInfo(5), sigInfo(4)], sig(4)),
      page([sigInfo(3), sigInfo(2)], sig(2)),
      page([sigInfo(1)], null),
    ]);
    const storage = new FakeStorage();

    await drain(backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS));

    expect(storage.checkpointWrites).toBeGreaterThanOrEqual(3);
  });

  it('resumes from the stored cursor after being killed mid-sync', async () => {
    const storage = new FakeStorage();
    const firstRpc = new FakeRpc([
      page([sigInfo(5), sigInfo(4)], sig(4)),
      page([sigInfo(3), sigInfo(2)], sig(2)),
    ]);

    // Simulate the process dying after one page: pull exactly one value, then stop.
    const gen = backfillAddress(ADDRESS, { rpc: firstRpc, storage, clock: fixedClock() }, OPTIONS);
    await gen.next();
    await gen.return(undefined);

    expect((await storage.getCheckpoint(ADDRESS))?.oldestSeen).toBe(sig(4));

    // A fresh run must continue from sig(4), not restart at the tip.
    const secondRpc = new FakeRpc([page([sigInfo(3), sigInfo(2)], sig(2)), page([sigInfo(1)], null)]);
    const progress = await drain(
      backfillAddress(ADDRESS, { rpc: secondRpc, storage, clock: fixedClock() }, OPTIONS),
    );

    expect(secondRpc.calls[0]?.before).toBe(sig(4));
    expect(progress.at(-1)).toMatchObject({ kind: 'done', reason: 'history-exhausted' });
  });

  it('does not re-walk history once an address is complete', async () => {
    const rpc = new FakeRpc([page([sigInfo(1)], null)]);
    const storage = new FakeStorage();
    await drain(backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS));
    const callsAfterFirstRun = rpc.calls.length;

    await drain(backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS));

    expect(rpc.calls.length).toBe(callsAfterFirstRun);
  });

  it('backs off and retries the same cursor when rate limited', async () => {
    const rpc = new FakeRpc(
      [page([sigInfo(5), sigInfo(4)], sig(4)), page([sigInfo(3)], null)],
      new Map([[1, rateLimited()]]),
    );
    const storage = new FakeStorage();

    const progress = await drain(
      backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS),
    );

    const throttled = progress.filter((p) => p.kind === 'rate-limited');
    expect(throttled).toHaveLength(1);
    expect(throttled[0]).toMatchObject({ consecutiveHits: 1 });
    // Retry must reuse the cursor -- a rate-limited call fetched nothing.
    expect(rpc.calls[1]?.before).toBe(rpc.calls[2]?.before);
    expect(progress.at(-1)).toMatchObject({ kind: 'done' });
  });

  it('asks for failover instead of backing off forever', async () => {
    const failures = new Map(
      Array.from({ length: 5 }, (_, i) => [i, rateLimited()] as const),
    );
    const rpc = new FakeRpc([], failures);
    const storage = new FakeStorage();

    const progress = await drain(
      backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, { ...OPTIONS, maxConsecutiveRateLimits: 5 }),
    );

    expect(progress.at(-1)).toMatchObject({ kind: 'failover-needed', endpointLabel: 'fake' });
  });

  it('stops at the page budget so a run cannot drain the battery', async () => {
    const rpc = new FakeRpc(
      Array.from({ length: 10 }, (_, i) => page([sigInfo(100 - i)], sig(100 - i))),
    );
    const storage = new FakeStorage();

    const progress = await drain(
      backfillAddress(ADDRESS, { rpc, storage, clock: fixedClock() }, { ...OPTIONS, maxPagesPerRun: 3 }),
    );

    expect(progress.filter((p) => p.kind === 'page')).toHaveLength(3);
    expect(progress.at(-1)).toMatchObject({ kind: 'done', reason: 'page-budget-reached' });
  });
});

describe('syncNewSignatures', () => {
  it('yields only signatures newer than the watermark', async () => {
    const storage = new FakeStorage();
    await storage.putCheckpoint({
      address: ADDRESS,
      oldestSeen: null,
      newestSeen: sig(3),
      complete: true,
      updatedAt: fixedClock().now(),
    });

    const rpc = new FakeRpc([page([sigInfo(5), sigInfo(4), sigInfo(3)], sig(3))]);
    const progress = await drain(
      syncNewSignatures(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS),
    );

    const emitted = progress
      .filter((p): p is Extract<BackfillProgress, { kind: 'page' }> => p.kind === 'page')
      .flatMap((p) => p.signatures.map((s) => s.signature));

    expect(emitted).toEqual([sig(5), sig(4)]);
    expect(await storage.getCheckpoint(ADDRESS).then((c) => c?.newestSeen)).toBe(sig(5));
  });

  it('falls back to a full backfill when nothing has been ingested yet', async () => {
    const rpc = new FakeRpc([page([sigInfo(1)], null)]);
    const storage = new FakeStorage();

    const progress = await drain(
      syncNewSignatures(ADDRESS, { rpc, storage, clock: fixedClock() }, OPTIONS),
    );

    expect(progress.at(-1)).toMatchObject({ kind: 'done', reason: 'history-exhausted' });
  });
});

describe('backoffMs', () => {
  it('grows exponentially and respects the ceiling', () => {
    const opts = { ...DEFAULT_BACKFILL_OPTIONS, basePaceMs: 100, maxBackoffMs: 1000 };
    expect(backoffMs(1, opts)).toBe(200);
    expect(backoffMs(3, opts)).toBe(800);
    expect(backoffMs(10, opts)).toBe(1000);
  });

  it('prefers the server advice over its own guess', () => {
    const opts = { ...DEFAULT_BACKFILL_OPTIONS, basePaceMs: 100, maxBackoffMs: 60_000 };
    expect(backoffMs(5, opts, 1500)).toBe(1500);
  });
});
