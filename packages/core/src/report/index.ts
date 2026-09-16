/**
 * Reports and CSV export (PROJECT.md lines 101-104, v0.1 item 5).
 *
 * Core builds report *models* and CSV text. It does not render PDFs -- that goes
 * through DocPort so the same income statement can be rendered by expo-print today and
 * by whatever the desktop surface uses later.
 *
 * v0.1 ships the generic CSV. The Koinly-compatible variant is deferred (line 126).
 */
import type { Address, ChainEvent, FiatCode, UnixSeconds, Valuation } from '../types/index.js';
import { asUnixSeconds } from '../types/index.js';
import type { ProjectionState } from '../projection/index.js';
import { dedupEvents, eventKey } from '../normalize/index.js';
import { formatUnits } from '../value/index.js';

export interface IncomeRow {
  readonly event: ChainEvent;
  /** Absent when valuation failed or has not run; the row still belongs in the report. */
  readonly valuation: Valuation | null;
  readonly invoiceId: string | null;
  readonly clientName: string | null;
  /** Always null in v0.1: nothing writes `category-assigned` yet (D23). */
  readonly category: string | null;
}

export interface IncomeStatement {
  readonly fiat: FiatCode;
  readonly periodStart: UnixSeconds;
  readonly periodEnd: UnixSeconds;
  readonly rows: readonly IncomeRow[];
  /** Decimal string. Sum of valued rows only. */
  readonly totalFiat: string;
  /**
   * Rows that could not be valued. Surfaced rather than hidden: a total that silently
   * omits rows is worse than one that says what it left out.
   */
  readonly unvaluedCount: number;
  /**
   * Incoming rows excluded because the money came from one of the user's OWN
   * addresses (`ownAddresses`). Surfaced for the same reason as `unvaluedCount`:
   * the exclusion is correct, but it must never be invisible.
   */
  readonly internalCount: number;
  /** The calendar the statement's day/month labels use. See BuildStatementOptions. */
  readonly calendarOffsetSeconds: number;
}

export interface BuildStatementOptions {
  /**
   * The user's own addresses — every address ever watched plus every invoice payTo
   * (the same set rebuild() loads events for). An incoming transfer whose
   * counterparty is one of them is the in-leg of a move between the user's own
   * wallets: D10 keeps both legs as ledger facts, but booking that leg as INCOME
   * would inflate the turnover a Georgian filing pays tax on. Excluded and counted
   * in `internalCount`, never summed or exported.
   */
  readonly ownAddresses?: ReadonlySet<Address>;
  /**
   * Seconds added to UTC before taking a calendar date for the CSV `date` column
   * and the monthly grouping. A filing's "receipt date" is a LOCAL calendar day —
   * for the Georgian beachhead +4h (no DST since 2005) — while blockTime is an
   * instant; without this, a payment landing 00:00–04:00 Tbilisi books to the
   * previous day. Default 0 keeps plain-UTC behavior. Rate dates are untouched:
   * they are already calendar days, not instants.
   */
  readonly calendarOffsetSeconds?: number;
}

/** Calendar day of an instant under the statement's reporting calendar. */
function calendarDay(seconds: UnixSeconds, offsetSeconds: number): string {
  return isoDate(asUnixSeconds(seconds + offsetSeconds));
}

/**
 * Join chain events with what the projection knows about them: which invoice a
 * payment settled (and so which client it came from), any assigned category, and the
 * valuation the caller computed. One row per event; `buildIncomeStatement` does the
 * filtering, so screen and CSV are guaranteed to start from the same joined set.
 *
 * Invoice attribution applies to `direction: 'in'` events only. The matcher only ever
 * confirms incoming payments, but `eventKey` deliberately omits the watched address
 * (D10 keeps both sides of a transfer between two watched wallets), so without the
 * direction gate the sender's `out` twin would inherit the recipient's invoice.
 *
 * `valuations` is keyed by `eventKey`. A missing entry means the row could not be
 * valued (unsupported mint, or the rate was unreachable); it stays in the report and
 * is counted by `unvaluedCount` rather than dropped.
 */
