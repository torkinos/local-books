/**
 * Wallet-level sync (D19): a watched wallet is the owner address PLUS its stablecoin
 * associated token accounts, each paged with its own checkpoint.
 *
 * The owner-only walk misses most SPL income: a `transferChecked` into an existing
 * USDC account names the token account and the payer, never the recipient wallet, so
 * `getSignaturesForAddress(owner)` sees the ATA-create (first payment) and nothing
 * after it. Paging the ATAs closes that hole. Their events are normalized under the
 * owner (engine option `owner`), so direction, counterparty, dedup identity, and
 * every downstream consumer keep working on the wallet address alone.
 *
 * Which mints: the invoice tokens for the running network (tokens.ts) -- USDC and
 * USDT on mainnet, devnet USDC on devnet -- injected by the caller so this module
 * stays free of Expo imports and runs under vitest. Deriving for every known mint
 * would cost an extra getSignatures call per sync for accounts that cannot exist on
 * this network.
 *
 * Sub-runs are sequential and share one AbortSignal. The first non-'complete' result
 * ends the pass and is returned: 'page-budget-reached' lets the caller loop (the
 * wallet's own incremental check on the next iteration is one cheap call),
 * 'endpoints-exhausted' would only repeat on the next account, and 'cancelled' is
 * the caller's own request. Totals are summed across accounts.
 */
import type { Address } from '@local-books/core';
import { associatedTokenAddress } from './ata.js';
import { syncAddress } from './engine.js';
import type { SyncDeps, SyncEngineOptions, SyncResult, SyncTotals } from './engine.js';

export interface TokenAccountRef {
  readonly mint: Address;
  readonly address: Address;
}

export interface WalletAddresses {
  readonly owner: Address;
  readonly tokenAccounts: readonly TokenAccountRef[];
}

/** The wallet and its associated token accounts for `mints`, in paging order. */
export function walletAddresses(owner: Address, mints: readonly Address[]): WalletAddresses {
  const seen = new Set<Address>();
  const tokenAccounts: TokenAccountRef[] = [];
  for (const mint of mints) {
    if (seen.has(mint)) continue;
    seen.add(mint);
    tokenAccounts.push({ mint, address: associatedTokenAddress(owner, mint) });
  }
  return { owner, tokenAccounts };
}

function addTotals(into: SyncTotals, from: SyncTotals): void {
  into.pages += from.pages;
  into.signaturesSeen += from.signaturesSeen;
  into.transactionsFetched += from.transactionsFetched;
  into.eventsStored += from.eventsStored;
}

/**
 * One sync pass over the wallet and its token accounts. See module comment for the
 * stop rule; per-account progress reaches `deps.onProgress` with `owner` set so the
 * UI can key status by wallet.
 */
export async function syncWallet(
  owner: Address,
  mints: readonly Address[],
  deps: SyncDeps,
  options: SyncEngineOptions = {},
): Promise<SyncResult> {
  const totals: SyncTotals = { pages: 0, signaturesSeen: 0, transactionsFetched: 0, eventsStored: 0 };
  const { tokenAccounts } = walletAddresses(owner, mints);
  const targets: readonly Address[] = [owner, ...tokenAccounts.map((t) => t.address)];

  for (const target of targets) {
    const result = await syncAddress(target, deps, { ...options, owner });
    addTotals(totals, result.totals);
    if (result.kind !== 'complete') return { ...result, totals };
  }
  return { kind: 'complete', totals };
}
