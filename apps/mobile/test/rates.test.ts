/**
 * T23 tests: NBG RatePort adapter + SQLite cache, against real SQLite (node:sqlite)
 * and a scripted fetch. The wire fixtures are pinned VERBATIM from a live probe of
 * nbg.gov.ge on 2026-09-01 -- including NBG's weekend behaviour, where a Sunday
 * request returns the Friday body unchanged (the Friday rate IS the official
 * weekend rate, validFromDate <= requested date). What stays a live check is the
 * endpoint itself: rates.nbg.integration.test.ts, env-gated.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

// Vite strips the node: prefix and then cannot resolve `sqlite` (a node:-only
// builtin), so the module is loaded through the runtime instead of the bundler.
const { DatabaseSync: OpenDatabase } = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(name: 'node:sqlite'): { DatabaseSync: new (path: string) => DatabaseSync };
    };
  }
).process.getBuiltinModule('node:sqlite');
import type { RatePort } from '@local-books/core';
import { asFiatCode, asUnixSeconds } from '@local-books/core';
import { createRateCache, type RateCache } from '../src/storage/rateCache.js';
import { StorageCorruptionError, type SqlExecutor } from '../src/storage/sqliteStorage.js';
import {
  NBG_SOURCE,
  NbgHttpError,
  NbgResponseError,
  RateUnavailableOfflineError,
  UnsupportedFiatError,
  makeNbgRatePort,
} from '../src/adapters/rates.js';
import { fixedClock } from './helpers/syncFakes.js';

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

const GEL = asFiatCode('GEL');

// Monday 2026-08-31 09:00Z: "today" for every test clock unless stated.
const NOW = Date.UTC(2026, 7, 31, 9) / 1000;
const THURSDAY_NOON = asUnixSeconds(Date.UTC(2026, 7, 27, 12) / 1000); // 2026-08-27
const FRIDAY_NOON = asUnixSeconds(Date.UTC(2026, 7, 28, 12) / 1000); // 2026-08-28
const SUNDAY_NOON = asUnixSeconds(Date.UTC(2026, 7, 30, 12) / 1000); // 2026-08-30
const FUTURE_NOON = asUnixSeconds(Date.UTC(2026, 8, 15, 12) / 1000); // 2026-09-15
const FRIDAY_MIDNIGHT = Date.UTC(2026, 7, 28) / 1000;

// Live response for ?currencies=USD&date=2026-08-28, pinned byte-for-byte. NBG
// returns the SAME body for date=2026-08-30 (Sunday): latest rate effective on or
// before the requested date.
const NBG_FRIDAY_BODY =
  '[{"date":"2026-08-28T00:00:00.000Z","currencies":[{"code":"USD","quantity":1,' +
  '"rateFormated":"2.6125","diffFormated":"0.0070","rate":2.6125,"name":"US Dollar",' +
  '"diff":-0.0070,"date":"2026-08-27T17:01:01.913Z",' +
  '"validFromDate":"2026-08-28T00:00:00.000Z"}]}]';

/** The pinned body with fields of the USD entry overridden (or removed via undefined). */
function nbgBody(overrides: Record<string, unknown>): string {
  const day = (JSON.parse(NBG_FRIDAY_BODY) as Array<{ currencies: Record<string, unknown>[] }>)[0]!;
  day.currencies[0] = { ...day.currencies[0], ...overrides };
  return JSON.stringify([day]);
}

function fetchReturning(body: string, status = 200): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    calls.push(String(input));
    return new Response(body, { status });
  }) as typeof fetch;
  return { impl, calls };
}

const offlineFetch = (async () => {
  throw new TypeError('Network request failed');
}) as typeof fetch;

