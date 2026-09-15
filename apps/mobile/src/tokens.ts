/**
 * Tokens the invoice screen offers, per network -- and, derived from the same list,
 * the mints whose associated token accounts every watched wallet is paged for (D19).
 *
 * The mint is identity; symbol and decimals are display metadata pinned here so an
 * invoice's TokenAmount is complete at creation. Stablecoins lead because v0.1
 * values stablecoin income only (PROJECT.md line 85) -- SOL is offered for demo
 * ergonomics (devnet SOL comes from a faucet in seconds) with the valuation gap
 * surfacing in W4's screens, not silently.
 *
 * Imports the network from config.ts, NOT ports.ts: ports.ts pulls in native
 * modules, and this module must stay importable under vitest so the per-network
 * lists are tested (test/navigation.test.ts).
 */
import type { Address } from '@local-books/core';
import { asAddress } from '@local-books/core';
import { NETWORK } from './config.js';
import type { Network } from './config.js';

export interface InvoiceToken {
  readonly label: string;
  /** null = native SOL. */
  readonly mint: Address | null;
  readonly decimals: number;
  readonly symbol: string;
}

const DEVNET_TOKENS: readonly InvoiceToken[] = [
  {
    label: 'USDC (devnet)',
    // Circle's devnet USDC -- also in core's STABLE_MINTS so valuation works.
    mint: asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    decimals: 6,
    symbol: 'USDC',
  },
  { label: 'SOL', mint: null, decimals: 9, symbol: 'SOL' },
];

const MAINNET_TOKENS: readonly InvoiceToken[] = [
  {
    label: 'USDC',
    mint: asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    decimals: 6,
    symbol: 'USDC',
  },
  {
    label: 'USDT',
    mint: asAddress('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    decimals: 6,
    symbol: 'USDT',
  },
  { label: 'SOL', mint: null, decimals: 9, symbol: 'SOL' },
];

export function invoiceTokensFor(network: Network): readonly InvoiceToken[] {
  return network === 'mainnet' ? MAINNET_TOKENS : DEVNET_TOKENS;
}

export function invoiceTokens(): readonly InvoiceToken[] {
  return invoiceTokensFor(NETWORK);
}

/**
 * Mints whose associated token accounts are paged alongside each watched wallet
 * (D19): every SPL invoice token of the network. SOL has no token account.
 */
export function watchedMintsFor(network: Network): readonly Address[] {
  return invoiceTokensFor(network).flatMap((token) => (token.mint === null ? [] : [token.mint]));
}