export function assembleIncomeRows(
  state: ProjectionState,
  events: readonly ChainEvent[],
  valuations: ReadonlyMap<string, Valuation>,
): readonly IncomeRow[] {
  const invoiceByEvent = new Map<string, { invoiceId: string; clientName: string }>();
  for (const view of state.invoices) {
    for (const payment of view.payments) {
      invoiceByEvent.set(eventKey(payment), {
        invoiceId: view.invoice.invoiceId,
        clientName: view.invoice.clientName,
      });
    }
  }

  return dedupEvents(events).map((event) => {
    const key = eventKey(event);
    const matched = event.direction === 'in' ? invoiceByEvent.get(key) : undefined;
    return {
      event,
      valuation: valuations.get(key) ?? null,
      invoiceId: matched?.invoiceId ?? null,
      clientName: matched?.clientName ?? null,
      category: state.categories.get(key) ?? null,
    };
  });
}

/**
 * The period is half-open: `[periodStart, periodEnd)`. Consecutive statements built
 * the natural way (start-of-month to start-of-next-month) therefore never both claim
 * an event landing exactly on the boundary -- inclusive-inclusive would count a
 * payment stamped 00:00:00 on the 1st in two months and overstate annual turnover.
 *
 * Failed transactions are excluded: they moved no money, and a payment that failed
 * once and succeeded on retry must appear in the books exactly once.
 */
export function buildIncomeStatement(
  rows: readonly IncomeRow[],
  fiat: FiatCode,
  periodStart: UnixSeconds,
  periodEnd: UnixSeconds,
  options: BuildStatementOptions = {},
): IncomeStatement {
  const own = options.ownAddresses ?? new Set<Address>();
  const calendarOffsetSeconds = options.calendarOffsetSeconds ?? 0;

  let internal = 0;
  // One instruction has one destination, so two INCOMING rows sharing an eventKey
  // can only be the same money seen from two watched addresses -- a wallet and its
  // own token account both on the watch list. The add screen refuses token-account
  // addresses; this is the money-side guarantee that a payment is summed once even
  // if such a pair reaches the books some other way (D19).
  const counted = new Set<string>();
  const inPeriod = rows.filter((row) => {
    const t = row.event.blockTime;
    const counts =
      row.event.succeeded &&
      t !== null &&
      t >= periodStart &&
      t < periodEnd &&
      row.event.direction === 'in';
    if (!counts) return false;
    const key = eventKey(row.event);
    if (counted.has(key)) return false;
    counted.add(key);
    if (row.event.counterparty !== null && own.has(row.event.counterparty)) {
      internal += 1;
      return false;
    }
    return true;
  });

  let total = 0n;
  let unvalued = 0;
  for (const row of inPeriod) {
    if (!row.valuation) {
      unvalued += 1;
      continue;
    }
    total += parseFiat(row.valuation.fiatAmount);
  }

  return {
    fiat,
    periodStart,
    periodEnd,
    rows: inPeriod,
    totalFiat: formatUnits(total, 2),
    unvaluedCount: unvalued,
    internalCount: internal,
    calendarOffsetSeconds,
  };
}

/**
 * Monthly totals per client (T26; the income statement screen reads exactly this).
 *
 * Groups the statement's own rows, so a total here is by construction the same set of
 * rows the CSV exports -- the "matches the CSV to the cent" property is structural,
 * and the test that sums the CSV column pins it.
 */
export interface MonthlyClientTotal {
  /** `YYYY-MM`, UTC -- same calendar the CSV dates use. */
  readonly month: string;
  readonly clientName: string | null;
  /** Decimal string, 2 dp. Sum of valued rows only. */
  readonly totalFiat: string;
  readonly rowCount: number;
  /** Rows in this group that lack a valuation; reported, never silently dropped. */
  readonly unvaluedCount: number;
}

