/**
 * T13 tests. The load-bearing property is D7/PROJECT.md line 55: keys are pure
 * functions of CSPRNG output and nothing else -- random, unlinkable, and never
 * derived from invoice fields (there ARE no other inputs to derive from).
 */
import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { makeReferenceKeyPort } from '../src/adapters/referenceKeys.js';

const csprng = (length: number): Uint8Array =>
  // Node's WebCrypto stands in for expo-crypto; the adapter cannot tell the difference.
  globalThis.crypto.getRandomValues(new Uint8Array(length));

describe('makeReferenceKeyPort', () => {
  it('1000 generated keys are unique', async () => {
    const port = makeReferenceKeyPort(csprng);
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      keys.add(await port.generate());
    }
    expect(keys.size).toBe(1000);
  });

  it('emits base58-encoded 32-byte ed25519 public keys', async () => {
    const key = await makeReferenceKeyPort(csprng).generate();
    const decoded = bs58.decode(key);
    expect(decoded).toHaveLength(32);
  });

  it('is a pure function of the CSPRNG output -- no other inputs exist to link keys to', async () => {
    const fixed = (length: number): Uint8Array => new Uint8Array(length).fill(7);
    const a = await makeReferenceKeyPort(fixed).generate();
    const b = await makeReferenceKeyPort(fixed).generate();
    expect(a).toBe(b);

    const other = (length: number): Uint8Array => new Uint8Array(length).fill(8);
    expect(await makeReferenceKeyPort(other).generate()).not.toBe(a);
  });

  it('rejects a CSPRNG that returns the wrong length instead of padding it', async () => {
    const short = (): Uint8Array => new Uint8Array(16);
    await expect(makeReferenceKeyPort(short).generate()).rejects.toThrow(RangeError);
  });

  it('derives the RFC 8032 TEST1 vector -- pinning the whole ed25519 + base58 chain', async () => {
    // Without a known answer, every test here would pass if generate() returned the
    // encoded SECRET (or hash-miswired garbage). One vector rules that whole class out.
    const secretHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
    const publicHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const hexToBytes = (hex: string): Uint8Array =>
      new Uint8Array(hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));

    const key = await makeReferenceKeyPort(() => hexToBytes(secretHex)).generate();
    expect(key).toBe(bs58.encode(hexToBytes(publicHex)));
  });

  it('zeroes the secret buffer after derivation', async () => {
    const retained = globalThis.crypto.getRandomValues(new Uint8Array(32));
    await makeReferenceKeyPort(() => retained).generate();
    expect([...retained].every((byte) => byte === 0)).toBe(true);
  });
});
