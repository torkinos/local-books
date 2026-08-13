/**
 * Matching tests (PROJECT.md lines 79-81).
 *
 * The direct-transfer case is asserted as a *negative* on purpose: it is the gap that
 * tier b exists to close, and Spike 2 measures it. Encoding it as a passing test means
 * nobody later "fixes" tier a into guessing.
 */
import { describe, expect, it } from 'vitest';
import { amountAgreement, matchByReference } from '../src/match/index.js';
import { asAddress, asReferenceKey, asUnixSeconds } from '../src/types/index.js';
import type { InvoiceCreatedOp } from '../src/types/index.js';
import { chainEvent, sig, usdc } from './fixtures/fakes.js';

const REFERENCE = asReferenceKey('ref-invoice-001');

const invoice: InvoiceCreatedOp = {
  type: 'invoice-created',
  id: 'op-1',
  at: asUnixSeconds(1_700_000_000),
  invoiceId: 'inv-001',
  clientName: 'Acme Ltd',
  lineItems: [{ description: 'Design work', quantity: 1, unitAmount: 100_000_000n }],
  total: usdc('100'),
  dueDate: asUnixSeconds(1_700_600_000),
  reference: REFERENCE,
  payTo: asAddress('watched-address'),
};

describe('matchByReference', () => {
  it('matches an incoming transfer carrying the invoice reference', () => {
    const matches = matchByReference([chainEvent({ references: [REFERENCE] })], [invoice]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      invoiceId: 'inv-001',
      tier: 'reference',
      autoApplicable: true,
    });
  });

  it('does not match a direct transfer that ignores the QR', () => {
    // The tier-b gap, stated as a test. No reference on the transaction means tier a
    // is structurally blind to it -- not a bug, and not fixable inside tier a.
    const matches = matchByReference([chainEvent({ references: [] })], [invoice]);
    expect(matches).toEqual([]);
  });

  it('ignores failed transactions', () => {
    // A reverted transfer moved no money; booking it would overstate turnover.
    const matches = matchByReference(
      [chainEvent({ references: [REFERENCE], succeeded: false })],
      [invoice],
    );
    expect(matches).toEqual([]);
  });

  it('ignores outgoing transfers even when they carry the reference', () => {
    const matches = matchByReference(
      [chainEvent({ references: [REFERENCE], direction: 'out' })],
      [invoice],
    );
    expect(matches).toEqual([]);
  });

  it('ignores references belonging to no known invoice', () => {
    const matches = matchByReference(
      [chainEvent({ references: [asReferenceKey('someone-elses-ref')] })],
      [invoice],
    );
    expect(matches).toEqual([]);
  });

  it('keeps transfers in one transaction distinct', () => {
    // A batch payout is one signature with several transfers. Collapsing on signature
    // alone would book one payment and silently lose the rest.
    const second = { ...invoice, invoiceId: 'inv-002', reference: asReferenceKey('ref-invoice-002') };
    const matches = matchByReference(
      [
        chainEvent({ signature: sig(9), instructionIndex: 0, references: [REFERENCE] }),
        chainEvent({ signature: sig(9), instructionIndex: 1, references: [second.reference] }),
      ],
      [invoice, second],
    );

    expect(matches.map((m) => m.invoiceId)).toEqual(['inv-001', 'inv-002']);
    expect(matches.map((m) => m.instructionIndex)).toEqual([0, 1]);
  });

  it('still matches when the client underpays', () => {
    // Matching and amount agreement are separate questions: an underpaid invoice is
    // matched *and* flagged, rather than left as an unexplained deposit.
    const event = chainEvent({ references: [REFERENCE], amount: usdc('60') });
    expect(matchByReference([event], [invoice])).toHaveLength(1);
    expect(amountAgreement(event, invoice)).toBe('under');
  });
});

describe('amountAgreement', () => {
  it('classifies exact, under, over, and wrong-token', () => {
    expect(amountAgreement(chainEvent({ amount: usdc('100') }), invoice)).toBe('exact');
    expect(amountAgreement(chainEvent({ amount: usdc('99.99') }), invoice)).toBe('under');
    expect(amountAgreement(chainEvent({ amount: usdc('120') }), invoice)).toBe('over');
    expect(
      amountAgreement(
        chainEvent({ amount: { raw: 100_000_000n, decimals: 9, mint: null, symbol: 'SOL' } }),
        invoice,
      ),
    ).toBe('wrong-token');
  });
});
