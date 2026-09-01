/**
 * RatePort over the National Bank of Georgia daily rates (T23), cache-first.
 *
 * The ports contract is the whole design: "return the rate actually effective on
 * that date, or throw" (ports/index.ts). NBG's endpoint already speaks that
 * contract -- asked for a Sunday or a holiday it returns the latest rate whose
 * validFromDate is on or before the requested date, which IS the official rate for
 * that day (a Friday rate is NBG's rate for the weekend), not nearby-day
 * substitution. What this adapter must never do is invent that substitution
 * itself: offline with nothing cached for the date, it throws; it never serves a
 * neighbouring day's cached row.
 *
 * Rate strings are handled verbatim. NBG's JSON carries both a float `rate` and a
 * decimal string `rateFormated`; only the string is ever used -- floats on money
 * are banned repo-wide, and the string is what value/index.ts multiplies exactly.
 */
import type { ClockPort, FiatCode, RatePort, RateQuote, UnixSeconds } from '@local-books/core';
import { asUnixSeconds, isoDate } from '@local-books/core';
import type { RateCache } from '../storage/rateCache.js';

/** Recorded into every Valuation's provenance -- stable, human-meaningful. */
export const NBG_SOURCE = 'nbg.gov.ge/official-rates';

/** Georgia is fixed UTC+4 (DST abolished in 2005). NBG days are Georgian days. */
export const GEORGIA_UTC_OFFSET_SECONDS = 4 * 3600;

/**
 * The Georgian calendar day a receipt instant belongs to -- the receipt date a
 * Georgian filing uses. blockTime is an instant; taking its UTC date would book a
 * payment landing 00:00-04:00 Tbilisi to the previous day and value it at the
 * previous day's official rate.
 */
export function receiptDateKey(instant: UnixSeconds): string {
  return isoDate(asUnixSeconds(instant + GEORGIA_UTC_OFFSET_SECONDS));
}

const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
const DEFAULT_TIMEOUT_MS = 10_000;
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

/** v0.1 values income in GEL only; any other fiat is a wiring bug, not a fetch. */
export class UnsupportedFiatError extends Error {
  constructor(readonly fiat: string) {
    super(
      `Unsupported fiat ${JSON.stringify(fiat)}: NBG publishes GEL per USD, ` +
        `and v0.1 values income in GEL only.`,
    );
    this.name = 'UnsupportedFiatError';
  }
}

export class NbgHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`NBG rates: HTTP ${status} ${detail}`);
    this.name = 'NbgHttpError';
  }
}

/** NBG answered, but not in the shape we require -- never guess around it. */
export class NbgResponseError extends Error {
  constructor(detail: string) {
    super(`NBG rates: malformed response: ${detail}`);
    this.name = 'NbgResponseError';
  }
}

/**
 * Offline (or timed out) with nothing cached for the date. Actionable on purpose:
 * the valuation screen surfaces this message as-is.
 */
export class RateUnavailableOfflineError extends Error {
  constructor(
    readonly dateKey: string,
    cause: unknown,
  ) {
    super(
      `No exchange rate is cached for ${dateKey} and fetching it failed ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). ` +
        `Rates are fetched once from nbg.gov.ge and cached; connect to the internet ` +
        `and refresh, then try again. Another day's rate is never substituted.`,
    );
    this.name = 'RateUnavailableOfflineError';
  }
}

