/**
 * Reports and CSV export (PROJECT.md lines 101-104, v0.1 item 5).
 *
 * Core builds report *models* and CSV text. It does not render PDFs -- that goes
 * through DocPort so the same income statement can be rendered by expo-print today and
 * by whatever the desktop surface uses later.
 *
 * v0.1 ships the generic CSV. The Koinly-compatible variant is deferred (line 126).
 */
import type { ChainEvent, FiatCode, UnixSeconds, Valuation } from '../types/index.js';
import { formatUnits } from '../value/index.js';

export interface IncomeRow {
  readonly event: ChainEvent;
  /** Absent when valuation failed or has not run; the row still belongs in the report. */
  readonly valuation: Valuation | null;
  readonly invoiceId: string | null;
  readonly clientName: string | null;
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
): IncomeStatement {
  const inPeriod = rows.filter((row) => {
    const t = row.event.blockTime;
    return (
      row.event.succeeded &&
      t !== null &&
      t >= periodStart &&
      t < periodEnd &&
      row.event.direction === 'in'
    );
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
    const month = isoDate(row.event.blockTime).slice(0, 7);
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
        row.event.blockTime === null ? '' : isoDate(row.event.blockTime),
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
