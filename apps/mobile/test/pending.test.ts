/**
 * D21: the human decision path for reference payments automation refused.
 *
 * pendingMatches is the complement of autoMatchOps over the same candidates, minus
 * pairs a human already rejected. A tap writes match-confirmed (via
 * reference-confirmed-by-user) or match-rejected; both fold through the projection
 * like any other op, and the copy the row shows is pinned here so it stays honest
 * about shortfalls.
 */
import { describe, expect, it } from 'vitest';
import type { ChainEvent } from '@local-books/core';
import { asAddress, asReferenceKey, asSignature, asUnixSeconds, project } from '@local-books/core';
import { autoMatchOps, pendingMatches } from '../src/matching.js';
import {
  addressWatchedOp,
  invoiceCreatedOp,
  matchConfirmedByUserOp,
  matchRejectedOp,
} from '../src/ops.js';
import type { InvoiceFields } from '../src/ops.js';
import { pendingReasonLine } from '../src/ui/pendingCopy.js';

const WATCHED = asAddress('watched-address');
const AT = asUnixSeconds(1_700_000_000);
const USDC = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN = { mint: USDC, decimals: 6, symbol: 'USDC' };
const REF = asReferenceKey('Ref1111111111111111111111111111111111111111');
const REF_Y = asReferenceKey('RefY111111111111111111111111111111111111111');

const fields = (overrides: Partial<InvoiceFields> = {}): InvoiceFields => ({
  clientName: 'Acme Corp',
  lineItems: [{ description: 'Design', quantity: 1, unitAmount: 1_250_500_000n }], // 1250.50 USDC
  token: TOKEN,
  dueDate: asUnixSeconds(AT + 14 * 86_400),
  reference: REF,
  payTo: WATCHED,
  ...overrides,
});

const payment = (
  overrides: Omit<Partial<ChainEvent>, 'signature'> & { readonly signature?: string } = {},
): ChainEvent => {
  const { signature, ...rest } = overrides;
  return {
    kind: 'spl-transfer',
    instructionIndex: 0,
    slot: 10,
    blockTime: asUnixSeconds(AT + 3600),
    watchedAddress: WATCHED,
    counterparty: asAddress('client-wallet'),
    direction: 'in',
    amount: { raw: 1_250_500_000n, decimals: 6, mint: USDC, symbol: 'USDC' },
    memo: null,
    references: [REF],
    succeeded: true,
    ...rest,
    signature: asSignature(signature ?? 'pay-sig-1'),
  };
};

const usdc = (raw: bigint): ChainEvent['amount'] => ({ raw, decimals: 6, mint: USDC, symbol: 'USDC' });

const baseOps = [addressWatchedOp(WATCHED, 'Income', AT), invoiceCreatedOp(fields(), AT)];

