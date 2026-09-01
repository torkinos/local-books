/**
 * App-side valuation wiring: which chain events get valued, in what fiat, and what
 * happens when a rate cannot be fetched.
 *
 * Core's valueAtReceipt values ONE amount and throws on anything it cannot defend
 * (unsupported mint, unreachable rate). This module is the policy around it: pick the
 * rows that can appear as valued income, try each one, and never let a single bad row
 * sink the whole statement -- the report already knows how to surface unvalued rows
 * (unvaluedCount), which is strictly better than a screen that shows nothing.
 */
import type { ChainEvent, FiatCode, RatePort, RateQuote, Valuation } from '@local-books/core';
import { asFiatCode, eventKey, isStable, valueAtReceipt } from '@local-books/core';
import { receiptDateKey } from './adapters/rates.js';

/**
 * The v0.1 beachhead currency (PROJECT.md: Georgian freelancers filing in GEL).
 * One definition the whole app imports; multi-currency is a post-grant concern.
 */
export const FIAT: FiatCode = asFiatCode('GEL');

export interface ValueEventsResult {
  /** Keyed by core's eventKey -- exactly what assembleIncomeRows expects. */
  readonly valuations: ReadonlyMap<string, Valuation>;
  /** Rows that were attempted and failed (rate unreachable). Skipped rows don't count. */
  readonly failures: number;
  /** The first failure's message, for the one actionable line the UI shows. */
  readonly firstError: string | null;
}

/**
 * Value every event that could appear as valued income: incoming, succeeded, with a
 * blockTime to look a rate up for, in a mint we treat as 1 USD. Everything else is
 * skipped silently -- an outgoing transfer or a non-stable token is not a valuation
 * *failure*, it is simply outside v0.1's valuation scope, and the report's
 * unvaluedCount already tells the user which income rows lack a value.
 *
 * Sequential on purpose: the rate adapter caches per (fiat, date), so repeats within a
 * statement are free, and the NBG endpoint deserves gentleness over parallel fetches
 * of the same handful of dates. Each failure is caught per event so one unreachable
 * rate leaves one unvalued row, not an empty statement.
 *
 * Failures are memoized per receipt day for the run: the adapter's cache only
 * remembers SUCCESSES, so without this a black-hole network would re-fetch the same
 * failing date once per event, each attempt bounded only by the request timeout -- a
 * month of payments could take minutes to fail. One verdict per day, shared.
 */
export async function valueEvents(
  events: readonly ChainEvent[],
  rates: RatePort,
  fiat: FiatCode,
): Promise<ValueEventsResult> {
  const valuations = new Map<string, Valuation>();
  let failures = 0;
  let firstError: string | null = null;

  const quoteMemo = new Map<string, Promise<RateQuote>>();
  const memoizedRates: RatePort = {
    getUsdRate(f, date) {
      const key = `${f}|${receiptDateKey(date)}`;
      let quote = quoteMemo.get(key);
      if (quote === undefined) {
        quote = rates.getUsdRate(f, date);
        // Every awaiter handles rejection below; this stops Node/Hermes from
        // flagging the memoized promise as unhandled between iterations.
        quote.catch(() => undefined);
        quoteMemo.set(key, quote);
      }
      return quote;
    },
  };

  for (const event of events) {
    if (event.direction !== 'in' || !event.succeeded || event.blockTime === null) continue;
    if (!isStable(event.amount)) continue;

    try {
      valuations.set(
        eventKey(event),
        await valueAtReceipt(event.amount, event.blockTime, fiat, memoizedRates),
      );
    } catch (error) {
      failures += 1;
      if (firstError === null) {
        firstError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return { valuations, failures, firstError };
}
