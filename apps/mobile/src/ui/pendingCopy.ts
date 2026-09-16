/**
 * Copy for the "needs your decision" list (D21): what a reference payment that
 * automation refused looks like to the person who has to book it. Pure string work
 * over bigint amounts; unit-tested so the labels stay honest.
 *
 * Two facts can need saying at once -- the amount disagrees AND the pairing is
 * ambiguous -- and the second is the one that should stop a reflexive tap, so it is
 * never dropped: the amount sentence comes first, the reason clause follows.
 */
import type { PendingMatch, PendingReason } from '../matching.js';
import { formatTokenAmount } from './format.js';

function reasonClause(reason: PendingReason): string | null {
  switch (reason) {
    case 'ambiguous-invoice':
      return 'this transfer references more than one invoice — confirm which it settles';
    case 'ambiguous-transfer':
      return "more than one transfer in this transaction carries this invoice's reference — confirm which one settles it";
    case 'multiple-claims':
      return 'another payment also references this invoice — confirm which one settles it';
    case 'sibling-rejected':
      return 'another payment carried this reference and you marked it as not this invoice — mark this one paid to settle it';
    case 'amount-mismatch':
      return null;
  }
}

export function pendingReasonLine(pending: PendingMatch): string {
  const { event, invoice, agreement, reason } = pending;
  const paid = formatTokenAmount(event.amount);
  const asked = formatTokenAmount(invoice.total);
  const clause = reasonClause(reason);

  let amountLine: string | null = null;
  if (agreement === 'wrong-token') {
    amountLine = `Paid ${paid}; the invoice asks for ${asked}.`;
  } else if (agreement === 'under') {
    const shortfall = formatTokenAmount({ ...invoice.total, raw: invoice.total.raw - event.amount.raw });
    amountLine = `Paid ${paid} of ${asked} — short by ${shortfall}.`;
  } else if (agreement === 'over') {
    const excess = formatTokenAmount({ ...invoice.total, raw: event.amount.raw - invoice.total.raw });
    amountLine = `Paid ${paid} for a ${asked} invoice — ${excess} over.`;
  }

  if (amountLine !== null && clause !== null) return `${amountLine} Also, ${clause}.`;
  if (amountLine !== null) return amountLine;
  if (clause !== null) return `Paid ${paid}, but ${clause}.`;
  // Exact amount and no gate reason: unreachable (automation's), but say something true.
  return `Paid ${paid}.`;
}