describe('pendingMatches', () => {
  it('offers an underpayment with the shortfall, and never as automation would', () => {
    const short = payment({ amount: usdc(1_000_000_000n) });
    const state = project(baseOps, [short]);
    expect(autoMatchOps(state, AT)).toEqual([]);

    const pending = pendingMatches(state);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ agreement: 'under', reason: 'amount-mismatch' });
    expect(pending[0]!.invoice.invoiceId).toBe(REF);
    expect(pending[0]!.event.signature).toBe(short.signature);
    expect(pendingReasonLine(pending[0]!)).toBe('Paid 1000 USDC of 1250.5 USDC — short by 250.5 USDC.');
  });

  it('labels overpayments and wrong tokens', () => {
    const over = pendingMatches(project(baseOps, [payment({ amount: usdc(1_300_000_000n) })]))[0]!;
    expect(over.agreement).toBe('over');
    expect(pendingReasonLine(over)).toBe('Paid 1300 USDC for a 1250.5 USDC invoice — 49.5 USDC over.');

    const sol = pendingMatches(
      project(baseOps, [payment({ amount: { raw: 1_250_500_000n, decimals: 9, mint: null, symbol: 'SOL' } })]),
    )[0]!;
    expect(sol.agreement).toBe('wrong-token');
    expect(pendingReasonLine(sol)).toBe('Paid 1.2505 SOL; the invoice asks for 1250.5 USDC.');
  });

  it('is empty when the candidate is automation\'s (exact, unambiguous, single claim)', () => {
    const state = project(baseOps, [payment()]);
    expect(autoMatchOps(state, AT)).toHaveLength(1);
    expect(pendingMatches(state)).toEqual([]);
  });

  it('offers BOTH payments when two transactions claim one invoice', () => {
    const state = project(baseOps, [payment({ signature: 'a' }), payment({ signature: 'b', slot: 11 })]);
    const pending = pendingMatches(state);
    expect(pending.map((p) => [p.event.signature, p.reason, p.agreement])).toEqual([
      ['a', 'multiple-claims', 'exact'],
      ['b', 'multiple-claims', 'exact'],
    ]);
    expect(pendingReasonLine(pending[0]!)).toMatch(/another payment also references this invoice/);
  });

  it('a batched settlement whose transfers each reference two invoices: "which invoice?"', () => {
    const invoiceY = invoiceCreatedOp(fields({ reference: REF_Y }), asUnixSeconds(AT + 1));
    const state = project(
      [...baseOps, invoiceY],
      [
        payment({ signature: 'batch', instructionIndex: 0, references: [REF, REF_Y] }),
        payment({ signature: 'batch', instructionIndex: 1, references: [REF, REF_Y] }),
      ],
    );
    const pending = pendingMatches(state);
    expect(pending).toHaveLength(4); // 2 transfers x 2 invoices, all human calls
    expect(pending.every((p) => p.reason === 'ambiguous-invoice')).toBe(true);
    expect(pendingReasonLine(pending[0]!)).toBe(
      'Paid 1250.5 USDC, but this transfer references more than one invoice — confirm which it settles.',
    );
  });

  it('two transfers in one transaction carrying ONE invoice reference: "which transfer?"', () => {
    // A split payment: the reference list is per transaction, so both transfers
    // claim the same single invoice. Exactly one invoice is referenced -- the copy
    // must not say otherwise.
    const state = project(baseOps, [
      payment({ signature: 'split', instructionIndex: 0, amount: usdc(1_250_500_000n) }),
      payment({ signature: 'split', instructionIndex: 1, amount: usdc(1_250_500_000n) }),
    ]);
    const pending = pendingMatches(state);
    expect(pending.map((p) => p.reason)).toEqual(['ambiguous-transfer', 'ambiguous-transfer']);
    expect(pendingReasonLine(pending[0]!)).toBe(
      "Paid 1250.5 USDC, but more than one transfer in this transaction carries this invoice's reference — confirm which one settles it.",
    );
  });

  it('an ambiguous pairing with the wrong amount says both things', () => {
    const state = project(baseOps, [
      payment({ signature: 'split', instructionIndex: 0, amount: usdc(1_000_000_000n) }),
      payment({ signature: 'split', instructionIndex: 1, amount: usdc(250_500_000n) }),
    ]);
    const [first] = pendingMatches(state);
    expect(first!.agreement).toBe('under');
    expect(first!.reason).toBe('ambiguous-transfer');
    expect(pendingReasonLine(first!)).toBe(
      "Paid 1000 USDC of 1250.5 USDC — short by 250.5 USDC. Also, more than one transfer in this transaction carries this invoice's reference — confirm which one settles it.",
    );
  });

  it('gate order is pinned: a short payment that also competes with another claim says both', () => {
    // Gate 2 (another claim) outranks gate 4 (amount): the reason stays
    // 'multiple-claims' and the copy carries the shortfall AND the competing claim.
    const state = project(baseOps, [
      payment({ signature: 'a', amount: usdc(1_000_000_000n) }),
      payment({ signature: 'b', slot: 11 }),
    ]);
    expect(autoMatchOps(state, AT)).toEqual([]);
    const pending = pendingMatches(state);
    expect(pending.map((p) => [p.event.signature, p.reason, p.agreement])).toEqual([
      ['a', 'multiple-claims', 'under'],
      ['b', 'multiple-claims', 'exact'],
    ]);
    expect(pendingReasonLine(pending[0]!)).toBe(
      'Paid 1000 USDC of 1250.5 USDC — short by 250.5 USDC. Also, another payment also references this invoice — confirm which one settles it.',
    );
  });

  it('after the other claim is rejected, the survivor is offered as the one to settle it', () => {
    const a = payment({ signature: 'a' });
    const b = payment({ signature: 'b', slot: 11 });
    const rejectB = matchRejectedOp(REF, b.signature, b.instructionIndex, asUnixSeconds(AT + 10));
    const state = project([...baseOps, rejectB], [a, b]);
    // Automation stays out (D14 gate 2 counts the rejected claim)...
    expect(autoMatchOps(state, AT)).toEqual([]);
    // ...so the human closes it, and is not asked to choose between one thing.
    const pending = pendingMatches(state);
    expect(pending.map((p) => [p.event.signature, p.reason])).toEqual([['a', 'sibling-rejected']]);
    expect(pendingReasonLine(pending[0]!)).toBe(
      'Paid 1250.5 USDC, but another payment carried this reference and you marked it as not this invoice — mark this one paid to settle it.',
    );
  });

  it('drops a pair a human rejected, but keeps the deposit visible in unmatchedEvents', () => {
    const short = payment({ amount: usdc(1_000_000_000n) });
    const reject = matchRejectedOp(REF, short.signature, short.instructionIndex, asUnixSeconds(AT + 10));
    const state = project([...baseOps, reject], [short]);
    expect(pendingMatches(state)).toEqual([]);
    expect(state.unmatchedEvents.map((e) => e.signature)).toEqual([short.signature]);
    expect(state.invoices[0]!.status).toBe('open');
  });

  it('ignores paid invoices', () => {
    const settle = payment({ signature: 'settle' });
    const settled = [...baseOps, ...autoMatchOps(project(baseOps, [settle]), AT)];
    const late = payment({ signature: 'late', slot: 20, amount: usdc(5n) });
    expect(pendingMatches(project(settled, [settle, late]))).toEqual([]);
  });
});

