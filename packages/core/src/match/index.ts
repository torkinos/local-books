/**
 * Payment matching (PROJECT.md lines 79-81).
 *
 * Tier a -- reference key -- is v0.1 scope and implemented here. It is exact: the payer
 * used the QR, so the transaction carries the invoice's reference account and matching
 * is a lookup, not a guess.
 *
 * Tier b -- heuristic -- is deferred (line 123, first to cut). Its *interface* and its
 * confidence vocabulary live here so that Spike 2's fixtures have something to be
 * measured against and so the UI can be built against a stable shape. There is no
 * implementation, deliberately.
 *
 * The rule that must never be relaxed (line 81): heuristic matches are proposals.
 * `autoApplicable` is true only for reference matches. If a future change makes a
 * heuristic match auto-confirm, it will silently attribute a stranger's payment to a
 * client's invoice, and the books become fiction.
 */
import type {
  ChainEvent,
  InvoiceCreatedOp,
  ReferenceKey,
  Signature,
  UnixSeconds,
} from '../types/index.js';

export type MatchTier = 'reference' | 'heuristic';

export interface MatchCandidate {
  readonly invoiceId: string;
  readonly signature: Signature;
  readonly instructionIndex: number;
  readonly tier: MatchTier;
  /**
   * True only for tier a. Tier b always requires a human tap, so this stays false
   * regardless of how confident a future heuristic feels.
   */
  readonly autoApplicable: boolean;
  /** Human-readable justification, surfaced in the confirm UI and in exports. */
  readonly rationale: string;
}

/**
 * Match chain events against open invoices by reference key.
 *
 * Linear over events with a map lookup per event: at v0.1 scale (one user's invoices
 * against one address's history) this is nowhere near hot, and the obvious
 * implementation is the one worth having.
 *
 * Failed transactions are skipped -- a reverted transfer moved no money, and booking it
 * as income would overstate turnover.
 */
export function matchByReference(
  events: readonly ChainEvent[],
  invoices: readonly InvoiceCreatedOp[],
): readonly MatchCandidate[] {
  const byReference = new Map<ReferenceKey, InvoiceCreatedOp>();
  for (const invoice of invoices) byReference.set(invoice.reference, invoice);

  const matches: MatchCandidate[] = [];

  for (const event of events) {
    if (!event.succeeded) continue;
    // Only incoming value settles an invoice. An outgoing transfer that happens to
    // carry a reference is a refund or a mistake, not a payment.
    if (event.direction !== 'in') continue;

    for (const reference of event.references) {
      const invoice = byReference.get(reference);
      if (!invoice) continue;

      matches.push({
        invoiceId: invoice.invoiceId,
        signature: event.signature,
        instructionIndex: event.instructionIndex,
        tier: 'reference',
        autoApplicable: true,
        rationale: `Reference ${truncate(reference)} on ${truncate(event.signature)}`,
      });
    }
  }

  return matches;
}

/**
 * Does the paid amount agree with what the invoice asked for?
 *
 * Separate from `matchByReference` on purpose: a reference match is still a match when
 * the client underpays, and the right response is to record the payment and flag the
 * shortfall -- not to fail to match it and leave the user staring at an unexplained
 * deposit. The UI uses this to decide what to say, not whether to match.
 */
export function amountAgreement(
  event: ChainEvent,
  invoice: InvoiceCreatedOp,
): 'exact' | 'under' | 'over' | 'wrong-token' {
  if (event.amount.mint !== invoice.total.mint) return 'wrong-token';
  if (event.amount.raw === invoice.total.raw) return 'exact';
  return event.amount.raw < invoice.total.raw ? 'under' : 'over';
}

// ---------------------------------------------------------------------------
// Tier b -- deferred (PROJECT.md line 123). Interface only.
// ---------------------------------------------------------------------------

/**
 * Inputs a heuristic matcher would need, fixed now so Spike 2 can record its fixtures
 * in these terms and so the deferred work starts from measurements rather than guesses.
 *
 * The case that motivates all of it: a client ignores the QR and sends a plain
 * transfer. It carries no reference, so tier a cannot see it at all -- no amount of
 * improving tier a will help.
 */
export interface HeuristicMatchInput {
  readonly event: ChainEvent;
  readonly invoice: InvoiceCreatedOp;
  /** Fractional tolerance on amount, e.g. 0.01 for 1%, absorbing fees and rounding. */
  readonly amountTolerance: number;
  /** How long after issue a payment may still plausibly belong to this invoice. */
  readonly windowSeconds: number;
  /** Addresses this client has paid from before. The strongest available signal. */
  readonly knownCounterparties: readonly string[];
  readonly now: UnixSeconds;
}

/**
 * Deferred. Implementing this is post-grant work gated on Spike 2's measured
 * false-positive and false-negative rates (see spikes/02-reference-detection.md).
 *
 * Whatever implements it must return `autoApplicable: false`.
 */
export type HeuristicMatcher = (input: HeuristicMatchInput) => MatchCandidate | null;

function truncate(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
