/**
 * StoragePort over SQLite (T6), split from the native binding on purpose.
 *
 * All SQL lives here against a minimal `SqlExecutor`; the op-sqlite + SQLCipher
 * wiring is a few lines in opsqlite.ts. That split is what lets the test suite run
 * this exact schema and these exact statements against real SQLite (node:sqlite) in a
 * plain Node process -- the SQL is tested for real, and only the binding needs a
 * device. Core never sees any of it (D3: nothing in packages/core imports SQLite;
 * the purity guard enforces it).
 *
 * Source-of-truth boundary (D4, ports/index.ts):
 *   - `ops` is the append-only op log -- the only table that genuinely needs backup.
 *     INSERT OR IGNORE on the content-addressed id makes replay harmless; nothing
 *     ever UPDATEs or DELETEs a row.
 *   - `chain_events` is the RPC cache, keyed by eventIdentity
 *     (signature, instruction_index, watched_address) -- first write wins, matching
 *     mergeEvents' stored-wins semantics, and both sides of a transfer between two
 *     watched wallets coexist (D10).
 *   - `checkpoints` is backfill resume state (D8).
 *   - Projection tables are DISPOSABLE and the only thing clearProjection touches.
 *     v0.1 recomputes the projection in memory on launch, so the list is empty; any
 *     future materialized table MUST be added to PROJECTION_TABLES or rebuild()'s
 *     clear-and-refold contract silently stops covering it.
 */
import type {
  Address,
  BackfillCheckpoint,
  ChainEvent,
  Op,
  StoragePort,
} from '@local-books/core';
import { deserialize, serialize } from './serde.js';

