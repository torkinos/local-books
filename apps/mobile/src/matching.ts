/**
 * Auto-matching: tier-a candidates become match-confirmed ops without a tap.
 *
 * PROJECT.md line 81 permits this for reference matches only -- the payer used the
 * QR, so the transaction names the invoice and matching is a lookup, not a guess.
 * Even then, automation applies a match only when the chain's answer is CONCLUSIVE.
 * Four gates, each existing because a payer (or an accident) controls the input:
 *
 *   1. Core's in-transaction rule (D10): the transaction admits exactly one
 *      transfer-to-invoice pairing, or nothing auto-applies.
 *   2. Pass-level ambiguity, judged over EVERY reference claim -- including claims
 *      core already refused to auto-apply and claims a human rejected. Two on-chain
 *      payments claiming one invoice is ambiguous no matter which of them is
 *      individually clean; a human decides which settles it.
 *   3. A pair a human has EVER rejected is off-limits to automation forever
 *      (D4's compensating-op semantics). The human can still re-confirm by hand.
 *   4. The amount must agree EXACTLY (same mint, same raw amount). Solana Pay lets
 *      the payer edit the amount before signing, so without this gate the payer
 *      unilaterally decides when the freelancer's books say "paid" -- a dust
 *      payment carrying the reference would settle a 1250 USDC invoice. Under-,
 *      over-, and wrong-token payments stay visible as unexplained deposits until
 *      a human books them.
 *
 * Idempotent by construction: candidates come from unmatchedEvents x OPEN invoices,
 * and applying the returned ops removes the event from one set and the invoice from
 * the other -- the next pass finds nothing. Pure; the caller appends and refolds.
 */
import type {
  ChainEvent,
  InvoiceCreatedOp,
  MatchCandidate,
  MatchConfirmedOp,
  ProjectionState,
  UnixSeconds,
} from '@local-books/core';
import { amountAgreement, eventKey, matchByReference, matchPairKey } from '@local-books/core';
import { matchConfirmedOp } from './ops.js';

export type AmountAgreement = ReturnType<typeof amountAgreement>;

/**
 * Why automation left a reference candidate to a human (D14 gates 1, 2, 4), at the
 * granularity the copy needs to be truthful:
 *   - 'ambiguous-invoice'   gate 1: this one transfer carries references for
 *                           several invoices -- which does it settle?
 *   - 'ambiguous-transfer'  gate 1: several transfers in this one transaction carry
 *                           this invoice's reference -- which one settles it?
 *   - 'multiple-claims'     gate 2: another, still-undecided payment also references
 *                           this invoice.
 *   - 'sibling-rejected'    gate 2 after the human rejected the other claim: nothing
 *                           is left to choose between, but automation stays out (a
 *                           rejected claim still counts, see autoMatchOps) -- so the
 *                           human closes it with one tap.
 *   - 'amount-mismatch'     gate 4: under, over, or the wrong token.
 */
export type PendingReason =
  | 'ambiguous-invoice'
  | 'ambiguous-transfer'
  | 'multiple-claims'
  | 'sibling-rejected'
  | 'amount-mismatch';

/** A reference payment that needs a human decision (D21). */
export interface PendingMatch {
  readonly candidate: MatchCandidate;
  readonly invoice: InvoiceCreatedOp;
  readonly event: ChainEvent;
  readonly agreement: AmountAgreement;
  readonly reason: PendingReason;
}

/**
 * Reference candidates automation refused, for the "needs your decision" list.
 *
 * The complement of autoMatchOps over the same candidates: anything that failed
 * gate 1 (ambiguous transaction), gate 2 (several payments claim the invoice), or
 * gate 4 (amount or token disagrees) -- EXCEPT pairs a human already rejected (gate
 * 3). A rejection is a recorded decision; nagging about it would be the machine
 * relitigating the human. (D4 says a human may re-confirm a rejected pair; v0.1 has
 * no screen for that, and the deposit stays visible in the ledger.)
 *
 * Call this on the projection AFTER autoMatchOps has been applied: a candidate that
 * passes all four gates is automation's to apply, and the refresh path in App.tsx
 * does exactly that before asking what is pending. One is still filtered here so a
 * caller on a stale projection cannot offer a tap for a match that will land by
 * itself.
 */
