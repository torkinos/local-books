/**
 * Address input validation for the add-address screen.
 *
 * Watch-only means a mistyped address is not money lost, but it IS minutes of
 * rate-limited backfill quota spent on someone else's history (S1 priced it), so the
 * screen refuses anything that is not a plausible Solana WALLET address: base58,
 * decoding to exactly 32 bytes, and on the ed25519 curve.
 *
 * The curve check is what keeps token accounts out. A wallet's USDC account is an
 * easy paste from an explorer, and watching it alongside the wallet books every
 * payment twice (the same transfer is an `in` for both, and the income statement
 * only dedups per watched address) while its invoices carry a Solana Pay QR that
 * wallets refuse (the recipient must be a wallet). Token accounts are reached
 * through their wallet automatically (D19). Program-derived vaults (multisigs) are
 * off-curve too and stay out for the same reason; multisig ingestion is post-grant.
 */
import bs58 from 'bs58';
import type { Address } from '@local-books/core';
import { asAddress } from '@local-books/core';
import { isOnCurve } from '../sync/ata.js';

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
  if (!isOnCurve(bytes)) {
    return {
      ok: false,
      reason:
        'That is a token account, vault, or program address, not a wallet. Watch the ' +
        'wallet that owns it — its USDC and USDT accounts are tracked automatically.',
    };
  }
  return { ok: true, address: asAddress(trimmed) };
}
