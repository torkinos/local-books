/**
 * Local cache for NBG daily rates (T23), over the same SqlExecutor seam as T6.
 *
 * One row per requested calendar date. INSERT OR IGNORE deliberately makes the first
 * write win, the same audit-trail stance as chain_events: a rate a filing already
 * used must never be rewritten by a later re-fetch, even if NBG restates the day.
 * The weekend/holiday dual-write in adapters/rates.ts leans on this too -- caching
 * Friday's rate under both the requested Sunday and Friday itself is only safe
 * because a subsequent direct Friday fetch cannot overwrite either row.
 *
 * Reads are validated: this string multiplies income amounts (value/index.ts does
 * exact decimal arithmetic on it), so a torn or hand-edited row must fail findably
 * rather than value income at garbage.
 */
import type { UnixSeconds } from '@local-books/core';
import { asUnixSeconds } from '@local-books/core';
import type { SqlExecutor } from './sqliteStorage.js';
import { StorageCorruptionError } from './sqliteStorage.js';

export interface RateCacheEntry {
  /** Exact decimal string, verbatim from NBG's rateFormated. Never a float. */
  readonly rate: string;
  /** UTC midnight of the date the rate is officially effective from. */
  readonly rateDate: UnixSeconds;
  /** When WE obtained it -- provenance for the audit columns, not freshness. */
  readonly fetchedAt: UnixSeconds;
}

export interface RateCache {
  get(dateKey: string): Promise<RateCacheEntry | null>;
  /** First write wins (INSERT OR IGNORE) -- see module comment. */
  put(dateKey: string, entry: RateCacheEntry): Promise<void>;
}

const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export async function createRateCache(db: SqlExecutor): Promise<RateCache> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS rates (
      date_key TEXT PRIMARY KEY,
      rate TEXT NOT NULL,
      rate_date INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL
    )`,
  );

  // Same one-writer funnel as sqliteStorage.ts: the executor is a single shared
  // connection, and interleaved statements from concurrent valuations must queue.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    get(dateKey: string): Promise<RateCacheEntry | null> {
      return serialized(async () => {
        const { rows } = await db.execute(
          'SELECT rate, rate_date, fetched_at FROM rates WHERE date_key = ?',
          [dateKey],
        );
        const row = rows[0];
        if (row === undefined) return null;
        const rate = row['rate'];
        const rateDate = row['rate_date'];
        const fetchedAt = row['fetched_at'];
        if (typeof rate !== 'string' || !DECIMAL_STRING.test(rate)) {
          throw new StorageCorruptionError(
            'rates',
            `date_key=${dateKey}`,
            `not a plain decimal rate: ${JSON.stringify(rate)}`,
          );
        }
        // The adapter refuses zero rates before caching; a zero here is a corrupt
        // row, and serving it would value that day's income at 0.00 forever.
        if (/^0+(\.0+)?$/.test(rate)) {
          throw new StorageCorruptionError('rates', `date_key=${dateKey}`, 'rate is zero');
        }
        if (typeof rateDate !== 'number' || typeof fetchedAt !== 'number') {
          throw new StorageCorruptionError('rates', `date_key=${dateKey}`, 'non-numeric timestamp');
        }
        return { rate, rateDate: asUnixSeconds(rateDate), fetchedAt: asUnixSeconds(fetchedAt) };
      });
    },

    put(dateKey: string, entry: RateCacheEntry): Promise<void> {
      return serialized(async () => {
        await db.execute(
          'INSERT OR IGNORE INTO rates (date_key, rate, rate_date, fetched_at) VALUES (?, ?, ?, ?)',
          [dateKey, entry.rate, entry.rateDate, entry.fetchedAt],
        );
      });
    },
  };
}
