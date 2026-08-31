/**
 * Invoice arithmetic (T18). Bigint end to end -- PROJECT.md's rule that money never
 * touches a float applies to what the user is ASKING for as much as to what arrived.
 *
 * v0.1 constraint, deliberate: line-item quantities are positive INTEGERS. Fractional
 * quantities (2.5 hours) invite float drift through the quantity field the moment
 * anyone recomputes a total; a freelancer prices partial hours into `unitAmount`
 * instead ("2.5h @ $50" is "1 × $125" or "150min × $0.83̅" -- the invoice says what it
 * means either way). Revisit only with exact decimal-string quantities, never number.
 */
import type { InvoiceLineItem } from '../types/index.js';

/** A line item that cannot be totalled exactly. Thrown, never rounded past. */
export class InvalidLineItemError extends Error {
  constructor(index: number, reason: string) {
    super(`Line item ${index + 1}: ${reason}`);
    this.name = 'InvalidLineItemError';
  }
}

/**
 * Total in the token's smallest unit. Throws on anything that cannot be computed
 * exactly: non-integer or non-positive quantities, negative unit amounts, an empty
 * item list. An invoice for zero is refused too -- it cannot be paid, so it could
 * never be matched, and it would sit "open" forever.
 */
export function invoiceTotal(lineItems: readonly InvoiceLineItem[]): bigint {
  if (lineItems.length === 0) {
    throw new InvalidLineItemError(0, 'an invoice needs at least one line item');
  }
  let total = 0n;
  for (const [index, item] of lineItems.entries()) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new InvalidLineItemError(
        index,
        `quantity must be a positive whole number, got ${item.quantity}. ` +
          'Price partial units into the unit amount instead.',
      );
    }
    if (item.unitAmount < 0n) {
      throw new InvalidLineItemError(index, 'unit amount cannot be negative');
    }
    total += BigInt(item.quantity) * item.unitAmount;
  }
  if (total === 0n) {
    throw new InvalidLineItemError(0, 'the invoice total is zero; it could never be paid');
  }
  return total;
}