export function pendingMatches(state: ProjectionState): readonly PendingMatch[] {
  const openInvoices = state.invoices
    .filter((view) => view.status !== 'paid')
    .map((view) => view.invoice);
  if (openInvoices.length === 0 || state.unmatchedEvents.length === 0) return [];

  const candidates = matchByReference(state.unmatchedEvents, openInvoices);
  const rejectedPair = (c: MatchCandidate): boolean =>
    state.rejectedMatches.has(matchPairKey(c.invoiceId, c));

  // Gate-2 counts: ALL claims (what automation counts, rejected included) and LIVE
  // claims (what the human still has to choose between).
  const allClaims = new Map<string, number>();
  const liveClaims = new Map<string, number>();
  // Gate-1 shape within one transaction: how many invoices one transfer references,
  // and how many transfers in the transaction reference one invoice.
  const invoicesPerTransfer = new Map<string, number>();
  const transfersPerInvoiceInTx = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const c of candidates) {
    bump(allClaims, c.invoiceId);
    if (!rejectedPair(c)) bump(liveClaims, c.invoiceId);
    bump(invoicesPerTransfer, eventKey(c));
    bump(transfersPerInvoiceInTx, `${c.signature}|${c.invoiceId}`);
  }

  const eventByKey = new Map(state.unmatchedEvents.map((e) => [eventKey(e), e]));
  const invoiceById = new Map(openInvoices.map((i) => [i.invoiceId, i]));

  const pending: PendingMatch[] = [];
  for (const candidate of candidates) {
    if (rejectedPair(candidate)) continue;
    const event = eventByKey.get(eventKey(candidate));
    const invoice = invoiceById.get(candidate.invoiceId);
    if (event === undefined || invoice === undefined) continue;
    const agreement = amountAgreement(event, invoice);

    let reason: PendingReason | null = null;
    if (!candidate.autoApplicable) {
      reason =
        (invoicesPerTransfer.get(eventKey(candidate)) ?? 0) > 1
          ? 'ambiguous-invoice'
          : 'ambiguous-transfer';
    } else if ((allClaims.get(candidate.invoiceId) ?? 0) > 1) {
      reason = (liveClaims.get(candidate.invoiceId) ?? 0) > 1 ? 'multiple-claims' : 'sibling-rejected';
    } else if (agreement !== 'exact') {
      reason = 'amount-mismatch';
    }
    if (reason === null) continue; // automation's; see above

    pending.push({ candidate, invoice, event, agreement, reason });
  }
  return pending;
}

export function autoMatchOps(state: ProjectionState, at: UnixSeconds): readonly MatchConfirmedOp[] {
  const openInvoices = state.invoices
    .filter((view) => view.status !== 'paid')
    .map((view) => view.invoice);
  if (openInvoices.length === 0 || state.unmatchedEvents.length === 0) return [];

  const candidates = matchByReference(state.unmatchedEvents, openInvoices);

  // Gate 2: count ALL claims, not just auto-applicable ones (a duplicate payment
  // hiding inside an ambiguous transaction must still block its clean twin), and
  // not excluding rejected ones (a rejected duplicate is still a second claim).
  const perInvoice = new Map<string, number>();
  for (const c of candidates) perInvoice.set(c.invoiceId, (perInvoice.get(c.invoiceId) ?? 0) + 1);

  const eventByKey = new Map(state.unmatchedEvents.map((e) => [eventKey(e), e]));
  const invoiceById = new Map(openInvoices.map((i) => [i.invoiceId, i]));

  return candidates
    .filter((c) => c.autoApplicable) // gate 1 (core, in-transaction)
    .filter((c) => perInvoice.get(c.invoiceId) === 1) // gate 2 (pass-level)
    .filter((c) => !state.rejectedMatches.has(matchPairKey(c.invoiceId, c))) // gate 3
    .filter((c) => {
      const event = eventByKey.get(eventKey(c));
      const invoice = invoiceById.get(c.invoiceId);
      return (
        event !== undefined && invoice !== undefined && amountAgreement(event, invoice) === 'exact'
      ); // gate 4
    })
    .map((c) => matchConfirmedOp(c, at));
}