export interface NbgRatePortDeps {
  readonly cache: RateCache;
  /** Injection seam for tests; defaults to the platform fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly clock: ClockPort;
  readonly timeoutMs?: number;
}

export function makeNbgRatePort(deps: NbgRatePortDeps): RatePort {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchOfficial(
    dateKey: string,
  ): Promise<{ rate: string; rateDate: UnixSeconds; rateDateKey: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // clearTimeout in the finally so the BODY read stays under the timer too --
    // same hung-sync reasoning as rpc.ts: streaming fetch resolves at headers.
    try {
      const response = await doFetch(`${NBG_URL}?currencies=USD&date=${dateKey}`, {
        signal: controller.signal,
      }).catch((cause: unknown) => {
        // Only the request itself failing means "unreachable"; everything after
        // headers is a server-shape problem and gets its own labeled error.
        throw new RateUnavailableOfflineError(dateKey, cause);
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new NbgHttpError(response.status, detail);
      }
      const json: unknown = await response.json().catch((cause: unknown) => {
        throw new NbgResponseError(
          `body is not JSON (${cause instanceof Error ? cause.message : String(cause)})`,
        );
      });

      if (!Array.isArray(json)) throw new NbgResponseError(`expected an array, got ${typeof json}`);
      if (json.length === 0) throw new NbgResponseError('empty array -- no rate data for the date');
      const day: unknown = json[0];
      const currencies =
        typeof day === 'object' && day !== null
          ? (day as { currencies?: unknown }).currencies
          : undefined;
      if (!Array.isArray(currencies)) throw new NbgResponseError('missing currencies array');
      const usd = currencies.find(
        (c: unknown): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>)['code'] === 'USD',
      );
      if (usd === undefined) throw new NbgResponseError('no USD entry');

      // NBG quotes some currencies per 10/100 units. USD has always been per 1, but
      // if that ever changes, dividing a decimal money string is not worth the risk
      // -- refuse loudly and let a human look at what NBG actually published.
      const quantity = usd['quantity'];
      if (quantity !== 1) {
        throw new NbgResponseError(`USD quantity is ${String(quantity)}, expected 1`);
      }

      const rate = usd['rateFormated'];
      if (typeof rate !== 'string' || !DECIMAL_STRING.test(rate)) {
        throw new NbgResponseError(`rateFormated is not a plain decimal: ${JSON.stringify(rate)}`);
      }
      // A zero "rate" is publishable garbage, not a price: it would value every
      // payment on that date at 0.00 GEL, count them as VALUED (no banner), and
      // first-write-wins caching would make the under-report permanent.
      if (/^0+(\.0+)?$/.test(rate)) {
        throw new NbgResponseError(`rateFormated is zero: ${JSON.stringify(rate)}`);
      }

      // Take the DATE PART with a strict pattern, never Date.parse: a zone-less
      // timestamp ('2026-08-28T00:00:00') parses as device-LOCAL time, which on a
      // UTC+4 device lands 20:00 the previous day -- mis-keying the dual write and
      // poisoning the neighbouring day's cache row forever (first write wins).
      const validFromRaw = usd['validFromDate'];
      const dateMatch =
        typeof validFromRaw === 'string'
          ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(validFromRaw)
          : null;
      if (dateMatch === null) {
        throw new NbgResponseError(`validFromDate unparseable: ${JSON.stringify(validFromRaw)}`);
      }
      const rateDateKey = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      const monthNum = Number(dateMatch[2]);
      const dayNum = Number(dateMatch[3]);
      if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
        throw new NbgResponseError(`validFromDate is not a real date: ${JSON.stringify(validFromRaw)}`);
      }
      // validFromDate AFTER the requested date means NBG claims no rate was yet
      // effective on it -- returning this one would be exactly the substitution
      // the ports contract bans.
      if (rateDateKey > dateKey) {
        throw new NbgResponseError(
          `no rate effective on ${dateKey}: NBG's answer is valid from ${rateDateKey}`,
        );
      }
      const [y, m, d] = rateDateKey.split('-');
      const rateDate = asUnixSeconds(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000);
      return { rate, rateDate, rateDateKey };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getUsdRate(fiat: FiatCode, date: UnixSeconds): Promise<RateQuote> {
      if (fiat !== 'GEL') throw new UnsupportedFiatError(fiat);

      // The GEORGIAN day of the receipt instant, not the UTC one: the filing's
      // receipt date is a Tbilisi calendar day, and NBG's own dates are Georgian.
      const dateKey = receiptDateKey(date);
      // Before cache AND fetch: a receipt date in the future is a caller bug, and
      // NBG would happily answer it with today's rate -- which is then cached under
      // a date it was never effective on.
      const todayKey = receiptDateKey(deps.clock.now());
      if (dateKey > todayKey) {
        throw new RangeError(
          `Requested a rate for ${dateKey}, but no official rate exists yet for a ` +
            `future date (today is ${todayKey}).`,
        );
      }

      const cached = await deps.cache.get(dateKey);
      if (cached !== null) {
        return {
          rate: cached.rate,
          source: NBG_SOURCE,
          rateDate: cached.rateDate,
          fetchedAt: cached.fetchedAt,
        };
      }

      const { rate, rateDate, rateDateKey } = await fetchOfficial(dateKey);
      const fetchedAt = deps.clock.now();
      const entry = { rate, rateDate, fetchedAt };
      await deps.cache.put(dateKey, entry);
      // Dual write: a weekend/holiday answer is Friday's rate, so cache it under
      // Friday's own date too -- a later Friday request is then offline-served.
      if (rateDateKey !== dateKey) await deps.cache.put(rateDateKey, entry);

      return { rate, source: NBG_SOURCE, rateDate, fetchedAt };
    },
  };
}