export interface SqlExecutor {
  execute(
    sql: string,
    params?: readonly (string | number | null)[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

/** Materialized projection tables. Empty in v0.1 -- see module comment. */
export const PROJECTION_TABLES: readonly string[] = Object.freeze([]);

/** A stored row that no longer parses. Carries WHERE so one bad row is findable. */
export class StorageCorruptionError extends Error {
  constructor(table: string, rowKey: string, cause: unknown) {
    super(
      `Corrupted ${table} row (${rowKey}): ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'StorageCorruptionError';
  }
}

/** Two different ops arrived under one id -- the log refused to drop either silently. */
export class OpIdCollisionError extends Error {
  constructor(id: string) {
    super(
      `Op id ${id} already holds a DIFFERENT payload. Ids are content-addressed (makeOpId); ` +
        `two ops sharing an id means an id-derivation bug, and silently dropping one would ` +
        `corrupt the source of truth.`,
    );
    this.name = 'OpIdCollisionError';
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chain_events (
    signature TEXT NOT NULL,
    instruction_index INTEGER NOT NULL,
    watched_address TEXT NOT NULL,
    slot INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (signature, instruction_index, watched_address)
  )`,
  `CREATE INDEX IF NOT EXISTS chain_events_by_address
     ON chain_events (watched_address, slot DESC)`,
  `CREATE TABLE IF NOT EXISTS checkpoints (
    address TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  )`,
];

export interface SqliteStorageOptions {
  /** Override for tests and future materialized views. Defaults to PROJECTION_TABLES. */
  readonly projectionTables?: readonly string[];
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function createSqliteStorage(
  db: SqlExecutor,
  options: SqliteStorageOptions = {},
): Promise<StoragePort> {
  const projectionTables = options.projectionTables ?? PROJECTION_TABLES;
  for (const table of projectionTables) {
    // Table names are interpolated into DELETE below; only plain identifiers pass.
    if (!SQL_IDENTIFIER.test(table)) throw new RangeError(`Not a table identifier: ${table}`);
  }

  for (const statement of SCHEMA) await db.execute(statement);

  // One connection, so one writer at a time: every port method funnels through this
  // promise chain. Without it, two concurrent calls (backfill persisting a page while
  // the user confirms a match) interleave BEGIN/COMMIT/ROLLBACK on the shared
  // connection -- demonstrated to abort one batch and un-atomicize the other.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function inTransaction(work: () => Promise<void>): Promise<void> {
    await db.execute('BEGIN IMMEDIATE');
    try {
      await work();
      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  function parseRow<T>(table: string, rowKey: string, payload: unknown): T {
    try {
      return deserialize<T>(payload as string);
    } catch (cause) {
      // One torn row must be FINDABLE, not a bare SyntaxError that bricks the whole
      // ledger with no clue which of 10,000 rows is bad.
      throw new StorageCorruptionError(table, rowKey, cause);
    }
  }

  return {
    appendOps(ops: readonly Op[]): Promise<void> {
      return serialized(() =>
        inTransaction(async () => {
          for (const op of ops) {
            const payload = serialize(op);
            // OR IGNORE: ids are content-addressed (oplog/makeOpId), so a replayed op
            // is the same decision arriving twice and collapses to one row. But an
            // IGNORED insert whose stored payload DIFFERS is an id-derivation bug,
            // and dropping the op silently would corrupt the source of truth.
            await db.execute(
              'INSERT OR IGNORE INTO ops (id, at, type, payload) VALUES (?, ?, ?, ?)',
              [op.id, op.at, op.type, payload],
            );
            const { rows } = await db.execute('SELECT payload FROM ops WHERE id = ?', [op.id]);
            if (rows[0]?.['payload'] !== payload) throw new OpIdCollisionError(op.id);
          }
        }),
      );
    },

    readOps(): Promise<readonly Op[]> {
      return serialized(async () => {
        const { rows } = await db.execute('SELECT id, payload FROM ops ORDER BY seq');
        return rows.map((row) => parseRow<Op>('ops', `id=${row['id'] as string}`, row['payload']));
      });
    },

    putChainEvents(events: readonly ChainEvent[]): Promise<void> {
      return serialized(() =>
        inTransaction(async () => {
          for (const event of events) {
            // OR IGNORE: first write wins, matching mergeEvents -- a replayed page
            // must never rewrite history reports may already be built on.
            await db.execute(
              `INSERT OR IGNORE INTO chain_events
                 (signature, instruction_index, watched_address, slot, payload)
               VALUES (?, ?, ?, ?, ?)`,
              [
                event.signature,
                event.instructionIndex,
                event.watchedAddress,
                event.slot,
                serialize(event),
              ],
            );
          }
        }),
      );
    },

    getChainEvents(address: Address): Promise<readonly ChainEvent[]> {
      return serialized(async () => {
        // Deterministic total order (recency, then identity): retrieval order feeds
        // straight into projection state, and two reads must agree.
        const { rows } = await db.execute(
          `SELECT signature, instruction_index, payload FROM chain_events
           WHERE watched_address = ?
           ORDER BY slot DESC, signature ASC, instruction_index ASC`,
          [address],
        );
        return rows.map((row) =>
          parseRow<ChainEvent>(
            'chain_events',
            `signature=${row['signature'] as string}:${row['instruction_index'] as number}`,
            row['payload'],
          ),
        );
      });
    },

    getCheckpoint(address: Address): Promise<BackfillCheckpoint | null> {
      return serialized(async () => {
        const { rows } = await db.execute('SELECT payload FROM checkpoints WHERE address = ?', [
          address,
        ]);
        const payload = rows[0]?.['payload'];
        return payload === undefined
          ? null
          : parseRow<BackfillCheckpoint>('checkpoints', `address=${address}`, payload);
      });
    },

    putCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
      return serialized(async () => {
        await db.execute('INSERT OR REPLACE INTO checkpoints (address, payload) VALUES (?, ?)', [
          checkpoint.address,
          serialize(checkpoint),
        ]);
      });
    },

    clearProjection(): Promise<void> {
      // Projection tables ONLY (ports/index.ts): the op log is source of truth and
      // chain_events is the RPC cache rebuild() depends on staying warm (S1 priced a
      // re-fetch at minutes of quota).
      return serialized(() =>
        inTransaction(async () => {
          for (const table of projectionTables) {
            await db.execute(`DELETE FROM ${table}`);
          }
        }),
      );
    },
  };
}
