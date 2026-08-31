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
import type { MatchConfirmedOp, ProjectionState, UnixSeconds } from '@local-books/core';
import { amountAgreement, eventKey, matchByReference, matchPairKey } from '@local-books/core';
import { matchConfirmedOp } from './ops.js';

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
