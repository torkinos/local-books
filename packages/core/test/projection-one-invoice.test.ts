/**
 * One transfer settles at most one invoice (D21).
 *
 * The confirm/reject list offers every pairing of an ambiguous batched transfer;
 * a stale screen could let a human confirm two of them. The fold keeps the LATER
 * decision only -- later-decision-wins, as everywhere else in project() -- so two
 * invoices can never both read "paid" on the strength of one payment.
 */
import { describe, expect, it } from 'vitest';
import { stableStringify } from '../src/oplog/index.js';
import { project } from '../src/projection/index.js';
import type { Op } from '../src/types/index.js';
import { asAddress, asReferenceKey } from '../src/types/index.js';
import { chainEvent, sig, usdc, T } from './fixtures/fakes.js';

const WATCHED = asAddress('watched-address');

const invoice = (id: string, ref: string, at: number): Op => ({
  type: 'invoice-created',
  id: `inv-${id}`,
  at: T(at),
  invoiceId: id,
  clientName: 'Acme Ltd',
  lineItems: [{ description: 'Design', quantity: 1, unitAmount: 100_000_000n }],
  total: usdc('100'),
  dueDate: T(500),
  reference: asReferenceKey(ref),
  payTo: WATCHED,
});

const confirm = (id: string, invoiceId: string, at: number): Op => ({
  type: 'match-confirmed',
  id,
  at: T(at),
  invoiceId,
  signature: sig(1),
  instructionIndex: 0,
  via: 'reference-confirmed-by-user',
});

const transfer = chainEvent({ signature: sig(1), instructionIndex: 0 });

describe('one transfer settles at most one invoice', () => {
  it('a later confirm of the same transfer to another invoice supersedes the earlier one', () => {
    const state = project(
      [invoice('A', 'ref-a', 1), invoice('B', 'ref-b', 2), confirm('c1', 'A', 10), confirm('c2', 'B', 20)],
      [transfer],
    );
    const status = new Map(state.invoices.map((v) => [v.invoice.invoiceId, v.status]));
    expect(status.get('A')).toBe('open');
    expect(status.get('B')).toBe('paid');
    expect(state.unmatchedEvents).toEqual([]);

    // Log order, not array order, decides: the same ops shuffled fold identically.
    const shuffled = project(
      [confirm('c2', 'B', 20), invoice('B', 'ref-b', 2), confirm('c1', 'A', 10), invoice('A', 'ref-a', 1)],
      [transfer],
    );
    expect(stableStringify(shuffled)).toBe(stableStringify(state));
  });

  it('re-confirming the same pairing is idempotent', () => {
    const state = project(
      [invoice('A', 'ref-a', 1), confirm('c1', 'A', 10), confirm('c2', 'A', 20)],
      [transfer],
    );
    expect(state.invoices[0]!.status).toBe('paid');
    expect(state.invoices[0]!.payments).toHaveLength(1);
  });

  it('rejecting the superseding pairing does not resurrect the superseded one', () => {
    const reject: Op = {
      type: 'match-rejected',
      id: 'r1',
      at: T(30),
      invoiceId: 'B',
      signature: sig(1),
      instructionIndex: 0,
    };
    const state = project(
      [invoice('A', 'ref-a', 1), invoice('B', 'ref-b', 2), confirm('c1', 'A', 10), confirm('c2', 'B', 20), reject],
      [transfer],
    );
    expect(state.invoices.every((v) => v.status === 'open')).toBe(true);
    expect(state.unmatchedEvents.map((e) => e.signature)).toEqual([sig(1)]);
    expect(state.rejectedMatches.has(`B|${sig(1)}:0`)).toBe(true);
  });
});
