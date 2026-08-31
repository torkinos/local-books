/**
 * Solana Pay transfer-request URLs (T20's pure half).
 *
 * Spec: https://github.com/anza-xyz/solana-pay/blob/master/SPEC.md — a `solana:`
 * URL naming recipient, amount (in USER units, decimal), spl-token mint, reference
 * accounts, and display strings. Phantom and friends parse this into a pre-filled
 * transfer. Built by hand rather than via a library or URLSearchParams: the output
 * must be byte-stable (tests and QR payloads depend on it), `reference` legally
 * repeats, and Hermes' URLSearchParams is not something to build an invoice's
 * payment path on.
 *
 * Two invariants matter more than the rest:
 *   - The amount comes from the invoice's bigint through formatUnitsTrimmed —
 *     exact digits, never a float, never exponent notation. A wallet parsing
 *     "1.25e2" would reject or, worse, guess.
 *   - The recipient is the WALLET address (the payer's wallet derives the token
 *     account), which is exactly what invoices store in `payTo`.
 */
import type { Address, ReferenceKey, TokenAmount } from '../types/index.js';
import { formatUnitsTrimmed } from '../value/index.js';

export interface TransferRequest {
  /** Wallet address to pay -- the invoice's payTo. */
  readonly recipient: Address;
  /**
   * What to ask for. `mint: null` (native SOL) omits spl-token per spec; the
   * amount is rendered in user units from the exact bigint.
   */
  readonly amount: TokenAmount;
  /** The invoice's reference key (D7) -- how tier-a matching finds the payment. */
  readonly reference: ReferenceKey;
  /** Merchant/requester display name, shown by the wallet. */
  readonly label?: string;
  /** Payment description, shown by the wallet. */
  readonly message?: string;
  /** Memo the wallet should attach ON CHAIN. Public forever -- keep it sparse. */
  readonly memo?: string;
}

/**
 * `solana:<recipient>?amount=..&spl-token=..&reference=..&label=..&message=..&memo=..`
 *
 * Query order is fixed so the same request always yields the same string.
 */
export function transferRequestUrl(request: TransferRequest): string {
  const params: string[] = [];
  params.push(`amount=${formatUnitsTrimmed(request.amount.raw, request.amount.decimals)}`);
  if (request.amount.mint !== null) {
    params.push(`spl-token=${encodeURIComponent(request.amount.mint)}`);
  }
  params.push(`reference=${encodeURIComponent(request.reference)}`);
  if (request.label !== undefined) params.push(`label=${encodeURIComponent(request.label)}`);
  if (request.message !== undefined) params.push(`message=${encodeURIComponent(request.message)}`);
  if (request.memo !== undefined) params.push(`memo=${encodeURIComponent(request.memo)}`);
  return `solana:${encodeURIComponent(request.recipient)}?${params.join('&')}`;
}
