/**
 * Tokens the invoice screen offers, per network.
 *
 * The mint is identity; symbol and decimals are display metadata pinned here so an
 * invoice's TokenAmount is complete at creation. Stablecoins lead because v0.1
 * values stablecoin income only (PROJECT.md line 85) -- SOL is offered for demo
 * ergonomics (devnet SOL comes from a faucet in seconds) with the valuation gap
 * surfacing in W4's screens, not silently.
 */
import type { Address } from '@local-books/core';
import { asAddress } from '@local-books/core';
import { NETWORK } from './ports.js';

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

export function invoiceTokens(): readonly InvoiceToken[] {
  return NETWORK === 'mainnet' ? MAINNET_TOKENS : DEVNET_TOKENS;
}
