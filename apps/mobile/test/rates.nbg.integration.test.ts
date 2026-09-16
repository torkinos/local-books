/**
 * T23 acceptance, live half: the real NBG endpoint answers the shapes the adapter
 * pins. 2025-01-06 is a Georgian public holiday (Christmas Eve bridge) whose
 * official rate is the one valid from 2025-01-04 -- published history, so the
 * assertions are exact and stable.
 *
 * Network tests do not belong in CI, so this runs only when NBG_INTEGRATION is
 * set:  NBG_INTEGRATION=1 npx vitest run test/rates.nbg.integration.test.ts
 * Last verified from a real run: see the T23 note in TASKS.md.
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

// Same runtime-load trick as the other sqlite-backed tests: Vite cannot resolve
// the node:-only builtin through the bundler.
const { DatabaseSync: OpenDatabase } = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(name: 'node:sqlite'): { DatabaseSync: new (path: string) => DatabaseSync };
    };
  }
).process.getBuiltinModule('node:sqlite');
import type { ClockPort } from '@local-books/core';
import { asFiatCode, asUnixSeconds } from '@local-books/core';
import { createRateCache, type RateCache } from '../src/storage/rateCache.js';
import type { SqlExecutor } from '../src/storage/sqliteStorage.js';
import { makeNbgRatePort } from '../src/adapters/rates.js';

const GEL = asFiatCode('GEL');
const liveClock: ClockPort = { now: () => asUnixSeconds(Math.floor(Date.now() / 1000)) };

const HOLIDAY = asUnixSeconds(Date.UTC(2025, 0, 6, 12) / 1000); // Mon 2025-01-06
const SUNDAY = asUnixSeconds(Date.UTC(2025, 0, 5, 12) / 1000); // Sun 2025-01-05
const SATURDAY = asUnixSeconds(Date.UTC(2025, 0, 4, 12) / 1000); // Sat 2025-01-04
const RATE_DATE = Date.UTC(2025, 0, 4) / 1000;

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

const offlineFetch = (async () => {
  throw new TypeError('Network request failed');
}) as typeof fetch;

describe.skipIf(!process.env['NBG_INTEGRATION'])('NBG, live', () => {
  async function freshCache(): Promise<RateCache> {
    return createRateCache(makeExecutor(new OpenDatabase(':memory:')));
  }

  it('a holiday request returns the rate actually effective on it, and dual-writes the cache', async () => {
    const cache = await freshCache();
    const quote = await makeNbgRatePort({ cache, clock: liveClock }).getUsdRate(GEL, HOLIDAY);

    expect(quote.rate).toBe('2.8158');
    expect(quote.rateDate).toBe(RATE_DATE);
    expect(quote.source).toBe('nbg.gov.ge/official-rates');

    // The rate was also cached under its own validFrom date: the same cache now
    // serves 2025-01-04 fully offline.
    const offline = await makeNbgRatePort({ cache, fetchImpl: offlineFetch, clock: liveClock })
      .getUsdRate(GEL, SATURDAY);
    expect(offline.rate).toBe('2.8158');
    expect(offline.rateDate).toBe(RATE_DATE);
  }, 30_000);

  it('weekend carry: a Sunday request is served the rate valid from the day before', async () => {
    const quote = await makeNbgRatePort({ cache: await freshCache(), clock: liveClock })
      .getUsdRate(GEL, SUNDAY);
    expect(quote.rate).toBe('2.8158');
    expect(quote.rateDate).toBe(RATE_DATE);
  }, 30_000);
});