describe('matchConfirmedByUserOp', () => {
  it('books the invoice paid, attributed to the user, and clears the pending list', () => {
    const short = payment({ amount: usdc(1_000_000_000n) });
    const before = project(baseOps, [short]);
    const [pending] = pendingMatches(before);
    const confirm = matchConfirmedByUserOp(pending!.candidate, asUnixSeconds(AT + 10));

    expect(confirm).toMatchObject({
      type: 'match-confirmed',
      invoiceId: REF,
      signature: short.signature,
      instructionIndex: 0,
      via: 'reference-confirmed-by-user',
    });

    const after = project([...baseOps, confirm], [short]);
    expect(after.invoices[0]!.status).toBe('paid');
    expect(after.invoices[0]!.payments[0]!.via).toBe('reference-confirmed-by-user');
    expect(after.unmatchedEvents).toEqual([]);
    expect(pendingMatches(after)).toEqual([]);
    expect(autoMatchOps(after, AT)).toEqual([]);
  });

  it('is content-addressed like every other op: the same tap twice is one log entry', () => {
    const [pending] = pendingMatches(project(baseOps, [payment({ amount: usdc(1n) })]));
    const a = matchConfirmedByUserOp(pending!.candidate, AT);
    const b = matchConfirmedByUserOp(pending!.candidate, AT);
    expect(a.id).toBe(b.id);
  });

  it('one transfer settles at most one invoice: a later confirm to another invoice supersedes', () => {
    // Both pairings of one transfer inside an ambiguous batch are offered; a stale
    // screen could let a human tap both. The fold keeps the LATER decision only.
    const invoiceY = invoiceCreatedOp(fields({ reference: REF_Y }), asUnixSeconds(AT + 1));
    const ops = [...baseOps, invoiceY];
    const transfer = payment({ signature: 'batch', instructionIndex: 0, references: [REF, REF_Y] });
    const pending = pendingMatches(project(ops, [transfer]));
    const toX = pending.find((p) => p.invoice.invoiceId === REF)!.candidate;
    const toY = pending.find((p) => p.invoice.invoiceId === REF_Y)!.candidate;

    const confirmX = matchConfirmedByUserOp(toX, asUnixSeconds(AT + 10));
    const confirmY = matchConfirmedByUserOp(toY, asUnixSeconds(AT + 20));
    const after = project([...ops, confirmX, confirmY], [transfer]);
    const status = new Map(after.invoices.map((v) => [v.invoice.invoiceId, v.status]));
    expect(status.get(REF)).toBe('open'); // superseded
    expect(status.get(REF_Y)).toBe('paid');
    expect(after.unmatchedEvents).toEqual([]);
  });

  it('a user confirm of one of two claims settles the invoice and retires the other claim', () => {
    const a = payment({ signature: 'a' });
    const b = payment({ signature: 'b', slot: 11 });
    const state = project(baseOps, [a, b]);
    const pending = pendingMatches(state);
    const confirmA = matchConfirmedByUserOp(pending.find((p) => p.event.signature === 'a')!.candidate, AT);
    const after = project([...baseOps, confirmA], [a, b]);
    expect(after.invoices[0]!.status).toBe('paid');
    // b is still an unexplained deposit (a duplicate payment) but claims nothing open.
    expect(after.unmatchedEvents.map((e) => e.signature)).toEqual(['b']);
    expect(pendingMatches(after)).toEqual([]);
  });

  it('refuses a non-reference candidate', () => {
    const [pending] = pendingMatches(project(baseOps, [payment({ amount: usdc(1n) })]));
    expect(() =>
      matchConfirmedByUserOp({ ...pending!.candidate, tier: 'heuristic', autoApplicable: false }, AT),
    ).toThrow(/reference/i);
  });
});
