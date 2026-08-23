/**
 * ReferenceKeyPort over a real ed25519 keypair generator (T13, D7).
 *
 * Every invoice gets a fresh reference public key, minted from nothing but CSPRNG
 * output. It MUST stay this way: PROJECT.md line 55 records the rejection of
 * derivable/taggable references -- a reference derived from invoice fields (or from a
 * master key) would let an outsider recognise Local Books invoices on-chain and
 * deanonymise the user's income address. Randomness in, unlinkable key out; the
 * private half is thrown away on purpose, because a reference is an account to *look
 * for*, never to sign with.
 *
 * Randomness is injected rather than imported so the derivation is testable in a
 * plain Node process; the app wires expo-crypto's CSPRNG in ports.ts.
 */
import { getPublicKey, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import type { ReferenceKey, ReferenceKeyPort } from '@local-books/core';
import { asReferenceKey } from '@local-books/core';

// noble v3 needs the hash wired once; sync avoids WebCrypto, which Hermes lacks.
hashes.sha512 = sha512;

export type RandomBytes = (length: number) => Uint8Array;

export function makeReferenceKeyPort(randomBytes: RandomBytes): ReferenceKeyPort {
  return {
    async generate(): Promise<ReferenceKey> {
      const secret = randomBytes(32);
      if (secret.length !== 32) {
        throw new RangeError(`CSPRNG returned ${secret.length} bytes, expected 32`);
      }
      try {
        return asReferenceKey(bs58.encode(getPublicKey(secret)));
      } finally {
        // Zero the secret before dropping it -- on every path, including a throwing
        // derivation. Best-effort on a GC runtime, but there is no reason to leave
        // key material live in a buffer we control.
        secret.fill(0);
      }
    },
  };
}