export function monthlyTotalsPerClient(statement: IncomeStatement): readonly MonthlyClientTotal[] {
  const groups = new Map<string, { total: bigint; rows: number; unvalued: number }>();

  for (const row of statement.rows) {
    // Rows without blockTime never enter a statement (buildIncomeStatement requires a
    // time to place them in the period), so this guard is for the type, not for data.
    if (row.event.blockTime === null) continue;
    const month = calendarDay(row.event.blockTime, statement.calendarOffsetSeconds).slice(0, 7);
    const key = `${month}\u0000${row.clientName ?? ''}`;
    const group = groups.get(key) ?? { total: 0n, rows: 0, unvalued: 0 };
    group.rows += 1;
    if (row.valuation) {
      group.total += parseFiat(row.valuation.fiatAmount);
    } else {
      group.unvalued += 1;
    }
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const [month = '', client = ''] = key.split('\u0000');
      return {
        month,
        clientName: client === '' ? null : client,
        totalFiat: formatUnits(group.total, 2),
        rowCount: group.rows,
        unvaluedCount: group.unvalued,
      };
    })
    .sort((a, b) =>
      a.month !== b.month
        ? a.month.localeCompare(b.month)
        : (a.clientName ?? '').localeCompare(b.clientName ?? ''),
    );
}

/**
 * Generic CSV export.
 *
 * Columns carry the audit trail -- rate, rate source, rate date -- alongside the
 * amounts, because the export is what gets handed to an accountant and it has to stand
 * on its own without the app.
 */
export const CSV_COLUMNS = [
  'date',
  'signature',
  'direction',
  'counterparty',
  'token',
  'amount',
  'fiat',
  'fiat_amount',
  'rate',
  'rate_source',
  'rate_date',
  'invoice_id',
  'client',
  'category',
  'memo',
] as const;

export function toCsv(statement: IncomeStatement): string {
  const lines = [CSV_COLUMNS.join(',')];

  for (const row of statement.rows) {
    lines.push(
      [
        row.event.blockTime === null
          ? ''
          : calendarDay(row.event.blockTime, statement.calendarOffsetSeconds),
        row.event.signature,
        row.event.direction,
        row.event.counterparty ?? '',
        row.event.amount.symbol ?? row.event.amount.mint ?? 'SOL',
        formatUnits(row.event.amount.raw, row.event.amount.decimals),
        row.valuation?.fiat ?? '',
        row.valuation?.fiatAmount ?? '',
        row.valuation?.rate ?? '',
        row.valuation?.source ?? '',
        row.valuation ? isoDate(row.valuation.rateDate) : '',
        row.invoiceId ?? '',
        row.clientName ?? '',
        row.category ?? '',
        row.event.memo ?? '',
      ]
        .map((cell) => csvEscape(neutralizeFormula(cell)))
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * RFC 4180 escaping.
 *
 * Memos and client names are free text and will eventually contain a comma, a quote,
 * or a newline. Getting this wrong corrupts the accountant's import in a way that is
 * hard to spot, so it is handled here rather than at the call site.
 */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Spreadsheet formula-injection guard.
 *
 * The CSV's designed consumer is Excel/Sheets on the accountant's machine, and the
 * memo column is written by whoever paid -- any stranger on Solana can attach
 * `=WEBSERVICE(...)` to a dust transfer at the watched address. Cells that a
 * spreadsheet would evaluate (leading =, +, @, tab, CR, or a minus that is not simply
 * a negative number) get a leading apostrophe, the standard force-text marker.
 * Negative amounts pass through untouched: they are the one legitimate leading-minus.
 */
export function neutralizeFormula(value: string): string {
  if (/^[=+@\t\r]/.test(value)) return `'${value}`;
  if (value.startsWith('-') && !/^-\d+(\.\d+)?$/.test(value)) return `'${value}`;
  return value;
}

/** `YYYY-MM-DD` in UTC. Deliberately not locale-dependent. */
export function isoDate(seconds: UnixSeconds): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * `fiatAmount` -> cents. Strict: valuations are minted exclusively by valueAtReceipt,
 * which emits exactly two decimal places, so anything else here is a corrupted record
 * -- and a corrupted amount must fail loudly, not be truncated toward zero (which
 * would contradict the half-up policy in value/index.ts) or coerced to 0.00 (which
 * would under-report income while `unvaluedCount` still says nothing was omitted).
 */
function parseFiat(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`Not a 2dp fiat amount: ${JSON.stringify(value)}`);
  const [, sign, whole, fraction = ''] = match;
  const scaled = BigInt(`${whole}${fraction.padEnd(2, '0')}`);
  return sign === '-' ? -scaled : scaled;
}
