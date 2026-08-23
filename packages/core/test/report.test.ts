/**
 * Report tests (T25/T26). The CSV assertions parse the output back through a strict
 * RFC 4180 reader rather than eyeballing strings: the accountant's spreadsheet is a
 * parser, so the test should be one too. The to-the-cent equality between the income
 * statement, the monthly per-client totals, and the summed CSV column is the property
 * the whole reporting layer promises.
 */
import { describe, expect, it } from 'vitest';
import {
  buildIncomeStatement,
  CSV_COLUMNS,
  csvEscape,
  monthlyTotalsPerClient,
  neutralizeFormula,
  toCsv,
} from '../src/report/index.js';
import type { IncomeRow } from '../src/report/index.js';
import { asFiatCode, asUnixSeconds } from '../src/types/index.js';
import type { Valuation } from '../src/types/index.js';
import { chainEvent, sig, usdc, T } from './fixtures/fakes.js';

const GEL = asFiatCode('GEL');

// 2026-01 and 2026-02, UTC.
const JAN_15 = asUnixSeconds(1_768_435_200);
const FEB_10 = asUnixSeconds(1_770_681_600);
const PERIOD_START = asUnixSeconds(1_767_225_600); // 2026-01-01
const PERIOD_END = asUnixSeconds(1_772_323_200); // 2026-03-01 00:00 UTC, EXCLUSIVE (half-open period)

function valuation(fiatAmount: string, rate = '2.7150'): Valuation {
  return {
    fiat: GEL,
    rate,
    fiatAmount,
    source: 'nbg.gov.ge/official-rates',
    rateDate: T(1_768_400_000),
    fetchedAt: T(1_768_400_100),
  };
}

function row(overrides: Partial<IncomeRow> & { event: IncomeRow['event'] }): IncomeRow {
  return { valuation: null, invoiceId: null, clientName: null, category: null, ...overrides };
}

const rows: IncomeRow[] = [
  row({
    event: chainEvent({ signature: sig(1), blockTime: JAN_15, memo: 'He said "thanks", twice\nsecond line' }),
    valuation: valuation('271.50'),
    invoiceId: 'inv-001',
    clientName: 'Acme Corp', // space in the name: the grouping must survive it
  }),
  row({
    event: chainEvent({ signature: sig(2), blockTime: JAN_15, amount: usdc('50') }),
    valuation: valuation('135.75'),
    invoiceId: 'inv-002',
    clientName: 'Acme Corp',
  }),
  row({
    event: chainEvent({ signature: sig(3), blockTime: FEB_10, amount: usdc('10') }),
    valuation: valuation('27.15'),
    clientName: 'Beta LLC',
  }),
  // Unvalued row: must be reported, never silently dropped from a total.
  row({ event: chainEvent({ signature: sig(4), blockTime: FEB_10, amount: usdc('7') }) }),
  // Outgoing: not income, excluded from the statement entirely.
  row({
    event: chainEvent({ signature: sig(5), blockTime: JAN_15, direction: 'out' }),
    valuation: valuation('999.99'),
  }),
  // Outside the period.
  row({
    event: chainEvent({ signature: sig(6), blockTime: T(1_700_000_000) }),
    valuation: valuation('888.88'),
  }),
  // Failed on-chain: moved no money. A failed-then-retried payment must count once.
  row({
    event: chainEvent({ signature: sig(7), blockTime: JAN_15, succeeded: false }),
    valuation: valuation('271.50'),
  }),
  // Exactly on the period's end bound: the half-open interval gives it to the NEXT
  // period, so consecutive statements never both claim it.
  row({
    event: chainEvent({ signature: sig(8), blockTime: PERIOD_END }),
    valuation: valuation('100.00'),
  }),
];

const statement = buildIncomeStatement(rows, GEL, PERIOD_START, PERIOD_END);

