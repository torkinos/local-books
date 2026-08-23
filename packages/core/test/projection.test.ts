/**
 * Projection tests (D4): the claim "SQLite is a disposable index" is only true if
 * throwing it away and refolding reproduces identical state, and the claim "the op log
 * holds human decisions only" is only true if ingestion demonstrably never writes there.
 * Both are asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';
import { backfillAddress } from '../src/ingest/backfill.js';
import { normalizeTransactions } from '../src/normalize/index.js';
import { stableStringify } from '../src/oplog/index.js';
import { project, rebuild } from '../src/projection/index.js';
import type { Op, OpType } from '../src/types/index.js';
import { asAddress, asReferenceKey } from '../src/types/index.js';
import {
  chainEvent,
  FakeRpc,
  FakeStorage,
  fixedClock,
  page,
  sig,
  sigInfo,
  usdc,
  T,
} from './fixtures/fakes.js';

const WATCHED = asAddress('watched-address');

const ops: Op[] = [
  { type: 'address-watched', id: 'op-1', at: T(1), address: WATCHED, label: 'Freelance wallet' },
  {
    type: 'invoice-created',
    id: 'op-2',
    at: T(2),
    invoiceId: 'inv-001',
    clientName: 'Acme Ltd',
    lineItems: [{ description: 'Design', quantity: 1, unitAmount: 100_000_000n }],
    total: usdc('100'),
    dueDate: T(500),
    reference: asReferenceKey('ref-001'),
    payTo: WATCHED,
  },
  {
    type: 'match-confirmed',
    id: 'op-3',
    at: T(3),
    invoiceId: 'inv-001',
    signature: sig(1),
    instructionIndex: 0,
    via: 'reference',
  },
  { type: 'category-assigned', id: 'op-4', at: T(4), signature: sig(2), instructionIndex: 0, category: 'consulting' },
];

const events = [
  chainEvent({ signature: sig(1), instructionIndex: 0 }),
  chainEvent({ signature: sig(1), instructionIndex: 1, amount: usdc('25') }),
  chainEvent({ signature: sig(2), instructionIndex: 0, amount: usdc('50') }),
];

describe('rebuild equivalence (D4)', () => {
  // Scope honesty: core has no materialized projection -- project() returns a value --
  // so what these tests can prove is that rebuild() reloads the right inputs, clears,
  // and refolds deterministically. The other half of D4 (the app's incrementally
  // maintained SQLite tables agreeing with a fresh fold) can only be tested against
  // the real StoragePort adapter and belongs to the apps/mobile suite (T6/T15).
  it('clearing the projection and refolding reproduces identical state', async () => {
    const storage = new FakeStorage();
    await storage.appendOps(ops);
    await storage.putChainEvents(events);

    const live = project(await storage.readOps(), await storage.getChainEvents(WATCHED));
    const rebuilt = await rebuild(storage);

    expect(storage.projectionCleared).toBe(1);
    expect(rebuilt).toEqual(live);
    // And the fold actually saw the data: this is not two empty states agreeing.
    expect(rebuilt.invoices).toHaveLength(1);
    expect(rebuilt.invoices[0]!.status).toBe('paid');
    expect(rebuilt.unmatchedEvents).toHaveLength(2);
    expect(rebuilt.watchedAddresses).toEqual([{ address: WATCHED, label: 'Freelance wallet' }]);
  });

  it('rebuild is idempotent: a second rebuild returns the same state again', async () => {
    const storage = new FakeStorage();
    await storage.appendOps(ops);
    await storage.putChainEvents(events);

    const first = await rebuild(storage);
    const second = await rebuild(storage);
    expect(second).toEqual(first);
  });

  it('loads events for an invoice payTo address the user never formally watched', async () => {
    const payTo = asAddress('invoice-only-address');
    const storage = new FakeStorage();
    await storage.appendOps([
      {
        type: 'invoice-created',
        id: 'op-inv',
        at: T(2),
        invoiceId: 'inv-009',
        clientName: 'Acme Ltd',
        lineItems: [{ description: 'Design', quantity: 1, unitAmount: 100_000_000n }],
        total: usdc('100'),
        dueDate: T(500),
        reference: asReferenceKey('ref-009'),
        payTo,
      },
    ]);
    await storage.putChainEvents([chainEvent({ signature: sig(9), watchedAddress: payTo })]);

    const rebuilt = await rebuild(storage);
    // No address-watched op exists, but the payment ingested for the invoice's payTo
    // must survive a rebuild rather than being orphaned.
    expect(rebuilt.unmatchedEvents).toHaveLength(1);
  });

  it('keeps events of a later-unwatched address instead of retracting booked income', async () => {
    const storage = new FakeStorage();
    await storage.appendOps(ops);
    await storage.appendOps([{ type: 'address-unwatched', id: 'op-5', at: T(9), address: WATCHED }]);
    await storage.putChainEvents(events);

    const rebuilt = await rebuild(storage);
    // Hidden from the UI list, but its ledger survives the rebuild.
    expect(rebuilt.watchedAddresses).toEqual([]);
    expect(rebuilt.unmatchedEvents).toHaveLength(2);
    expect(rebuilt.invoices[0]!.payments).toHaveLength(1);
  });
});

describe('the op log never absorbs chain data (D4)', () => {
  it('a full ingestion pass appends nothing to the op log', async () => {
    const storage = new FakeStorage();
    await storage.appendOps(ops);
    const before = [...(await storage.readOps())];

    // The ingestion pipeline as core defines it: backfill pages signatures,
    // transactions are normalized, events land via putChainEvents. None of it may
    // touch the op log. (The drive loop here is the test's own -- the production
    // orchestrator lives in apps/mobile; when it exists, it needs this same assertion
    // against its real sync loop.)
    const rpc = new FakeRpc([page([sigInfo(1), sigInfo(2)], null)]);
    for await (const progress of backfillAddress(WATCHED, { rpc, storage, clock: fixedClock() })) {
      if (progress.kind === 'page') {
        const raw = await rpc.getTransactions(progress.signatures.map((s) => s.signature));
        await storage.putChainEvents(normalizeTransactions(raw, WATCHED));
        await storage.putChainEvents(events);
      }
    }

    const after = await storage.readOps();
    expect(after).toEqual(before);
  });

  it('every op in the log is a human decision type, and none carries a ChainEvent shape', async () => {
    const storage = new FakeStorage();
    await storage.appendOps(ops);
    await storage.putChainEvents(events);
    await rebuild(storage);

    const KNOWN: readonly OpType[] = [
      'invoice-created',
      'match-confirmed',
      'match-rejected',
      'address-watched',
      'address-unwatched',
      'category-assigned',
    ];
    // Chain-only field names and kind values, checked against the op's FULL serialized
    // form: a ChainEvent nested one level down (`op.event = {...}`), or a single
    // smuggled field, still trips this -- a top-level-keys check would not.
    const CHAIN_MARKERS = ['"watchedAddress"', '"counterparty"', '"sol-transfer"', '"spl-transfer"', '"succeeded"'];
    for (const op of await storage.readOps()) {
      expect(KNOWN).toContain(op.type);
      const json = stableStringify(op);
      for (const marker of CHAIN_MARKERS) {
        expect(json).not.toContain(marker);
      }
    }
  });
});

describe('projection contents', () => {
  it('failed transactions never appear as unexplained deposits', () => {
    const state = project(
      [],
      [chainEvent({ signature: sig(7), succeeded: false }), chainEvent({ signature: sig(8) })],
    );
    expect(state.unmatchedEvents.map((e) => e.signature)).toEqual([sig(8)]);
  });

  it('a transfer between two watched wallets keeps both ledger sides', () => {
    const out = chainEvent({
      signature: sig(7),
      instructionIndex: 0,
      watchedAddress: asAddress('wallet-a'),
      direction: 'out',
    });
    const incoming = chainEvent({
      signature: sig(7),
      instructionIndex: 0,
      watchedAddress: asAddress('wallet-b'),
      direction: 'in',
    });
    expect(project([], [out, incoming]).unmatchedEvents).toHaveLength(2);
  });
});

describe('projection determinism', () => {
  it('folding is independent of op delivery order (sortOps canonicalizes)', () => {
    // Event order is not shuffled here: storage serves events in stable order and
    // unmatchedEvents deliberately preserves it. Op order, however, must not matter --
    // replication will deliver ops in arbitrary order (oplog/index.ts, sortOps).
    const shuffledOps = [ops[3]!, ops[0]!, ops[2]!, ops[1]!];
    expect(project(shuffledOps, events)).toEqual(project(ops, events));
  });
});