describe('NBG rate adapter (T23)', () => {
  let db: DatabaseSync;
  let cache: RateCache;

  beforeEach(async () => {
    db = new OpenDatabase(':memory:');
    cache = await createRateCache(makeExecutor(db));
  });

  afterEach(() => {
    db.close();
  });

  function makePort(fetchImpl: typeof fetch, opts: { at?: number; timeoutMs?: number } = {}): RatePort {
    return makeNbgRatePort({
      cache,
      fetchImpl,
      clock: fixedClock(opts.at ?? NOW),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
  }

  it('returns rateFormated VERBATIM with full provenance, asking NBG for the requested date', async () => {
    const { impl, calls } = fetchReturning(NBG_FRIDAY_BODY);
    const quote = await makePort(impl).getUsdRate(GEL, FRIDAY_NOON);

    expect(quote).toEqual({
      rate: '2.6125',
      source: NBG_SOURCE,
      rateDate: FRIDAY_MIDNIGHT,
      fetchedAt: NOW,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('nbg.gov.ge');
    expect(calls[0]).toContain('currencies=USD');
    expect(calls[0]).toContain('date=2026-08-28');
  });

  it('a weekend request accepts the Friday rate and records rateDate = Friday', async () => {
    // NBG's official rate for the weekend IS Friday's (validFromDate <= requested),
    // so this is the contract's "effective on that date", not substitution -- and
    // the quote must say so via rateDate.
    const { impl, calls } = fetchReturning(NBG_FRIDAY_BODY);
    const quote = await makePort(impl).getUsdRate(GEL, SUNDAY_NOON);

    expect(calls[0]).toContain('date=2026-08-30');
    expect(quote.rate).toBe('2.6125');
    expect(quote.rateDate).toBe(FRIDAY_MIDNIGHT);
  });

  it('the float `rate` field is NEVER the source of the quote', async () => {
    const { impl } = fetchReturning(nbgBody({ rate: 2.6124999 }));
    const quote = await makePort(impl).getUsdRate(GEL, FRIDAY_NOON);
    expect(quote.rate).toBe('2.6125');
  });

  it('a cache hit never fetches, and fetchedAt is the CACHED acquisition time', async () => {
    await makePort(fetchReturning(NBG_FRIDAY_BODY).impl).getUsdRate(GEL, FRIDAY_NOON);

    // Different clock, different (poisoned) wire body: only the cache can explain
    // the identical quote.
    const later = fetchReturning(nbgBody({ rateFormated: '9.9999' }));
    const quote = await makePort(later.impl, { at: NOW + 86_400 }).getUsdRate(GEL, FRIDAY_NOON);

    expect(later.calls).toHaveLength(0);
    expect(quote).toEqual({
      rate: '2.6125',
      source: NBG_SOURCE,
      rateDate: FRIDAY_MIDNIGHT,
      fetchedAt: NOW,
    });
  });

  it('offline with the date cached serves the cached rate', async () => {
    await makePort(fetchReturning(NBG_FRIDAY_BODY).impl).getUsdRate(GEL, FRIDAY_NOON);
    const quote = await makePort(offlineFetch).getUsdRate(GEL, FRIDAY_NOON);
    expect(quote.rate).toBe('2.6125');
  });

  it('offline with NOTHING cached throws the actionable error, never a neighbouring day', async () => {
    // A different day IS cached -- it must not be substituted.
    await cache.put('2026-08-27', {
      rate: '2.6055',
      rateDate: asUnixSeconds(Date.UTC(2026, 7, 27) / 1000),
      fetchedAt: asUnixSeconds(NOW),
    });

    const error = await makePort(offlineFetch)
      .getUsdRate(GEL, FRIDAY_NOON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateUnavailableOfflineError);
    expect((error as Error).message).toContain('2026-08-28');
    expect((error as Error).message).toMatch(/cached/i);
    expect((error as Error).message).toMatch(/connect/i);
  });

  it('a future date throws WITHOUT fetching -- NBG would answer it with today\'s rate', async () => {
    const { impl, calls } = fetchReturning(NBG_FRIDAY_BODY);
    await expect(makePort(impl).getUsdRate(GEL, FUTURE_NOON)).rejects.toThrow(RangeError);
    await expect(makePort(impl).getUsdRate(GEL, FUTURE_NOON)).rejects.toThrow(/future date/);
    expect(calls).toHaveLength(0);
  });

  it('a non-GEL fiat throws UnsupportedFiatError without touching cache or network', async () => {
    const { impl, calls } = fetchReturning(NBG_FRIDAY_BODY);
    const error = await makePort(impl)
      .getUsdRate(asFiatCode('USD'), FRIDAY_NOON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFiatError);
    expect((error as Error).message).toMatch(/GEL only/);
    expect(calls).toHaveLength(0);
  });

  it('quantity !== 1 throws naming the quantity instead of dividing a money string', async () => {
    const { impl } = fetchReturning(nbgBody({ quantity: 100 }));
    const error = await makePort(impl)
      .getUsdRate(GEL, FRIDAY_NOON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NbgResponseError);
    expect((error as Error).message).toMatch(/quantity is 100/);
  });

  it('a malformed rateFormated throws instead of quoting garbage', async () => {
    const { impl } = fetchReturning(nbgBody({ rateFormated: '2,6125' }));
    await expect(makePort(impl).getUsdRate(GEL, FRIDAY_NOON)).rejects.toThrow(/rateFormated/);
  });

  it('validFromDate AFTER the requested date throws -- NBG claims no rate was effective', async () => {
    // The pinned body is valid from Friday; asking for Thursday with it must refuse.
    const { impl } = fetchReturning(NBG_FRIDAY_BODY);
    const error = await makePort(impl)
      .getUsdRate(GEL, THURSDAY_NOON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NbgResponseError);
    expect((error as Error).message).toMatch(/valid from 2026-08-28/);
  });

  it('missing USD entry, empty array, and non-array JSON all throw labeled errors', async () => {
    for (const body of [nbgBody({ code: 'EUR' }), '[]', '{"message":"maintenance"}']) {
      await expect(
        makePort(fetchReturning(body).impl).getUsdRate(GEL, FRIDAY_NOON),
      ).rejects.toThrow(NbgResponseError);
    }
  });

  it('HTTP 429 and 500 throw labeled errors carrying the status', async () => {
    for (const status of [429, 500]) {
      const error = await makePort(fetchReturning('slow down', status).impl)
        .getUsdRate(GEL, FRIDAY_NOON)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NbgHttpError);
      expect((error as NbgHttpError).status).toBe(status);
    }
  });

  it('dual-write: a Sunday request caches Friday under Friday too, offline-serving it later', async () => {
    await makePort(fetchReturning(NBG_FRIDAY_BODY).impl).getUsdRate(GEL, SUNDAY_NOON);

    const quote = await makePort(offlineFetch).getUsdRate(GEL, FRIDAY_NOON);
    expect(quote.rate).toBe('2.6125');
    expect(quote.rateDate).toBe(FRIDAY_MIDNIGHT);
  });

  it('a torn cache row fails loudly and findably, never valuing income at garbage', async () => {
    db.prepare('INSERT INTO rates (date_key, rate, rate_date, fetched_at) VALUES (?, ?, ?, ?)').run(
      '2026-08-28',
      '2.61e0',
      FRIDAY_MIDNIGHT,
      NOW,
    );

    await expect(cache.get('2026-08-28')).rejects.toThrow(
      /Corrupted rates row \(date_key=2026-08-28\)/,
    );
    await expect(
      makePort(fetchReturning(NBG_FRIDAY_BODY).impl).getUsdRate(GEL, FRIDAY_NOON),
    ).rejects.toThrow(StorageCorruptionError);
  });

  it('first write wins in the cache: a re-fetch can never rewrite a rate a filing used', async () => {
    const first = {
      rate: '2.6125',
      rateDate: asUnixSeconds(FRIDAY_MIDNIGHT),
      fetchedAt: asUnixSeconds(NOW),
    };
    await cache.put('2026-08-28', first);
    await cache.put('2026-08-28', { ...first, rate: '9.9999' });
    expect(await cache.get('2026-08-28')).toEqual(first);
  });

  it('a hung request aborts at the timeout instead of hanging the valuation forever', async () => {
    const hangingFetch = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    const error = await makePort(hangingFetch, { timeoutMs: 25 })
      .getUsdRate(GEL, FRIDAY_NOON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateUnavailableOfflineError);
    expect((error as Error).message).toMatch(/aborted/);
  });
});

describe('NBG rate adapter — review hardening', () => {
  let db: DatabaseSync;
  let cache: RateCache;

  beforeEach(async () => {
    db = new OpenDatabase(':memory:');
    cache = await createRateCache(makeExecutor(db));
  });

  afterEach(() => {
    db.close();
  });

  function makePort(fetchImpl: typeof fetch, opts: { at?: number } = {}): RatePort {
    return makeNbgRatePort({ cache, fetchImpl, clock: fixedClock(opts.at ?? NOW) });
  }

  it('serves a repeated weekend request offline from the REQUESTED-date cache row', async () => {
    // Kills the surviving mutant that dual-writes only under the rate's own date:
    // the second ask is for the SAME Sunday, offline, and must hit the Sunday row.
    const { impl } = fetchReturning(NBG_FRIDAY_BODY);
    await makePort(impl).getUsdRate(GEL, SUNDAY_NOON);

    const offline = await makePort(offlineFetch).getUsdRate(GEL, SUNDAY_NOON);
    expect(offline.rate).toBe('2.6125');
    expect(offline.rateDate).toBe(FRIDAY_MIDNIGHT);
  });

  it('rejects a zero rate and caches nothing', async () => {
    // "0.0000" is publishable garbage, not a price: accepted, it would value the
    // whole day at 0.00 GEL as VALUED rows, and first-write-wins would keep it.
    const { impl } = fetchReturning(nbgBody({ rateFormated: '0.0000', rate: 0 }));
    await expect(makePort(impl).getUsdRate(GEL, FRIDAY_NOON)).rejects.toThrow(NbgResponseError);
    expect(await cache.get('2026-08-28')).toBeNull();
  });

  it('a zero rate planted in the cache fails loudly instead of valuing income at 0.00', async () => {
    db.prepare(
      'INSERT INTO rates (date_key, rate, rate_date, fetched_at) VALUES (?, ?, ?, ?)',
    ).run('2026-08-28', '0', FRIDAY_MIDNIGHT, NOW);
    await expect(cache.get('2026-08-28')).rejects.toThrow(StorageCorruptionError);
  });

  it('keys the rate date from the DATE PART, immune to zone-less validFromDate strings', async () => {
    // Date.parse would read '2026-08-28T00:00:00' (no zone) as device-LOCAL time; on
    // a UTC+4 device that is 20:00Z on the 27th, mis-keying the dual write a day
    // early and poisoning Thursday's cache row forever. The strict date-part parse
    // must key Friday regardless of the runtime timezone.
    const { impl } = fetchReturning(nbgBody({ validFromDate: '2026-08-28T00:00:00' }));
    const quote = await makePort(impl).getUsdRate(GEL, FRIDAY_NOON);
    expect(quote.rateDate).toBe(FRIDAY_MIDNIGHT);
    expect(await cache.get('2026-08-28')).not.toBeNull();
    expect(await cache.get('2026-08-27')).toBeNull();
  });

  it('rejects a validFromDate that is not a real calendar date', async () => {
    const { impl } = fetchReturning(nbgBody({ validFromDate: '2026-00-99T00:00:00.000Z' }));
    await expect(makePort(impl).getUsdRate(GEL, FRIDAY_NOON)).rejects.toThrow(NbgResponseError);
  });

  it('asks NBG for the GEORGIAN day of the receipt instant, not the UTC one', async () => {
    // 2026-08-27T21:00Z is already Friday 01:00 in Tbilisi: the filing's receipt
    // date is the 28th, so that is the official day whose rate must apply.
    const lateThursdayUtc = asUnixSeconds(Date.UTC(2026, 7, 27, 21) / 1000);
    const { impl, calls } = fetchReturning(NBG_FRIDAY_BODY);
    const quote = await makePort(impl).getUsdRate(GEL, lateThursdayUtc);
    expect(calls[0]).toContain('date=2026-08-28');
    expect(quote.rateDate).toBe(FRIDAY_MIDNIGHT);
  });
});
