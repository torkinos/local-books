/**
 * Small pure rules behind W5 polish: hardware back (T28/T30), build-time config
 * (D18), and the sync line for token-account passes (D19/T29).
 */
import { describe, expect, it } from 'vitest';
import { STABLE_MINTS, asAddress } from '@local-books/core';
import { CONFIG_WARNINGS, NETWORK, USER_RPC_URL, parseNetwork, parseRpcUrl } from '../src/config.js';
import { invoiceTokensFor, watchedMintsFor } from '../src/tokens.js';
import { backTarget } from '../src/ui/navigation.js';
import { syncStatusLine } from '../src/ui/syncStatus.js';
import type { SyncProgress } from '../src/sync/engine.js';

describe('backTarget', () => {
  it('sub-screens go to their parent; the ledger hands back to Android', () => {
    expect(backTarget('ledger')).toBeNull();
    expect(backTarget('add')).toBe('ledger');
    expect(backTarget('invoices')).toBe('ledger');
    expect(backTarget('income')).toBe('ledger');
    expect(backTarget('create-invoice')).toBe('invoices'); // mirrors its Cancel button
  });
});

describe('parseNetwork', () => {
  it("only the literal 'devnet' is devnet; anything else is mainnet", () => {
    expect(parseNetwork('devnet')).toBe('devnet');
    expect(parseNetwork(undefined)).toBe('mainnet');
    expect(parseNetwork('')).toBe('mainnet');
    expect(parseNetwork('Devnet')).toBe('mainnet');
    expect(parseNetwork('mainnet')).toBe('mainnet');
    expect(parseNetwork('testnet')).toBe('mainnet');
  });
});

describe('parseRpcUrl', () => {
  it('unset, empty, and blank mean "not set"', () => {
    expect(parseRpcUrl(undefined)).toEqual({ kind: 'unset' });
    expect(parseRpcUrl('')).toEqual({ kind: 'unset' });
    expect(parseRpcUrl('   ')).toEqual({ kind: 'unset' });
  });

  it('trims and keeps an http(s) URL; anything else is "invalid", never a throw', () => {
    expect(parseRpcUrl(' https://mainnet.helius-rpc.com/?api-key=x ')).toEqual({
      kind: 'ok',
      url: 'https://mainnet.helius-rpc.com/?api-key=x',
    });
    expect(parseRpcUrl('http://localhost:8899')).toEqual({ kind: 'ok', url: 'http://localhost:8899' });
    expect(parseRpcUrl('helius.com')).toEqual({ kind: 'invalid', value: 'helius.com' });
    expect(parseRpcUrl('wss://rpc.example')).toEqual({ kind: 'invalid', value: 'wss://rpc.example' });
  });

  it('the build-time constants: no env under vitest means mainnet, no user URL, no warnings', () => {
    expect(NETWORK).toBe('mainnet');
    expect(USER_RPC_URL).toBeUndefined();
    expect(CONFIG_WARNINGS).toEqual([]);
  });
});

describe('invoice tokens and watched mints per network (D19)', () => {
  it('mainnet pages the ATAs of exactly the stablecoins valuation supports', () => {
    const mainnetStables = [...STABLE_MINTS.keys()].filter(
      (mint) => mint !== '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    );
    expect([...watchedMintsFor('mainnet')].sort()).toEqual([...mainnetStables].sort());
    expect(invoiceTokensFor('mainnet').map((t) => t.symbol)).toEqual(['USDC', 'USDT', 'SOL']);
  });

  it('devnet pages only Circle devnet USDC, and SOL never has a token account', () => {
    expect(watchedMintsFor('devnet')).toEqual(['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);
    expect(invoiceTokensFor('devnet').some((t) => t.mint === null)).toBe(true);
    expect(watchedMintsFor('devnet')).not.toContain(null);
  });

  it('every watched mint is one valuation knows, on both networks', () => {
    for (const network of ['mainnet', 'devnet'] as const) {
      for (const mint of watchedMintsFor(network)) expect(STABLE_MINTS.has(mint)).toBe(true);
    }
  });
});

describe('syncStatusLine for a token-account pass', () => {
  const owner = asAddress('Owner');
  const ata = asAddress('Ata');
  const progress = (over: Partial<SyncProgress>): SyncProgress => ({
    address: ata,
    owner,
    endpointLabel: 'publicnode',
    mode: 'backfill',
    phase: 'paging',
    pages: 0,
    signaturesSeen: 0,
    transactionsFetched: 0,
    eventsStored: 0,
    ...over,
  });

  it('says the walk is over token-account history, still counts, never a percentage', () => {
    expect(syncStatusLine({ phase: 'syncing', progress: progress({}) })).toBe(
      'Backfilling token-account history…',
    );
    const line = syncStatusLine({
      phase: 'syncing',
      progress: progress({ phase: 'hydrating', pages: 1, pageHydration: { fetched: 3, total: 9 } }),
    });
    expect(line).toBe('Backfilling token-account history — page 1: transaction 3 of 9…');
    expect(line).not.toMatch(/%/);
  });

  it('the between-pages line names token-account history too', () => {
    expect(
      syncStatusLine({ phase: 'syncing', progress: progress({ pages: 2, transactionsFetched: 4 }) }),
    ).toBe('Backfilling token-account history — 2 pages, 4 transactions so far…');
    expect(
      syncStatusLine({ phase: 'syncing', progress: progress({ address: owner, pages: 1, transactionsFetched: 3 }) }),
    ).toBe('Backfilling history — 1 page, 3 transactions so far…');
  });

  it('the wallet itself still reads as plain history', () => {
    expect(syncStatusLine({ phase: 'syncing', progress: progress({ address: owner }) })).toBe(
      'Backfilling history…',
    );
  });
});
