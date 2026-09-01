/**
 * The income screen's pure half (T26) and the CSV it exports (T25), tested against a
 * REAL projection -- ops folded by core's project(), not hand-built view state -- so
 * invoice attribution flows the same path it does on device. The central assertion
 * mirrors core's report.test.ts: screen total, monthly totals, and the summed CSV
 * fiat_amount column agree to the cent, in bigint cents, never floats.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChainEvent,
  InvoiceCreatedOp,
  MatchConfirmedOp,
  Signature,
  TokenAmount,
  UnixSeconds,
  Valuation,
} from '@local-books/core';
import {
  asAddress,
  asReferenceKey,
  asSignature,
  asUnixSeconds,
  eventKey,
  project,
  CSV_COLUMNS,
} from '@local-books/core';
import { csvFilename, incomeSummary, internalNote, valuationNote } from '../src/ui/incomeSummary.js';
import { FIAT } from '../src/valuation.js';

const USDC_MINT = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WATCHED = asAddress('WatchedAddr1111111111111111111111111111111');
const T = (n: number): UnixSeconds => asUnixSeconds(n);
const sig = (n: number): Signature => asSignature(`sig-${String(n).padStart(4, '0')}`);

const JAN_15 = T(1_768_435_200); // 2026-01-15 UTC
const FEB_10 = T(1_770_681_600); // 2026-02-10 UTC
const NOW = T(1_772_000_000); // 2026-02-25 UTC

const usdc = (whole: string): TokenAmount => {
  const [w = '0', f = ''] = whole.split('.');
  return {
    raw: BigInt(`${w}${f.padEnd(6, '0').slice(0, 6)}`),
    decimals: 6,
    mint: USDC_MINT,
    symbol: 'USDC',
  };
};

function chainEvent(overrides: Partial<ChainEvent> = {}): ChainEvent {
  return {
    kind: 'spl-transfer',
    signature: sig(1),
    instructionIndex: 0,
    slot: 1,
    blockTime: JAN_15,
    watchedAddress: WATCHED,
    counterparty: asAddress('client-address'),
    direction: 'in',
    amount: usdc('100'),
    memo: null,
    references: [],
    succeeded: true,
    ...overrides,
  } as ChainEvent;
}

function valuation(fiatAmount: string, rate = '2.7150'): Valuation {
  return {
    fiat: FIAT,
    rate,
    fiatAmount,
    source: 'nbg.gov.ge/official-rates',
    rateDate: JAN_15,
    fetchedAt: T(1_771_000_000),
  };
}

// An invoice from Acme Corp paid by sig(1): the fold that attributes the payment.
const invoiceOp: InvoiceCreatedOp = {
  id: 'op-invoice-1',
  at: T(1_768_000_000),
  type: 'invoice-created',
  invoiceId: 'ref-acme-1',
  clientName: 'Acme Corp',
  lineItems: [{ description: 'Consulting', quantity: 1, unitAmount: 100_000_000n }],
  total: usdc('100'),
  dueDate: T(1_769_000_000),
  reference: asReferenceKey('ref-acme-1'),
  payTo: WATCHED,
};
const matchOp: MatchConfirmedOp = {
  id: 'op-match-1',
  at: T(1_768_500_000),
  type: 'match-confirmed',
  invoiceId: 'ref-acme-1',
  signature: sig(1),
  instructionIndex: 0,
  via: 'reference',
};

const invoicePayment = chainEvent({ signature: sig(1), blockTime: JAN_15, amount: usdc('100') });
const unmatchedValued = chainEvent({ signature: sig(2), blockTime: FEB_10, amount: usdc('50') });
const unmatchedUnvalued = chainEvent({ signature: sig(3), blockTime: FEB_10, amount: usdc('7') });
// Outgoing: not income, even with a valuation attached -- must never enter the report.
const outgoing = chainEvent({ signature: sig(4), blockTime: JAN_15, direction: 'out' });

const events = [invoicePayment, unmatchedValued, unmatchedUnvalued, outgoing];
const state = project([invoiceOp, matchOp], events);
const valuations = new Map<string, Valuation>([
  [eventKey(invoicePayment), valuation('271.50')],
  [eventKey(unmatchedValued), valuation('135.75')],
  [eventKey(outgoing), valuation('999.99')],
]);

const summary = incomeSummary(state, events, valuations, NOW);

/** Strict RFC 4180 reader -- the accountant's spreadsheet is a parser, so we are too. */
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

