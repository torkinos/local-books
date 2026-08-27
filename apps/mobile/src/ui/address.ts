/**
 * Address input validation for the add-address screen.
 *
 * Watch-only means a mistyped address is not money lost, but it IS minutes of
 * rate-limited backfill quota spent on someone else's history (S1 priced it), so the
 * screen refuses anything that is not a plausible Solana account address: base58,
 * decoding to exactly 32 bytes.
 */
import bs58 from 'bs58';
import type { Address } from '@local-books/core';
import { asAddress } from '@local-books/core';

export type AddressValidation =
  | { readonly ok: true; readonly address: Address }
  | { readonly ok: false; readonly reason: string };

export function validateAddress(input: string): AddressValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Paste a Solana address to watch.' };
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(trimmed);
  } catch {
    return {
      ok: false,
      reason: 'Not a valid address: contains characters outside base58 (0, O, I, l are never used).',
    };
  }
  if (bytes.length !== 32) {
    return {
      ok: false,
      reason:
        bytes.length === 64
          ? 'That looks like a transaction signature, not an address. Paste the account address.'
          : 'Not a valid address: a Solana address decodes to 32 bytes.',
    };
  }
  return { ok: true, address: asAddress(trimmed) };
}
