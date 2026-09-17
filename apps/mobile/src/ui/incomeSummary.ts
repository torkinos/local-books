/**
 * The pure half of the income screen (T26) and the CSV export (T25): everything the
 * screen shows and the export contains is decided here, where Node can test it. The
 * component renders this and nothing else, so "totals match the CSV to the cent" is a
 * property of one function's output, not of two code paths agreeing by luck.
 */
import type {
  Address,
  ChainEvent,
  IncomeStatement,
  MonthlyClientTotal,
  ProjectionState,
  UnixSeconds,
  Valuation,
} from '@local-books/core';
import {
  assembleIncomeRows,
  asUnixSeconds,
  buildIncomeStatement,
  isoDate,
  monthlyTotalsPerClient,
  toCsv,
} from '@local-books/core';
import { GEORGIA_UTC_OFFSET_SECONDS } from '../adapters/rates.js';
import { FIAT } from '../valuation.js';

export interface IncomeSummary {
  readonly statement: IncomeStatement;
  readonly monthly: readonly MonthlyClientTotal[];
  readonly csv: string;
}

/**
 * Full-history statement: periodStart 0, periodEnd past every event. The period is
 * half-open [start, end), so the end must clear the newest timestamp we can see --
 * and that is NOT always the device clock: blockTime is chain time, and a device
 * clock running behind would silently drop the freshest payment from screen and CSV
 * with no note. The end is therefore one past max(now, newest blockTime).
 *
 * `ownAddresses` (every address ever watched + every invoice payTo -- the caller
 * already collects this set to load events) marks incoming transfers from the user's
 * own wallets as internal moves, excluded from income and counted (internalCount).
 *
 * Days and months are labeled on the GEORGIAN calendar (+4h, no DST), matching the
 * receipt dates the NBG rates are keyed by -- a filing's receipt date is a Tbilisi
 * day, not a UTC one.
 *
 * Screen totals, monthly grouping, and CSV all derive from the ONE statement built
 * here; the test that sums the CSV column against the total pins that they agree.
 */
export function incomeSummary(
  state: ProjectionState,
  events: readonly ChainEvent[],
  valuations: ReadonlyMap<string, Valuation>,
  now: UnixSeconds,
  ownAddresses: ReadonlySet<Address> = new Set<Address>(),
): IncomeSummary {
  const rows = assembleIncomeRows(state, events, valuations);
  let latest: number = now;
  for (const event of events) {
    if (event.blockTime !== null && event.blockTime > latest) latest = event.blockTime;
  }
  const statement = buildIncomeStatement(rows, FIAT, asUnixSeconds(0), asUnixSeconds(latest + 1), {
    ownAddresses,
    calendarOffsetSeconds: GEORGIA_UTC_OFFSET_SECONDS,
  });
  return {
    statement,
    monthly: monthlyTotalsPerClient(statement),
    csv: toCsv(statement),
  };
}

/**
 * The quiet line explaining internal-transfer exclusions. Separate from
 * valuationNote because it is not a problem to fix -- just an exclusion that must
 * never be invisible (same stance as unvaluedCount).
 */
export function internalNote(internalCount: number): string | null {
  if (internalCount === 0) return null;
  const moves = `${internalCount} ${internalCount === 1 ? 'transfer' : 'transfers'}`;
  return `${moves} between your own wallets excluded — moving your own money is not income.`;
}

/** 'local-books-income-2026-01-15.csv' -- UTC export date; rows use the Georgian day. */
export function csvFilename(now: UnixSeconds): string {
  return `local-books-income-${isoDate(now)}.csv`;
}

/**
 * The one line explaining why the total omits rows. `null` when it omits nothing.
 *
 * Honest and actionable (T28): a fetch failure names the fix (connect, pull to
 * refresh) and carries the first underlying error; rows that were never attempted
 * (non-stablecoin income) say plainly that v0.1 does not value that token, rather
 * than hinting that retrying might help. No real-time promises in either.
 */
export function valuationNote(
  unvaluedCount: number,
  failures: number,
  firstError: string | null,
): string | null {
  if (unvaluedCount === 0) return null;

  // The two causes coexist in one statement (an offline day AND a SOL payment), and
  // each gets its own line: telling the owner of a non-stable row to reconnect would
  // promise that retrying helps when it never will.
  const fetchFailed = Math.min(failures, unvaluedCount);
  const unsupported = unvaluedCount - fetchFailed;
  const parts: string[] = [];
  if (fetchFailed > 0) {
    const rows = `${fetchFailed} ${fetchFailed === 1 ? 'payment' : 'payments'}`;
    const detail = firstError === null ? '' : ` (${firstError})`;
    parts.push(
      `${rows} not valued yet — official NBG rates could not be fetched. ` +
        `Connect to the internet and pull to refresh.${detail}`,
    );
  }
  if (unsupported > 0) {
    const rows = `${unsupported} ${unsupported === 1 ? 'payment' : 'payments'}`;
    parts.push(
      `${rows} in a token v0.1 does not value — only stablecoin income (USDC, USDT) ` +
        `is valued for now. Unvalued rows stay in the report without a GEL amount.`,
    );
  }
  return parts.join(' ');
}
