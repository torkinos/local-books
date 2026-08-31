/**
 * T18 acceptance, arithmetic half: amounts stay bigint end to end, and anything that
 * cannot be totalled exactly throws instead of rounding.
 */
import { describe, expect, it } from 'vitest';
import { InvalidLineItemError, invoiceTotal } from '../src/invoice/index.js';
import type { InvoiceLineItem } from '../src/types/index.js';

const item = (quantity: number, unitAmount: bigint, description = 'work'): InvoiceLineItem => ({
  description,
  quantity,
  unitAmount,
});

describe('invoiceTotal', () => {
  it('sums quantity x unitAmount exactly, in smallest units', () => {
    // 3 x 1250.50 USDC + 1 x 0.000001 USDC -- exact at 6 decimals, where float
    // arithmetic (3 * 1250.5e6 + 1) would still be fine but 0.1-style inputs are not.
    const total = invoiceTotal([item(3, 1_250_500_000n), item(1, 1n)]);
    expect(total).toBe(3_751_500_001n);
  });

  it('stays exact past Number.MAX_SAFE_INTEGER', () => {
    // 9007 SOL x 9999 in lamports overflows a double; bigint must not care.
    const total = invoiceTotal([item(9_999, 9_007_000_000_000n)]);
    expect(total).toBe(90_060_993_000_000_000n);
    expect(total > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('refuses fractional, zero, and negative quantities, naming the line', () => {
    expect(() => invoiceTotal([item(1, 5n), item(2.5, 5n)])).toThrow(InvalidLineItemError);
    expect(() => invoiceTotal([item(1, 5n), item(2.5, 5n)])).toThrow(/Line item 2/);
    expect(() => invoiceTotal([item(0, 5n)])).toThrow(InvalidLineItemError);
    expect(() => invoiceTotal([item(-1, 5n)])).toThrow(InvalidLineItemError);
  });

  it('refuses negative unit amounts and empty invoices', () => {
    expect(() => invoiceTotal([item(1, -5n)])).toThrow(/negative/);
    expect(() => invoiceTotal([])).toThrow(/at least one/);
  });

  it('refuses a zero-total invoice -- it could never be paid or matched', () => {
    expect(() => invoiceTotal([item(3, 0n)])).toThrow(/zero/);
  });
});
