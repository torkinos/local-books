/**
 * T9 acceptance, live half: "fetches a real page of signatures on devnet."
 *
 * Network tests do not belong in CI, so this runs only when DEVNET_INTEGRATION is
 * set:  DEVNET_INTEGRATION=1 npx vitest run test/rpc.devnet.integration.test.ts
 * Last verified from a real run: see the T9 note in TASKS.md.
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '@local-books/core';
import { devnetEndpoints } from '../src/adapters/rpc.js';

// Wrapped-SOL mint: exists on every cluster and is extremely active on devnet.
const BUSY_DEVNET_ADDRESS = 'So11111111111111111111111111111111111111112' as Address;

describe.runIf(process.env['DEVNET_INTEGRATION'])('devnet, live', () => {
  it('fetches a real page of signatures', async () => {
    const [devnet] = devnetEndpoints();
    const page = await devnet!.getSignatures(BUSY_DEVNET_ADDRESS, { limit: 10 });

    expect(page.signatures.length).toBeGreaterThan(0);
    expect(page.signatures.length).toBeLessThanOrEqual(10);
    for (const s of page.signatures) {
      expect(s.signature.length).toBeGreaterThan(43);
      expect(s.slot).toBeGreaterThan(0);
    }
  }, 30_000);
});
