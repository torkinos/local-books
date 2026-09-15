/**
 * Associated token account (ATA) derivation, done locally (D19).
 *
 * WHY THIS EXISTS: `getSignaturesForAddress(owner)` only returns transactions whose
 * account list names the OWNER wallet. A plain SPL `transfer`/`transferChecked` into
 * an already-existing token account names the token account and the payer -- never
 * the recipient's wallet. So after the first USDC payment (whose ATA-create
 * instruction does name the owner), every later USDC payment into that account is
 * invisible to owner-only paging. The sync engine therefore pages each stablecoin
 * ATA alongside the owner (sync/wallet.ts), and this module computes those
 * addresses offline: the derivation is a fixed function of (owner, mint), so no
 * indexed RPC method is needed -- publicnode gates `getTokenAccountsByOwner` behind
 * an API key, and the S1 spike found only two open public endpoints to begin with.
 *
 * The derivation mirrors the on-chain program: sha256(owner ‖ tokenProgram ‖ mint ‖
 * bump ‖ ataProgram ‖ "ProgramDerivedAddress"), first bump from 255 downward whose
 * hash is NOT a valid ed25519 point. Verified against real mainnet transactions in
 * test/wallet.test.ts (both token accounts in the fixture were created by
 * `createIdempotent`, so they are ATAs by construction).
 *
 * Classic SPL Token program only. Token-2022 mints derive with a different token
 * program id and are on the deferred list (PROJECT.md line 126).
 */
import { Point } from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import type { Address } from '@local-books/core';
import { asAddress } from '@local-books/core';

export const TOKEN_PROGRAM_ID = asAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = asAddress('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

function decodeKey(value: string, what: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new RangeError(`${what} is not base58: ${value}`);
  }
  if (bytes.length !== 32) {
    throw new RangeError(`${what} must decode to 32 bytes, got ${bytes.length}: ${value}`);
  }
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A program-derived address must NOT decode as a curve point; that is the whole rule. */
export function isOnCurve(bytes: Uint8Array): boolean {
  try {
    Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Solana's `find_program_address`: the highest bump (255 down) whose hash is off
 * the curve. Seeds are at most 32 bytes each by protocol; ours are exactly 32.
 */
export function findProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): { readonly address: Uint8Array; readonly bump: number } {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concat([...seeds, Uint8Array.of(bump), programId, PDA_MARKER]));
    if (!isOnCurve(hash)) return { address: hash, bump };
  }
  // Probability ~2^-256 -- but a silent wrong address here would silently hide
  // income, so it throws rather than returning anything.
  throw new Error('No viable program-derived address bump found');
}

/** The owner's associated token account for `mint` under the classic Token program. */
export function associatedTokenAddress(owner: Address, mint: Address): Address {
  const derived = findProgramAddress(
    [decodeKey(owner, 'owner'), decodeKey(TOKEN_PROGRAM_ID, 'token program'), decodeKey(mint, 'mint')],
    decodeKey(ASSOCIATED_TOKEN_PROGRAM_ID, 'associated token program'),
  );
  return asAddress(bs58.encode(derived.address));
}
