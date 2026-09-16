/**
 * assembleIncomeRows: the join between chain events and what the projection knows
 * (invoice attribution, categories) plus caller-supplied valuations. The income
 * screen and the CSV both start from exactly this join, so what these tests pin is
 * the report's input contract.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChainEvent,
  InvoiceCreatedOp,
  MatchConfirmedOp,
  Op,
  Valuation,
} from '../src/types/index.js';
import {
  asAddress,
  asFiatCode,
  asReferenceKey,
  asSignature,
  asUnixSeconds,
} from '../src/types/index.js';
import { eventKey } from '../src/normalize/index.js';
import { project } from '../src/projection/index.js';
import {
  assembleIncomeRows,
  buildIncomeStatement,
  monthlyTotalsPerClient,
  toCsv,
} from '../src/report/index.js';

const USDC = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ME = asAddress('me11111111111111111111111111111111111111111');
const OTHER = asAddress('other1111111111111111111111111111111111111');
const PAYER = asAddress('payer1111111111111111111111111111111111111');

function event(sig: string, overrides: Partial<ChainEvent> = {}): ChainEvent {
  return {
    kind: 'spl-transfer',
    signature: asSignature(sig),
    instructionIndex: 0,
    slot: 100,
    blockTime: asUnixSeconds(1_760_000_000),
    watchedAddress: ME,
    counterparty: PAYER,
    direction: 'in',
    amount: { raw: 100_000_000n, decimals: 6, mint: USDC, symbol: 'USDC' },
    memo: null,
    references: [],
    succeeded: true,
    ...overrides,
  };
}

function invoiceOp(invoiceId: string, clientName: string): InvoiceCreatedOp {
  return {
    id: `op-${invoiceId}`,
    at: asUnixSeconds(1_759_000_000),
    type: 'invoice-created',
    invoiceId,
    clientName,
    lineItems: [{ description: 'Work', quantity: 1, unitAmount: 100_000_000n }],
    total: { raw: 100_000_000n, decimals: 6, mint: USDC, symbol: 'USDC' },
    dueDate: asUnixSeconds(1_770_000_000),
    reference: asReferenceKey(invoiceId),
    payTo: ME,
  };
}

function confirmOp(invoiceId: string, sig: string, instructionIndex = 0): MatchConfirmedOp {
  return {
    id: `op-confirm-${invoiceId}-${sig}`,
    at: asUnixSeconds(1_760_000_100),
    type: 'match-confirmed',
    invoiceId,
    signature: asSignature(sig),
    instructionIndex,
    via: 'reference',
  };
}

function valuation(fiatAmount: string): Valuation {
  return {
    fiat: asFiatCode('GEL'),
    rate: '2.6125',
    fiatAmount,
    source: 'nbg.gov.ge/official-rates',
    rateDate: asUnixSeconds(1_759_968_000),
    fetchedAt: asUnixSeconds(1_760_050_000),
  };
}

describe('assembleIncomeRows', () => {
  it('attributes a matched payment to its invoice and client; unmatched rows get nulls', () => {
    const ops: Op[] = [invoiceOp('inv-1', 'Acme'), confirmOp('inv-1', 'sig-paid')];
    const events = [event('sig-paid'), event('sig-random')];
    const rows = assembleIncomeRows(project(ops, events), events, new Map());

    const paid = rows.find((r) => r.event.signature === asSignature('sig-paid'));
    const random = rows.find((r) => r.event.signature === asSignature('sig-random'));
    expect(paid).toMatchObject({ invoiceId: 'inv-1', clientName: 'Acme' });
    expect(random).toMatchObject({ invoiceId: null, clientName: null });
  });

  it('never attributes an invoice to the outgoing twin of a matched payment', () => {
    // Both sides of a transfer between two watched wallets share eventKey (D10 keeps
    // them as separate rows keyed by watched address). Only the incoming side was
    // matched; the sender's books must not claim the recipient's invoice.
    const ops: Op[] = [invoiceOp('inv-1', 'Acme'), confirmOp('inv-1', 'sig-x')];
    const events = [
      event('sig-x'),
      event('sig-x', { direction: 'out', watchedAddress: OTHER, counterparty: ME }),
    ];
    const rows = assembleIncomeRows(project(ops, events), events, new Map());

    expect(rows).toHaveLength(2);
    const incoming = rows.find((r) => r.event.direction === 'in');
    const outgoing = rows.find((r) => r.event.direction === 'out');
    expect(incoming?.invoiceId).toBe('inv-1');
    expect(outgoing?.invoiceId).toBeNull();
    expect(outgoing?.clientName).toBeNull();
  });

  it('attaches categories from the projection and valuations from the caller', () => {
    const categorized = event('sig-cat');
    const ops: Op[] = [
      invoiceOp('inv-1', 'Acme'),
      {
        id: 'op-cat',
        at: asUnixSeconds(1_760_000_200),
        type: 'category-assigned',
        signature: categorized.signature,
        instructionIndex: 0,
        category: 'consulting',
      },
    ];
    const valuations = new Map([[eventKey(categorized), valuation('261.25')]]);
    const rows = assembleIncomeRows(project(ops, [categorized]), [categorized], valuations);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'consulting' });
    expect(rows[0]?.valuation?.fiatAmount).toBe('261.25');
  });

  it('leaves valuation null when the caller has none for the row', () => {
    const events = [event('sig-unvalued')];
    const rows = assembleIncomeRows(project([], events), events, new Map());
    expect(rows[0]?.valuation).toBeNull();
  });

  it('collapses duplicate events so the report never counts a payment twice', () => {
    const one = event('sig-dup');
    const rows = assembleIncomeRows(project([], [one, one]), [one, one], new Map());
    expect(rows).toHaveLength(1);
  });

  it("excludes the in-leg of a transfer between the user's own wallets from total and CSV, and counts it", () => {
    // Business -> savings between two watched wallets: D10 keeps both legs as ledger
    // facts, but the in-leg is not income — booking it would inflate the turnover a
    // Georgian filing pays 1% tax on. A real client payment in the same statement
    // must still count.
    const internal = event('sig-internal', { counterparty: OTHER });
    const clientPaid = event('sig-client');
    const events = [internal, clientPaid];
    const rows = assembleIncomeRows(
      project([], events),
      events,
      new Map([
        [eventKey(internal), valuation('2700.00')],
        [eventKey(clientPaid), valuation('261.25')],
      ]),
    );

    const statement = buildIncomeStatement(
      rows,
      asFiatCode('GEL'),
      asUnixSeconds(0),
      asUnixSeconds(1_760_999_999),
      { ownAddresses: new Set([ME, OTHER]) },
    );
    expect(statement.totalFiat).toBe('261.25');
    expect(statement.internalCount).toBe(1);
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0]?.event.signature).toBe(asSignature('sig-client'));
  });

  it('attributes by (signature, instructionIndex), not signature alone', () => {
    // A batch payout: two incoming transfers in ONE transaction, only the second
    // settles the invoice. Joining by signature alone would attribute both.
    const first = event('sig-batch');
    const second = event('sig-batch', { instructionIndex: 1 });
    const ops: Op[] = [invoiceOp('inv-1', 'Acme'), confirmOp('inv-1', 'sig-batch', 1)];
    const events = [first, second];
    const rows = assembleIncomeRows(project(ops, events), events, new Map());

    const atZero = rows.find((r) => r.event.instructionIndex === 0);
    const atOne = rows.find((r) => r.event.instructionIndex === 1);
    expect(atOne?.invoiceId).toBe('inv-1');
    expect(atZero?.invoiceId).toBeNull();
  });

  it('labels days and months on the statement calendar, not UTC, when an offset is set', () => {
    // 2026-08-27T22:00Z is already Aug 28 in Tbilisi (UTC+4). The filing's receipt
    // date is the local day, so the CSV date column and the monthly grouping must
    // both say the 28th under the Georgian calendar — and the 27th under plain UTC.
    const lateEvening = event('sig-late', {
      blockTime: asUnixSeconds(1_787_868_000), // 2026-08-27T22:00:00Z
    });
    const rows = assembleIncomeRows(project([], [lateEvening]), [lateEvening], new Map());

    const georgian = buildIncomeStatement(
      rows,
      asFiatCode('GEL'),
      asUnixSeconds(0),
      asUnixSeconds(2_000_000_000),
      { calendarOffsetSeconds: 4 * 3600 },
    );
    expect(toCsv(georgian).split('\n')[1]).toMatch(/^2026-08-28,/);
    expect(monthlyTotalsPerClient(georgian)[0]?.month).toBe('2026-08');

    const utc = buildIncomeStatement(rows, asFiatCode('GEL'), asUnixSeconds(0), asUnixSeconds(2_000_000_000));
    expect(toCsv(utc).split('\n')[1]).toMatch(/^2026-08-27,/);
  });

  it('feeds buildIncomeStatement so screen and CSV share one joined row set', () => {
    const paid = event('sig-paid');
    const unvalued = event('sig-unvalued', { blockTime: asUnixSeconds(1_760_000_010) });
    const outgoing = event('sig-out', { direction: 'out' });
    const ops: Op[] = [invoiceOp('inv-1', 'Acme'), confirmOp('inv-1', 'sig-paid')];
    const events = [paid, unvalued, outgoing];
    const rows = assembleIncomeRows(
      project(ops, events),
      events,
      new Map([[eventKey(paid), valuation('261.25')]]),
    );

    const statement = buildIncomeStatement(
      rows,
      asFiatCode('GEL'),
      asUnixSeconds(1_759_999_999),
      asUnixSeconds(1_760_999_999),
    );
    expect(statement.rows).toHaveLength(2); // outgoing excluded, unvalued kept
    expect(statement.totalFiat).toBe('261.25');
    expect(statement.unvaluedCount).toBe(1);
    expect(statement.rows.find((r) => r.invoiceId === 'inv-1')?.clientName).toBe('Acme');
  });
});
