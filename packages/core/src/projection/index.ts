/**
 * Projection: fold (op log + chain events) -> queryable view state.
 *
 * PROJECT.md line 91: SQLite is a disposable index; the op log is source of truth.
 * That claim is only true if we can actually throw the index away and rebuild it, so
 * `project()` is a pure function of its two inputs and `rebuild()` in the app calls it
 * after `clearProjection()`. The test that folds the same inputs twice and compares is
 * what stops this from quietly becoming false.
 *
 * Pure and synchronous: no storage, no clock. The caller loads inputs and writes the
 * result.
 */
import type { StoragePort } from '../ports/index.js';
import type {
  Address,
  ChainEvent,
  InvoiceCreatedOp,
  MatchVia,
  Op,
  Signature,
  UnixSeconds,
} from '../types/index.js';
import { dedupEvents, eventKey } from '../normalize/index.js';
import { sortOps } from '../oplog/index.js';

export type InvoiceStatus = 'open' | 'paid' | 'overdue';

export interface InvoiceView {
  readonly invoice: InvoiceCreatedOp;
  readonly status: InvoiceStatus;
  /** Confirmed payments, in confirmation order. */
  readonly payments: readonly PaymentRef[];
}

export interface PaymentRef {
  readonly signature: Signature;
  readonly instructionIndex: number;
  readonly via: MatchVia;
}

export interface WatchedAddressView {
  readonly address: Address;
  readonly label: string;
}

export interface ProjectionState {
  readonly invoices: readonly InvoiceView[];
  readonly watchedAddresses: readonly WatchedAddressView[];
  /** Chain events with no confirmed invoice match -- the "unexplained deposits" list. */
  readonly unmatchedEvents: readonly ChainEvent[];
  readonly categories: ReadonlyMap<string, string>;
  /**
   * Every (invoice, event) pairing a human has EVER rejected, as
   * `${invoiceId}|${eventKey}` (see matchPairKey). A rejection is a compensating op
   * (D4): it must not merely undo the confirm, it must stop the machine from
   * re-proposing the same pair -- auto-matching consults this set so a rejected
   * candidate never silently re-applies over the human's decision. A HUMAN may
   * still re-confirm; only automation is barred.
   */
  readonly rejectedMatches: ReadonlySet<string>;
}

/** Key for a (invoice, event) pairing in `rejectedMatches`. */
export function matchPairKey(
  invoiceId: string,
  event: { readonly signature: Signature; readonly instructionIndex: number },
): string {
  return `${invoiceId}|${eventKey(event)}`;
}

/**
 * Fold ops and chain events into view state.
 *
 * Ops are applied in log order so later decisions supersede earlier ones -- confirming
 * a match then rejecting it leaves the invoice open, which is what the user saw happen.
 */