/** Decimal strings -> bigint cents. Money never touches Number(). */
const sumCents = (values: readonly string[]): bigint =>
  values
    .filter((v) => v !== '')
    .reduce((acc, v) => {
      const [whole = '0', fraction = ''] = v.split('.');
      return acc + BigInt(`${whole}${fraction.padEnd(2, '0')}`);
    }, 0n);

describe('incomeSummary', () => {
  it('builds the full-history statement from the projection with invoice attribution', () => {
    expect(summary.statement.totalFiat).toBe('407.25'); // 271.50 + 135.75
    expect(summary.statement.rows).toHaveLength(3); // outgoing excluded
    expect(summary.statement.unvaluedCount).toBe(1);
    expect(summary.monthly).toEqual([
      { month: '2026-01', clientName: 'Acme Corp', totalFiat: '271.50', rowCount: 1, unvaluedCount: 0 },
      { month: '2026-02', clientName: null, totalFiat: '135.75', rowCount: 2, unvaluedCount: 1 },
    ]);
  });

  it('screen total, monthly totals, and the summed CSV column agree to the cent', () => {
    const parsed = parseCsv(summary.csv);
    const fiatCol = CSV_COLUMNS.indexOf('fiat_amount');

    const csvSum = sumCents(parsed.slice(1).map((r) => r[fiatCol]!));
    const monthlySum = sumCents(summary.monthly.map((m) => m.totalFiat));
    const statementSum = sumCents([summary.statement.totalFiat]);

    expect(csvSum).toBe(statementSum);
    expect(monthlySum).toBe(statementSum);
    expect(statementSum).toBe(40_725n); // 407.25 GEL in cents
  });

  it('exports unvalued rows with empty fiat cells rather than dropping them', () => {
    const parsed = parseCsv(summary.csv);
    const bySig = new Map(parsed.slice(1).map((r) => [r[CSV_COLUMNS.indexOf('signature')], r]));
    expect(bySig.size).toBe(3); // three income rows; the outgoing event is absent

    const unvaluedRow = bySig.get(sig(3))!;
    expect(unvaluedRow[CSV_COLUMNS.indexOf('fiat')]).toBe('');
    expect(unvaluedRow[CSV_COLUMNS.indexOf('fiat_amount')]).toBe('');
    expect(unvaluedRow[CSV_COLUMNS.indexOf('rate_source')]).toBe('');

    // The matched payment carries its attribution into the export.
    const matchedRow = bySig.get(sig(1))!;
    expect(matchedRow[CSV_COLUMNS.indexOf('invoice_id')]).toBe('ref-acme-1');
    expect(matchedRow[CSV_COLUMNS.indexOf('client')]).toBe('Acme Corp');
  });

  it('includes a payment stamped exactly at now (periodEnd is now + 1)', () => {
    const fresh = chainEvent({ signature: sig(9), blockTime: NOW });
    const freshState = project([], [fresh]);
    const freshSummary = incomeSummary(
      freshState,
      [fresh],
      new Map([[eventKey(fresh), valuation('27.15')]]),
      NOW,
    );
    expect(freshSummary.statement.rows).toHaveLength(1);
    expect(freshSummary.statement.totalFiat).toBe('27.15');
  });

  it('includes a payment whose blockTime is ahead of the device clock', () => {
    // An unsynced device clock two minutes behind chain time must not make the
    // freshest payment vanish from screen and CSV with no note.
    const ahead = chainEvent({ signature: sig(10), blockTime: T(NOW + 120) });
    const aheadSummary = incomeSummary(project([], [ahead]), [ahead], new Map(), NOW);
    expect(aheadSummary.statement.rows).toHaveLength(1);
    expect(aheadSummary.statement.unvaluedCount).toBe(1); // visible, and visibly unvalued
  });

  it("excludes transfers from the user's own wallets from income and counts them", () => {
    const own = asAddress('MyOtherWallet11111111111111111111111111111');
    const internal = chainEvent({ signature: sig(11), counterparty: own });
    const client = chainEvent({ signature: sig(12) });
    const both = [internal, client];
    const s = incomeSummary(
      project([], both),
      both,
      new Map([
        [eventKey(internal), valuation('2700.00')],
        [eventKey(client), valuation('271.50')],
      ]),
      NOW,
      new Set([WATCHED, own]),
    );
    expect(s.statement.totalFiat).toBe('271.50');
    expect(s.statement.internalCount).toBe(1);
    expect(s.csv).not.toContain(sig(11)); // excluded from the export too
  });

  it('labels CSV dates and months on the Georgian calendar, not UTC', () => {
    // 2026-01-14T21:00Z is already Jan 15, 01:00 in Tbilisi (UTC+4): the filing's
    // receipt date — and the NBG rate day the row is valued at — is the 15th.
    const lateEvening = chainEvent({ signature: sig(13), blockTime: T(JAN_15 - 3 * 3600) });
    const s = incomeSummary(
      project([], [lateEvening]),
      [lateEvening],
      new Map([[eventKey(lateEvening), valuation('271.50')]]),
      NOW,
    );
    const parsed = parseCsv(s.csv);
    expect(parsed[1]![CSV_COLUMNS.indexOf('date')]).toBe('2026-01-15');
    expect(s.monthly[0]?.month).toBe('2026-01');
  });
});

