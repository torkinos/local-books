/**
 * T9 acceptance, live half: "fetches a real page of signatures on devnet."
 *
 * Network tests do not belong in CI, so this runs only when DEVNET_INTEGRATION is
 * set:  DEVNET_INTEGRATION=1 npx vitest run test/rpc.devnet.integration.test.ts
 * Last verified from a real run: see the T9 note in TASKS.md.
 */
import { describe, expect, it } from 'vitest';
import type { Address, Signature } from '@local-books/core';
import { RpcResponseError, devnetEndpoints } from '../src/adapters/rpc.js';

// Wrapped-SOL mint: exists on every cluster and is extremely active on devnet.
const BUSY_DEVNET_ADDRESS = 'So11111111111111111111111111111111111111112' as Address;

// Structurally valid, never landed anywhere: exercises the unknown-cursor and
// unknown-transaction paths against a real node.
const UNKNOWN_SIG =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;

describe.runIf(process.env['DEVNET_INTEGRATION'])('devnet, live', () => {
  it('fetches a real page of signatures, and a real cursor pages onward', async () => {
    const [devnet] = devnetEndpoints();
    const page = await devnet!.getSignatures(BUSY_DEVNET_ADDRESS, { limit: 10 });

    expect(page.signatures.length).toBeGreaterThan(0);
    expect(page.signatures.length).toBeLessThanOrEqual(10);
    for (const s of page.signatures) {
      expect(s.signature.length).toBeGreaterThan(43);
      expect(s.slot).toBeGreaterThan(0);
    }

    const next = await devnet!.getSignatures(BUSY_DEVNET_ADDRESS, {
      before: page.nextBefore!,
      limit: 5,
    });
    expect(next.signatures.length).toBeGreaterThan(0);
  }, 30_000);

  it('an empty page behind an UNKNOWN cursor throws instead of declaring exhaustion', async () => {
    // Verified live 2026-08-27: a real node answers an unknown `before` with an
    // EMPTY page, exactly the shape that would have durably marked the backfill
    // complete and truncated the books. The cursor verification must catch it.
    const [devnet] = devnetEndpoints();
    await expect(
      devnet!.getSignatures(BUSY_DEVNET_ADDRESS, { before: UNKNOWN_SIG, limit: 5 }),
    ).rejects.toBeInstanceOf(RpcResponseError);
  }, 30_000);

  it('a null getTransaction result is omitted, not returned as fetched', async () => {
    const [devnet] = devnetEndpoints();
    const txs = await devnet!.getTransactions([UNKNOWN_SIG]);
    expect(txs).toHaveLength(0);
  }, 30_000);
});
