/**
 * Display formatting for the ledger. Pure string work, testable in Node.
 *
 * Money display always goes through core's formatUnits (bigint -> exact decimal
 * string); nothing here ever converts an amount to a float.
 */
import type { TokenAmount, UnixSeconds } from '@local-books/core';
import { formatUnitsTrimmed } from '@local-books/core';

/** 'EPjF...Dt1v' -- enough to recognise, short enough for a list row. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * '1.234567 USDC', '0.05 SOL', '12 tokens (EPjF...Dt1v)' for an unknown mint.
 *
 * Trailing zeros in the fraction are trimmed for reading ('1.500000' -> '1.5'); the
 * exact value stays in the event store untouched.
 */
export function formatTokenAmount(amount: TokenAmount): string {
  const value = formatUnitsTrimmed(amount.raw, amount.decimals);
  if (amount.symbol !== undefined) return `${value} ${amount.symbol}`;
  if (amount.mint === null) return `${value} SOL`;
  return `${value} tokens (${shortAddress(amount.mint)})`;
}

/** Due dates are day-granular: local calendar date, no time of day. */
export function formatDueDate(dueDate: UnixSeconds): string {
  return new Date(dueDate * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Block time -> a local calendar date + time. Old transactions can lack blockTime
 * (the RPC stops serving it); say so instead of inventing a date.
 */
export function formatBlockTime(blockTime: UnixSeconds | null): string {
  if (blockTime === null) return 'date unknown';
  const date = new Date(blockTime * 1000);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