export function project(
  ops: readonly Op[],
  chainEvents: readonly ChainEvent[],
): ProjectionState {
  const ordered = sortOps(ops);
  const events = dedupEvents(chainEvents);

  const invoices = new Map<string, InvoiceCreatedOp>();
  const watched = new Map<Address, WatchedAddressView>();
  const categories = new Map<string, string>();
  /** invoiceId -> eventKey -> PaymentRef. Keyed so reject can remove precisely. */
  const confirmed = new Map<string, Map<string, PaymentRef>>();
  /**
   * eventKey -> invoiceId currently holding it. One transfer settles at most ONE
   * invoice: a later confirm of the same transfer to a different invoice supersedes
   * the earlier one (later decisions win, as everywhere in this fold), so two
   * invoices can never both read "paid" on the strength of one payment.
   */
  const holder = new Map<string, string>();
  const rejected = new Set<string>();

  for (const op of ordered) {
    switch (op.type) {
      case 'invoice-created':
        invoices.set(op.invoiceId, op);
        break;

      case 'address-watched':
        watched.set(op.address, { address: op.address, label: op.label });
        break;

      case 'address-unwatched':
        // Unwatching drops the address from the UI. Its chain events stay in the
        // index: they may already be matched to invoices and booked as income, and
        // silently retracting recorded income would be a much worse bug than a
        // lingering row.
        watched.delete(op.address);
        break;

      case 'match-confirmed': {
        const key = eventKey(op);
        const previous = holder.get(key);
        if (previous !== undefined && previous !== op.invoiceId) {
          confirmed.get(previous)?.delete(key);
        }
        const forInvoice = confirmed.get(op.invoiceId) ?? new Map<string, PaymentRef>();
        forInvoice.set(key, {
          signature: op.signature,
          instructionIndex: op.instructionIndex,
          via: op.via,
        });
        confirmed.set(op.invoiceId, forInvoice);
        holder.set(key, op.invoiceId);
        break;
      }

      case 'match-rejected': {
        const key = eventKey(op);
        confirmed.get(op.invoiceId)?.delete(key);
        if (holder.get(key) === op.invoiceId) holder.delete(key);
        // Additive on purpose: "was ever rejected" survives later ops, so automation
        // can never re-propose the pair. A later HUMAN confirm still lands above.
        rejected.add(matchPairKey(op.invoiceId, op));
        break;
      }

      case 'category-assigned':
        categories.set(eventKey(op), op.category);
        break;
    }
  }

  const matchedKeys = new Set<string>();
  for (const forInvoice of confirmed.values()) {
    for (const key of forInvoice.keys()) matchedKeys.add(key);
  }

  const invoiceViews: InvoiceView[] = [];
  for (const invoice of invoices.values()) {
    const payments = [...(confirmed.get(invoice.invoiceId)?.values() ?? [])];
    invoiceViews.push({
      invoice,
      status: payments.length > 0 ? 'paid' : 'open',
      payments,
    });
  }

  return {
    invoices: invoiceViews,
    watchedAddresses: [...watched.values()],
    // Failed transactions moved no money: they are not "unexplained deposits" and
    // surfacing them as such would invite the user to book income that never arrived.
    // They stay in the event store (they are chain facts) but not in this list.
    unmatchedEvents: events.filter((e) => e.succeeded && !matchedKeys.has(eventKey(e))),
    categories,
    rejectedMatches: rejected,
  };
}

/**
 * Throw the index away and refold from source (D4).
 *
 * Reads both inputs *before* clearing: the op log because it is the source of truth,
 * chain events because they are the RPC cache -- re-derivable in principle, but S1
 * measured a full re-fetch at minutes of rate-limited quota, so `clearProjection()`
 * must never touch the events table (see StoragePort) and rebuild must not depend on
 * the network. The caller persists the returned state as the new projection.
 *
 * Events are loaded for every address the op log has ever named: every
 * `address-watched` target, and every invoice's `payTo` -- an invoice paid to an
 * address the user never formally watched still had its payment ingested, and a
 * rebuild must not orphan it. Unwatching hides an address from the UI but keeps its
 * events, which may be matched and booked as income -- rebuilding must not silently
 * retract them (see the address-unwatched case above).
 *
 * The clear and the subsequent persist of the returned state are two steps through
 * this port. The app-side StoragePort MUST wrap its `clearProjection` and the write of
 * the new state in one SQLite transaction (or write-then-swap), because Android kills
 * processes mid-work as a matter of routine and a death between the two steps would
 * otherwise leave the user opening onto empty books.
 */
export async function rebuild(storage: StoragePort): Promise<ProjectionState> {
  const ops = await storage.readOps();
  const addresses = new Set<Address>();
  for (const op of ops) {
    if (op.type === 'address-watched') addresses.add(op.address);
    if (op.type === 'invoice-created') addresses.add(op.payTo);
  }

  const events: ChainEvent[] = [];
  for (const address of addresses) {
    // Plain loop, not push(...spread): a busy address holds well over 100k events
    // (S1's scale), and spreading that many arguments overflows the call stack --
    // on Hermes sooner than on Node.
    for (const event of await storage.getChainEvents(address)) events.push(event);
  }

  await storage.clearProjection();
  return project(ops, events);
}

/**
 * Mark open invoices overdue as of `now`.
 *
 * Kept out of `project()` because it is the one part of view state that changes without
 * any op or chain event -- folding it in would make the projection non-deterministic
 * and break the rebuild-equivalence test.
 */
export function withOverdue(state: ProjectionState, now: UnixSeconds): ProjectionState {
  return {
    ...state,
    invoices: state.invoices.map((view) =>
      view.status === 'open' && view.invoice.dueDate < now
        ? { ...view, status: 'overdue' as const }
        : view,
    ),
  };
}
