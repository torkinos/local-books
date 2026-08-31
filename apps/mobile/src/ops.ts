/**
 * Op construction: human decisions become append-only log entries.
 *
 * Ids are content-addressed via core's makeOpId (oplog/index.ts) so the same decision
 * arriving twice -- a double-tapped button today, replication delivering a duplicate
 * post-grant -- collapses to one row. Core does not import a hash function (D3); this
 * is where the app supplies one.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  Address,
  AddressWatchedOp,
  AddressUnwatchedOp,
  InvoiceCreatedOp,
  InvoiceLineItem,
  MatchCandidate,
  MatchConfirmedOp,
  MatchRejectedOp,
  Op,
  ReferenceKey,
  Signature,
  TokenAmount,
  UnixSeconds,
} from '@local-books/core';
import { invoiceTotal, makeOpId } from '@local-books/core';

const hashHex = (input: string): string =>
  [...sha256(new TextEncoder().encode(input))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function withOpId<T extends Omit<Op, 'id'>>(op: T): T & { readonly id: string } {
  return { ...op, id: makeOpId(op, hashHex) };
}

export function addressWatchedOp(address: Address, label: string, at: UnixSeconds): AddressWatchedOp {
  return withOpId({ type: 'address-watched', address, label, at });
}

export function addressUnwatchedOp(address: Address, at: UnixSeconds): AddressUnwatchedOp {
  return withOpId({ type: 'address-unwatched', address, at });
}

export interface InvoiceFields {
  readonly clientName: string;
  readonly lineItems: readonly InvoiceLineItem[];
  /** Mint identity + display metadata for the invoice's token (tokens.ts). */
  readonly token: { readonly mint: Address | null; readonly decimals: number; readonly symbol: string };
  readonly dueDate: UnixSeconds;
  /** Freshly minted via ReferenceKeyPort (D7) -- one per invoice, never reused. */
  readonly reference: ReferenceKey;
  readonly payTo: Address;
}

/**
 * The invoiceId IS the reference key. They are already 1:1 (D7 mints one unique
 * random key per invoice), so a second id would just be a second random string to
 * keep consistent. The reference never re-mints for v0.1 (no invoice editing);
 * if reissuing ever arrives, that is the moment to split the two.
 *
 * Total is computed here, from the line items, in bigint (core's invoiceTotal) --
 * the screen never does money arithmetic.
 */
export function invoiceCreatedOp(fields: InvoiceFields, at: UnixSeconds): InvoiceCreatedOp {
  const total: TokenAmount = {
    raw: invoiceTotal(fields.lineItems),
    decimals: fields.token.decimals,
    mint: fields.token.mint,
    symbol: fields.token.symbol,
  };
  return withOpId({
    type: 'invoice-created',
    at,
    invoiceId: fields.reference,
    clientName: fields.clientName,
    lineItems: fields.lineItems,
    total,
    dueDate: fields.dueDate,
    reference: fields.reference,
    payTo: fields.payTo,
  });
}

/**
 * The compensating op (D4): undoes a confirm AND bars automation from ever
 * re-proposing the pair (projection tracks it in rejectedMatches).
 */
export function matchRejectedOp(
  invoiceId: string,
  signature: Signature,
  instructionIndex: number,
  at: UnixSeconds,
): MatchRejectedOp {
  return withOpId({ type: 'match-rejected', invoiceId, signature, instructionIndex, at });
}

/** Auto-apply is only legal for tier-a candidates the matcher marked unambiguous. */
export function matchConfirmedOp(candidate: MatchCandidate, at: UnixSeconds): MatchConfirmedOp {
  if (candidate.tier !== 'reference' || !candidate.autoApplicable) {
    throw new Error(
      'Only unambiguous reference matches may be auto-confirmed (PROJECT.md line 81). ' +
        'Heuristic or ambiguous candidates need a human tap.',
    );
  }
  return withOpId({
    type: 'match-confirmed',
    invoiceId: candidate.invoiceId,
    signature: candidate.signature,
    instructionIndex: candidate.instructionIndex,
    via: 'reference',
    at,
  });
}
