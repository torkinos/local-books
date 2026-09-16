/**
 * The pure halves of the T15 screens: address validation, display formatting, sync
 * status copy, and content-addressed op construction. The components stay thin;
 * everything decidable is decided here where Node can test it.
 */
import { describe, expect, it } from 'vitest';
import type { Address, TokenAmount } from '@local-books/core';
import { asAddress, asUnixSeconds } from '@local-books/core';
import { validateAddress } from '../src/ui/address.js';
import { formatTokenAmount, shortAddress } from '../src/ui/format.js';
import { syncStatusLine } from '../src/ui/syncStatus.js';
import type { AddressSyncState } from '../src/ui/syncStatus.js';
import { addressWatchedOp, addressUnwatchedOp } from '../src/ops.js';
import type { SyncProgress } from '../src/sync/engine.js';

const USDC_MINT = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

describe('validateAddress', () => {
  // A real 32-byte account (the USDC mint) -- valid base58 of the right length.
  it('accepts a well-formed address, trimming whitespace', () => {
    const result = validateAddress('  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  ');
    expect(result).toEqual({ ok: true, address: USDC_MINT });
  });

  it('rejects empty input with an instruction, not a complaint', () => {
    const result = validateAddress('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects non-base58 characters (0, O, I, l)', () => {
    const result = validateAddress('0OIl' + 'a'.repeat(40));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/base58/);
  });

  it('recognises a pasted transaction signature (64 bytes) and says so', () => {
    // 88 base58 chars decoding to 64 bytes -- the classic wrong paste.
    const signature =
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
    const result = validateAddress(signature);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/signature/);
  });

  it('rejects base58 of the wrong length', () => {
    const result = validateAddress('abc');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/32 bytes/);
  });

  it('rejects a token account (off-curve) and points at the wallet that owns it', () => {
    // 9WzD…'s real mainnet USDC associated token account (pinned in wallet.test.ts).
    // Watching it next to the wallet would book every payment twice.
    const result = validateAddress('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/token account/);
    expect(!result.ok && result.reason).toMatch(/wallet that owns it/);
    // The owning wallet itself is on-curve and accepted.
    expect(validateAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM').ok).toBe(true);
  });
});

describe('formatTokenAmount', () => {
  const usdc = (raw: bigint): TokenAmount => ({ raw, decimals: 6, mint: USDC_MINT, symbol: 'USDC' });

  it('renders exact units with the symbol, trimming trailing zeros', () => {
    expect(formatTokenAmount(usdc(1_500_000n))).toBe('1.5 USDC');
    expect(formatTokenAmount(usdc(1_234_567n))).toBe('1.234567 USDC');
    expect(formatTokenAmount(usdc(0n))).toBe('0 USDC');
  });

  it('labels native SOL', () => {
    const sol: TokenAmount = { raw: 50_000_000n, decimals: 9, mint: null, symbol: 'SOL' };
    expect(formatTokenAmount(sol)).toBe('0.05 SOL');
  });

  it('falls back to a shortened mint for unknown tokens instead of guessing a symbol', () => {
    const unknown: TokenAmount = { raw: 12_000_000n, decimals: 6, mint: USDC_MINT };
    expect(formatTokenAmount(unknown)).toBe('12 tokens (EPjF…Dt1v)');
  });
});

describe('shortAddress', () => {
  it('shortens long addresses and leaves short strings alone', () => {
    expect(shortAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('EPjF…Dt1v');
    expect(shortAddress('short')).toBe('short');
  });
});

describe('syncStatusLine', () => {
  const ADDRESS = asAddress('Addr');
  const progress = (over: Partial<SyncProgress>): SyncProgress => ({
    address: ADDRESS,
    owner: ADDRESS,
    endpointLabel: 'publicnode',
    mode: 'backfill',
    phase: 'paging',
    pages: 0,
    signaturesSeen: 0,
    transactionsFetched: 0,
    eventsStored: 0,
    ...over,
  });

  it('says nothing when idle and synced', () => {
    expect(syncStatusLine(undefined)).toBeNull();
    expect(syncStatusLine({ phase: 'idle' })).toBeNull();
    expect(
      syncStatusLine({
        phase: 'idle',
        lastResult: { kind: 'complete', totals: { pages: 1, signaturesSeen: 1, transactionsFetched: 1, eventsStored: 1 } },
      }),
    ).toBeNull();
  });

  it('shows hydration counts during a backfill, never a percentage', () => {
    const line = syncStatusLine({
      phase: 'syncing',
      progress: progress({ phase: 'hydrating', pages: 2, pageHydration: { fetched: 40, total: 250 } }),
    });
    expect(line).toBe('Backfilling history — page 2: transaction 40 of 250…');
    expect(line).not.toMatch(/%/);
  });

  it('names the throttling endpoint and the wait during backoff', () => {
    const line = syncStatusLine({
      phase: 'syncing',
      progress: progress({ phase: 'backoff', backoffMs: 10_000 }),
    });
    expect(line).toBe('Rate limited by publicnode — waiting 10s…');
  });

  it('frames incremental sync as checking, never as live', () => {
    const line = syncStatusLine({
      phase: 'syncing',
      progress: progress({ mode: 'incremental' }),
    });
    expect(line).toBe('Checking for new payments…');
    expect(line).not.toMatch(/real.?time|live/i);
  });

  it('an exhausted-endpoints run says what happens next', () => {
    const state: AddressSyncState = {
      phase: 'idle',
      lastResult: {
        kind: 'endpoints-exhausted',
        totals: { pages: 0, signaturesSeen: 0, transactionsFetched: 0, eventsStored: 0 },
        lastError: new Error('x'),
      },
    };
    expect(syncStatusLine(state)).toMatch(/retry/i);
  });
});

describe('ops helpers', () => {
  const at = asUnixSeconds(1_700_000_000);
  const address = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

  it('derives content-addressed ids: same decision, same id; different decision, different id', () => {
    const a = addressWatchedOp(address, 'Income', at);
    const b = addressWatchedOp(address, 'Income', at);
    const c = addressWatchedOp(address, 'Savings', at);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('watch and unwatch of the same address are distinct ops', () => {
    const watch = addressWatchedOp(address, 'Income', at);
    const unwatch = addressUnwatchedOp(address, at);
    expect(watch.id).not.toBe(unwatch.id);
    expect(unwatch.type).toBe('address-unwatched');
  });
});