/** Strict RFC 4180 reader: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

describe('buildIncomeStatement', () => {
  it('sums valued incoming rows and reports the unvalued rather than dropping them', () => {
    expect(statement.rows).toHaveLength(4); // 3 valued in + 1 unvalued in
    expect(statement.totalFiat).toBe('434.40'); // 271.50 + 135.75 + 27.15
    expect(statement.unvaluedCount).toBe(1);
  });

  it('excludes outgoing, out-of-period, failed, and end-boundary rows', () => {
    const signatures = statement.rows.map((r) => r.event.signature);
    expect(signatures).not.toContain(sig(5)); // outgoing
    expect(signatures).not.toContain(sig(6)); // out of period
    expect(signatures).not.toContain(sig(7)); // failed transaction
    expect(signatures).not.toContain(sig(8)); // periodEnd is exclusive (half-open)
  });

  it('fails loudly on a corrupted fiatAmount instead of truncating or zeroing it', () => {
    // valueAtReceipt only ever emits 2dp; anything else is a corrupted record, and a
    // silently-wrong total feeding a tax filing is the worst possible failure mode.
    for (const corrupt of ['27.145', '', '1e3', '27,15']) {
      const bad = [
        row({
          event: chainEvent({ signature: sig(1), blockTime: JAN_15 }),
          valuation: valuation(corrupt),
        }),
      ];
      expect(() => buildIncomeStatement(bad, GEL, PERIOD_START, PERIOD_END)).toThrow(RangeError);
    }
  });
});

describe('toCsv (RFC 4180)', () => {
  const parsed = parseCsv(toCsv(statement));

  it('emits the audit columns in the header', () => {
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    for (const col of ['rate', 'rate_source', 'rate_date']) {
      expect(CSV_COLUMNS).toContain(col);
    }
  });

  it('round-trips a memo containing a comma, a quote, and a newline', () => {
    const memoCol = CSV_COLUMNS.indexOf('memo');
    const memos = parsed.slice(1).map((r) => r[memoCol]);
    expect(memos).toContain('He said "thanks", twice\nsecond line');
    // One logical record despite the embedded newline: header + 4 rows, no more.
    expect(parsed).toHaveLength(5);
  });

  it('escapes exactly the fields that need it', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralizes spreadsheet formulas in attacker-controlled cells', () => {
    // Any stranger can attach a memo to a dust transfer at the watched address, and
    // the CSV's designed consumer is the accountant's Excel.
    expect(neutralizeFormula('=WEBSERVICE("https://evil.example")')).toBe(
      `'=WEBSERVICE("https://evil.example")`,
    );
    expect(neutralizeFormula('+1234')).toBe(`'+1234`);
    expect(neutralizeFormula('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(neutralizeFormula('-2+3')).toBe(`'-2+3`);
    // Legitimate negative amounts pass through untouched.
    expect(neutralizeFormula('-271.50')).toBe('-271.50');
    expect(neutralizeFormula('plain memo')).toBe('plain memo');
  });

  it('a hostile memo lands in the exported CSV as inert text', () => {
    const hostile = buildIncomeStatement(
      [
        row({
          event: chainEvent({ signature: sig(1), blockTime: JAN_15, memo: '=2+2' }),
          valuation: valuation('1.00'),
        }),
      ],
      GEL,
      PERIOD_START,
      PERIOD_END,
    );
    const memoCol = CSV_COLUMNS.indexOf('memo');
    const cells = parseCsv(toCsv(hostile));
    expect(cells[1]![memoCol]).toBe(`'=2+2`);
  });

  it('carries rate provenance on valued rows and blanks on unvalued rows', () => {
    const sourceCol = CSV_COLUMNS.indexOf('rate_source');
    const fiatCol = CSV_COLUMNS.indexOf('fiat_amount');
    const bySig = new Map(parsed.slice(1).map((r) => [r[CSV_COLUMNS.indexOf('signature')], r]));
    expect(bySig.get(sig(1))![sourceCol]).toBe('nbg.gov.ge/official-rates');
    expect(bySig.get(sig(4))![sourceCol]).toBe('');
    expect(bySig.get(sig(4))![fiatCol]).toBe('');
  });
});

describe('monthlyTotalsPerClient (T26)', () => {
  const totals = monthlyTotalsPerClient(statement);

  it('groups by month and client, surviving spaces in client names', () => {
    expect(totals).toEqual([
      { month: '2026-01', clientName: 'Acme Corp', totalFiat: '407.25', rowCount: 2, unvaluedCount: 0 },
      { month: '2026-02', clientName: null, totalFiat: '0.00', rowCount: 1, unvaluedCount: 1 },
      { month: '2026-02', clientName: 'Beta LLC', totalFiat: '27.15', rowCount: 1, unvaluedCount: 0 },
    ]);
  });

  it('matches the statement and the summed CSV column to the cent', () => {
    const sumCents = (values: readonly string[]): bigint =>
      values
        .filter((v) => v !== '')
        .reduce((acc, v) => {
          const [whole = '0', fraction = ''] = v.split('.');
          return acc + BigInt(`${whole}${fraction.padEnd(2, '0')}`);
        }, 0n);

    const monthlySum = sumCents(totals.map((t) => t.totalFiat));

    const parsed = parseCsv(toCsv(statement));
    const fiatCol = CSV_COLUMNS.indexOf('fiat_amount');
    const csvSum = sumCents(parsed.slice(1).map((r) => r[fiatCol]!));

    const statementSum = sumCents([statement.totalFiat]);

    expect(monthlySum).toBe(statementSum);
    expect(csvSum).toBe(statementSum);
    expect(statementSum).toBe(43_440n); // 434.40 GEL in cents
  });
});
