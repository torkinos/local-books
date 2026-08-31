/**
 * Invoice form validation: raw screen strings -> typed invoice fields, or errors.
 *
 * All money parsing goes through core's parseUnits (decimal string -> smallest-unit
 * bigint, throws rather than truncates) and the total through core's invoiceTotal --
 * the screen itself never does arithmetic. Pure functions; the component stays a
 * dumb form.
 */
import type { Address, InvoiceLineItem, UnixSeconds } from '@local-books/core';
import { asUnixSeconds, invoiceTotal, parseUnits } from '@local-books/core';
import type { InvoiceToken } from '../tokens.js';
import { formatTokenAmount } from './format.js';

export interface LineItemInput {
  readonly description: string;
  readonly quantityText: string;
  readonly unitPriceText: string;
}

export interface InvoiceDraftInput {
  readonly clientName: string;
  readonly lineItems: readonly LineItemInput[];
  readonly token: InvoiceToken;
  readonly dueDateText: string;
  readonly payTo: Address | null;
}

export type InvoiceDraftValidation =
  | {
      readonly ok: true;
      readonly clientName: string;
      readonly lineItems: readonly InvoiceLineItem[];
      readonly dueDate: UnixSeconds;
      readonly payTo: Address;
      /** Preview only -- the op recomputes from line items at creation. */
      readonly totalLabel: string;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

export function validateInvoiceDraft(input: InvoiceDraftInput): InvoiceDraftValidation {
  const errors: string[] = [];

  const clientName = input.clientName.trim();
  if (clientName.length === 0) errors.push('Client name is required.');

  if (input.payTo === null) errors.push('Choose which watched address gets paid.');

  const dueDate = dueDateFromYmd(input.dueDateText);
  if (dueDate === null) errors.push('Due date must be a real date, written YYYY-MM-DD.');

  const lineItems: InvoiceLineItem[] = [];
  input.lineItems.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    const description = line.description.trim();
    if (description.length === 0) errors.push(`${label}: description is required.`);

    const quantityText = line.quantityText.trim();
    const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      errors.push(
        `${label}: quantity must be a whole number of 1 or more. ` +
          'Price partial units into the unit price instead.',
      );
    }

    let unitAmount: bigint | null = null;
    try {
      unitAmount = parseUnits(line.unitPriceText.trim(), input.token.decimals);
      if (unitAmount < 0n) {
        errors.push(`${label}: unit price cannot be negative.`);
        unitAmount = null;
      }
    } catch {
      errors.push(
        `${label}: unit price must be a number with at most ` +
          `${input.token.decimals} decimal places (e.g. 1250.50).`,
      );
    }

    if (description.length > 0 && unitAmount !== null && Number.isSafeInteger(quantity) && quantity > 0) {
      lineItems.push({ description, quantity, unitAmount });
    }
  });

  // Totals are refused at zero (an unpayable invoice) -- surface that here where the
  // user can still fix it, with core as the single source of the rule.
  let totalLabel = '';
  if (errors.length === 0) {
    try {
      totalLabel = formatTokenAmount({
        raw: invoiceTotal(lineItems),
        decimals: input.token.decimals,
        mint: input.token.mint,
        symbol: input.token.symbol,
      });
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (errors.length > 0 || input.payTo === null || dueDate === null) {
    return { ok: false, errors };
  }
  return { ok: true, clientName, lineItems, dueDate, payTo: input.payTo, totalLabel };
}

/**
 * 'YYYY-MM-DD' -> Unix seconds at LOCAL end of day. End of day so an invoice due
 * today is not "overdue" at noon; local because the freelancer's deadline is in
 * their own timezone, not UTC's.
 */
export function dueDateFromYmd(text: string): UnixSeconds | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(year, month - 1, day, 23, 59, 59);
  // Date() rolls invalid components over (Feb 30 -> Mar 2); a rolled date was a typo.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return asUnixSeconds(Math.floor(date.getTime() / 1000));
}

/** `now` + N days as 'YYYY-MM-DD' in local time, for the +7/+14/+30 preset chips. */
export function ymdAfterDays(now: UnixSeconds, days: number): string {
  const date = new Date(now * 1000);
  date.setDate(date.getDate() + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
