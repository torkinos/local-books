/**
 * T6 tests, against REAL SQLite: node:sqlite executes the exact schema and statements
 * op-sqlite will run on the device, in a temp-file database that gets closed and
 * reopened to prove persistence across a restart. What is NOT covered here -- and
 * stays a device check -- is the SQLCipher layer itself (encrypted file unreadable by
 * plain sqlite3) and the Keystore-held key.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Vite strips the node: prefix and then cannot resolve `sqlite` (a node:-only
// builtin), so the module is loaded through the runtime instead of the bundler.
const { DatabaseSync: OpenDatabase } = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(name: 'node:sqlite'): { DatabaseSync: new (path: string) => DatabaseSync };
    };
  }
).process.getBuiltinModule('node:sqlite');
import type { Address, ChainEvent, InvoiceCreatedOp, Op, StoragePort } from '@local-books/core';
import {
  asAddress,
  asReferenceKey,
  asSignature,
  asUnixSeconds,
  project,
  rebuild,
} from '@local-books/core';
import { createSqliteStorage, type SqlExecutor } from '../src/storage/sqliteStorage.js';
import { deserialize, serialize } from '../src/storage/serde.js';

const WATCHED = asAddress('watched-address');

function makeExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql, params = []) {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: db.prepare(sql).all(...params) };
      }
      if (params.length === 0) {
        db.exec(sql);
        return { rows: [] };
      }
      db.prepare(sql).run(...params);
      return { rows: [] };
    },
  };
}

const invoiceOp = (id: string, at: number): InvoiceCreatedOp => ({
  type: 'invoice-created',
  id,
  at: asUnixSeconds(at),
  invoiceId: `inv-${id}`,
  clientName: 'Acme Corp',
  lineItems: [{ description: 'Design work', quantity: 3, unitAmount: 33_333_333n }],
  total: {
    raw: 99_999_999n,
    decimals: 6,
    mint: asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    symbol: 'USDC',
  },
  dueDate: asUnixSeconds(at + 1000),
  reference: asReferenceKey(`ref-${id}`),
  payTo: WATCHED,
});

const event = (overrides: Partial<ChainEvent> = {}): ChainEvent => ({
  kind: 'spl-transfer',
  signature: asSignature('sig-0001'),
  instructionIndex: 0,
  slot: 100,
  blockTime: asUnixSeconds(1_760_000_000),
  watchedAddress: WATCHED,
  counterparty: asAddress('client-address'),
  direction: 'in',
  amount: { raw: 500_000n, decimals: 6, mint: asAddress('EPjF-mint'), symbol: 'USDC' },
  memo: null,
  references: [],
  succeeded: true,
  ...overrides,
});

describe('serde', () => {
  it('round-trips nested bigints exactly', () => {
    const op = invoiceOp('op-1', 1_700_000_000);
    const back = deserialize<InvoiceCreatedOp>(serialize(op));
    expect(back).toEqual(op);
    expect(typeof back.total.raw).toBe('bigint');
    expect(typeof back.lineItems[0]!.unitAmount).toBe('bigint');
  });

  it('leaves plain values, null, and arrays untouched', () => {
    const value = { a: [1, 'two', null], b: { c: false }, d: 'has {"$bigint" : "nope"} inside a string' };
    expect(deserialize(serialize(value))).toEqual(value);
  });

  it('rejects corrupted wrappers loudly instead of deserializing wrong money', () => {
    // BigInt('') is 0n and BigInt('0x10') is 16n -- leniency here would turn a torn
    // byte into a silently wrong amount in the books.
    expect(() => deserialize('{"total":{"$bigint":""}}')).toThrow(SyntaxError);
    expect(() => deserialize('{"total":{"$bigint":"0x10"}}')).toThrow(SyntaxError);
    expect(() => deserialize('{"total":{"$bigint":" 5"}}')).toThrow(SyntaxError);
  });

  it('refuses to serialize input that collides with the wrapper shape', () => {
    // A genuine {$bigint: string} object would come back as a bigint -- round-trip
    // infidelity in the source of truth. Fail at write time, not silently at read.
    expect(() => serialize({ attachment: { $bigint: '999' } })).toThrow(TypeError);
  });
});

describe('sqlite StoragePort', () => {
  let dir: string;
  let db: DatabaseSync;
  let storage: StoragePort;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lb-sqlite-'));
    db = new OpenDatabase(join(dir, 'test.db'));
    storage = await createSqliteStorage(makeExecutor(db));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ops round-trip exactly, in append order, with bigint fidelity', async () => {
    const ops: Op[] = [invoiceOp('op-a', 2), invoiceOp('op-b', 1)];
    await storage.appendOps(ops);

    const back = await storage.readOps();
    // Append order, NOT time order -- sortOps is the fold's job, the log just records.
    expect(back).toEqual(ops);
    expect(typeof (back[0] as InvoiceCreatedOp).total.raw).toBe('bigint');
  });

  it('a replayed op id is ignored, keeping the log append-only and deduplicated', async () => {
    await storage.appendOps([invoiceOp('op-a', 1)]);
    await storage.appendOps([invoiceOp('op-a', 1), invoiceOp('op-b', 2)]);
    expect(await storage.readOps()).toHaveLength(2);
  });

  it('two DIFFERENT ops under one id throw instead of silently dropping one', async () => {
    // Ids are content-addressed; a collision with a divergent payload is an
    // id-derivation bug, and the log must refuse rather than lose a human decision.
    await storage.appendOps([invoiceOp('op-a', 1)]);
    const divergent = { ...invoiceOp('op-a', 1), clientName: 'Different Client' };
    await expect(storage.appendOps([divergent])).rejects.toThrow(/op-a.*DIFFERENT payload/i);
    expect(await storage.readOps()).toHaveLength(1);
  });

  it('serializes concurrent port calls -- interleaved transactions cannot corrupt each other', async () => {
    // Without the internal queue this exact pair was demonstrated to fail with
    // "cannot start a transaction within a transaction" on the shared connection.
    const ops: Op[] = [invoiceOp('op-a', 1), invoiceOp('op-b', 2), invoiceOp('op-c', 3)];
    const events = [
      event(),
      event({ signature: asSignature('sig-0002') }),
      event({ signature: asSignature('sig-0003') }),
    ];
    await Promise.all([storage.appendOps(ops), storage.putChainEvents(events)]);

    expect(await storage.readOps()).toHaveLength(3);
    expect(await storage.getChainEvents(WATCHED)).toHaveLength(3);
  });

  it('a corrupted row fails with the table and row named, not a bare SyntaxError', async () => {
    await storage.appendOps([invoiceOp('op-a', 1)]);
    db.prepare("UPDATE ops SET payload = 'not-json{{' WHERE id = ?").run('op-a');

    await expect(storage.readOps()).rejects.toThrow(/ops row \(id=op-a\)/);
  });

  it('clearProjection really deletes listed projection tables and nothing else', async () => {
    // Exercised with a real materialized table so the DELETE path is not vacuous.
    db.exec('CREATE TABLE invoice_views (id TEXT PRIMARY KEY)');
    db.exec("INSERT INTO invoice_views VALUES ('v1')");
    const withProjection = await createSqliteStorage(makeExecutor(db), {
      projectionTables: ['invoice_views'],
    });
    await withProjection.appendOps([invoiceOp('op-p', 1)]);

    await withProjection.clearProjection();

    expect(db.prepare('SELECT * FROM invoice_views').all()).toHaveLength(0);
    expect(await withProjection.readOps()).toHaveLength(1);
  });

  it('rejects a projection table name that is not a plain identifier', async () => {
    await expect(
      createSqliteStorage(makeExecutor(db), { projectionTables: ['ops; DROP TABLE ops'] }),
    ).rejects.toThrow(RangeError);
  });

  it('chain events key on (signature, instructionIndex, watchedAddress) -- both sides of an internal move coexist', async () => {
    const out = event({ direction: 'out', watchedAddress: asAddress('wallet-a') });
    const incoming = event({ direction: 'in', watchedAddress: asAddress('wallet-b') });
    await storage.putChainEvents([out, incoming]);

    expect(await storage.getChainEvents(asAddress('wallet-a'))).toEqual([out]);
    expect(await storage.getChainEvents(asAddress('wallet-b'))).toEqual([incoming]);
  });

  it('first write wins on a replayed event -- history reports were built on is never rewritten', async () => {
    const first = event({ memo: 'original' });
    await storage.putChainEvents([first]);
    await storage.putChainEvents([event({ memo: 'replayed with different payload' })]);

    const stored = await storage.getChainEvents(WATCHED);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.memo).toBe('original');
  });

  it('retrieval order is deterministic: recency, then identity', async () => {
    const a = event({ signature: asSignature('sig-b'), slot: 50 });
    const b = event({ signature: asSignature('sig-a'), slot: 200 });
    const c = event({ signature: asSignature('sig-a'), slot: 200, instructionIndex: 2 });
    await storage.putChainEvents([a, b, c]);
    expect((await storage.getChainEvents(WATCHED)).map((e) => [e.signature, e.instructionIndex])).toEqual([
      ['sig-a', 0],
      ['sig-a', 2],
      ['sig-b', 0],
    ]);
  });

  it('checkpoints upsert and return null when absent', async () => {
    expect(await storage.getCheckpoint(WATCHED)).toBeNull();

    const checkpoint = {
      address: WATCHED,
      oldestSeen: asSignature('sig-old'),
      newestSeen: asSignature('sig-new'),
      complete: false,
      updatedAt: asUnixSeconds(1_760_000_000),
    };
    await storage.putCheckpoint(checkpoint);
    await storage.putCheckpoint({ ...checkpoint, complete: true });
    expect(await storage.getCheckpoint(WATCHED)).toEqual({ ...checkpoint, complete: true });
  });

  it('clearProjection leaves the op log, the event cache, and checkpoints untouched', async () => {
    await storage.appendOps([invoiceOp('op-a', 1)]);
    await storage.putChainEvents([event()]);
    await storage.putCheckpoint({
      address: WATCHED,
      oldestSeen: null,
      newestSeen: null,
      complete: false,
      updatedAt: asUnixSeconds(1),
    });

    await storage.clearProjection();

    expect(await storage.readOps()).toHaveLength(1);
    expect(await storage.getChainEvents(WATCHED)).toHaveLength(1);
    expect(await storage.getCheckpoint(WATCHED)).not.toBeNull();
  });

  it('survives a restart: close the file, reopen, everything is still there', async () => {
    const ops: Op[] = [invoiceOp('op-a', 1)];
    await storage.appendOps(ops);
    await storage.putChainEvents([event()]);
    db.close();

    // "Restart": a fresh connection and a fresh adapter over the same file. The
    // schema DDL re-runs and must be idempotent.
    db = new OpenDatabase(join(dir, 'test.db'));
    storage = await createSqliteStorage(makeExecutor(db));

    expect(await storage.readOps()).toEqual(ops);
    expect(await storage.getChainEvents(WATCHED)).toHaveLength(1);
  });

  it('rebuild() from core runs against this real adapter and matches a live fold (D4, app half)', async () => {
    await storage.appendOps([
      { type: 'address-watched', id: 'op-w', at: asUnixSeconds(1), address: WATCHED, label: 'Main' },
      invoiceOp('op-a', 2),
      {
        type: 'match-confirmed',
        id: 'op-m',
        at: asUnixSeconds(3),
        invoiceId: 'inv-op-a',
        signature: asSignature('sig-0001'),
        instructionIndex: 0,
        via: 'reference',
      },
    ]);
    await storage.putChainEvents([event(), event({ signature: asSignature('sig-0002'), slot: 90 })]);

    const live = project(await storage.readOps(), await storage.getChainEvents(WATCHED));
    const rebuilt = await rebuild(storage);

    expect(rebuilt).toEqual(live);
    expect(rebuilt.invoices[0]!.status).toBe('paid');
    expect(rebuilt.unmatchedEvents).toHaveLength(1);
  });
});
