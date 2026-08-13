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

export function buildIncomeStatement(
  rows: readonly IncomeRow[],
  fiat: FiatCode,
  periodStart: UnixSeconds,
  periodEnd: UnixSeconds,
): IncomeStatement {
  const inPeriod = rows.filter((row) => {
    const t = row.event.blockTime;
    return t !== null && t >= periodStart && t <= periodEnd && row.event.direction === 'in';
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
        .map(csvEscape)
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

/** `YYYY-MM-DD` in UTC. Deliberately not locale-dependent. */
export function isoDate(seconds: UnixSeconds): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function parseFiat(value: string): bigint {
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const scaled = BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
  return value.startsWith('-') ? -scaled : scaled;
}