describe('internalNote', () => {
  it('is silent at zero and counts plainly otherwise', () => {
    expect(internalNote(0)).toBeNull();
    expect(internalNote(1)).toBe(
      '1 transfer between your own wallets excluded — moving your own money is not income.',
    );
    expect(internalNote(3)).toMatch(/^3 transfers between your own wallets excluded/);
  });
});

describe('csvFilename', () => {
  it('names the file by the UTC export date', () => {
    expect(csvFilename(JAN_15)).toBe('local-books-income-2026-01-15.csv');
    expect(csvFilename(NOW)).toBe('local-books-income-2026-02-25.csv');
  });
});

describe('valuationNote', () => {
  it('says nothing when every row is valued', () => {
    expect(valuationNote(0, 0, null)).toBeNull();
  });

  it('a fetch failure names the fix and carries the first error', () => {
    expect(valuationNote(2, 2, 'HTTP 503 from nbg.gov.ge')).toBe(
      '2 payments not valued yet — official NBG rates could not be fetched. ' +
        'Connect to the internet and pull to refresh. (HTTP 503 from nbg.gov.ge)',
    );
    // Singular, and no stray parentheses when no error text survived.
    expect(valuationNote(1, 1, null)).toBe(
      '1 payment not valued yet — official NBG rates could not be fetched. ' +
        'Connect to the internet and pull to refresh.',
    );
  });

  it('splits mixed causes: fetch failures never claim the unsupported-token rows', () => {
    // 3 unvalued, only 2 attempted-and-failed: the third is a token retrying can
    // never fix, and telling its owner to reconnect would be a false promise.
    const note = valuationNote(3, 2, 'HTTP 503 from nbg.gov.ge')!;
    expect(note).toContain('2 payments not valued yet — official NBG rates could not be fetched.');
    expect(note).toContain('1 payment in a token v0.1 does not value');
  });

  it('unvalued rows with zero failures mean an unsupported token, not a retry', () => {
    const note = valuationNote(2, 0, null);
    expect(note).toMatch(/v0\.1/);
    expect(note).toMatch(/stablecoin/);
    expect(note).not.toMatch(/refresh|retry/i);
  });
});
