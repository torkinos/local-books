/**
 * App-level port assembly: the one place platform modules meet core's interfaces.
 *
 * Grows as T6 (StoragePort over op-sqlite) and T23 (RatePort over NBG) land; each
 * adapter stays individually testable, and only this file may import Expo modules
 * that need a device to run.
 */
import { getRandomValues } from 'expo-crypto';
import type { ClockPort, DocPort, RatePort, RpcPort } from '@local-books/core';
import { asUnixSeconds } from '@local-books/core';
import { makeDocPort } from './adapters/docs.js';
import { CONFIG_WARNINGS, NETWORK, USER_RPC_URL } from './config.js';
import { makeNbgRatePort } from './adapters/rates.js';
import { makeReferenceKeyPort } from './adapters/referenceKeys.js';
import { mainnetEndpoints, devnetEndpoints } from './adapters/rpc.js';
import { openRatesDb } from './storage/opsqlite.js';
import { createRateCache } from './storage/rateCache.js';

export const referenceKeys = makeReferenceKeyPort((length) =>
  getRandomValues(new Uint8Array(length)),
);

// StoragePort (T6): encrypted SQLite. Async because first open provisions the key.
export { openEncryptedStorage, KeyLostError } from './storage/opsqlite.js';

// DocPort (T19/T20): expo-print + expo-sharing behind core's interface.
export const docs: DocPort = makeDocPort();

/** Wall clock in Unix seconds (Solana blockTime units -- never milliseconds). */
export const clock: ClockPort = {
  now: () => asUnixSeconds(Math.floor(Date.now() / 1000)),
};

/**
 * RatePort (T23): NBG daily rates over a plain SQLite cache. Lazy singleton --
 * opening the cache DB is async, and the ledger must not wait on it (valuation is a
 * report-time concern). A failed open is forgotten rather than memoized, so the next
 * visit to the income screen retries instead of being bricked until restart.
 */
let ratePortPromise: Promise<RatePort> | null = null;
export function openRatePort(): Promise<RatePort> {
  if (ratePortPromise === null) {
    ratePortPromise = (async () =>
      makeNbgRatePort({ cache: await createRateCache(openRatesDb()), clock }))();
    ratePortPromise.catch(() => {
      ratePortPromise = null;
    });
  }
  return ratePortPromise;
}

/**
 * Which chain the app watches, and the optional personal RPC endpoint, are
 * BUILD-TIME switches (D18) parsed in config.ts: `EXPO_PUBLIC_NETWORK=devnet` in
 * apps/mobile/.env.development for the demo path, nothing -- mainnet -- for the
 * Release APK; `EXPO_PUBLIC_RPC_URL` goes first in the failover list. The ledger
 * header shows a 'devnet' tag so footage and testers can tell which build they
 * hold. A settings screen is post-freeze work; until then the escape hatch is a
 * rebuild, not a paste.
 */
export { NETWORK } from './config.js';

for (const warning of CONFIG_WARNINGS) console.warn(`[local-books config] ${warning}`);

export function rpcEndpoints(userRpcUrl: string | undefined = USER_RPC_URL): readonly RpcPort[] {
  return NETWORK === 'mainnet' ? mainnetEndpoints(userRpcUrl) : devnetEndpoints(userRpcUrl);
}

export { mainnetEndpoints, devnetEndpoints };
