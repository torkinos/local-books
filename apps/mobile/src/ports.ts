/**
 * App-level port assembly: the one place platform modules meet core's interfaces.
 *
 * Grows as T6 (StoragePort over op-sqlite) and T23 (RatePort over NBG) land; each
 * adapter stays individually testable, and only this file may import Expo modules
 * that need a device to run.
 */
import { getRandomValues } from 'expo-crypto';
import type { ClockPort, RpcPort } from '@local-books/core';
import { asUnixSeconds } from '@local-books/core';
import { makeReferenceKeyPort } from './adapters/referenceKeys.js';
import { mainnetEndpoints, devnetEndpoints } from './adapters/rpc.js';

export const referenceKeys = makeReferenceKeyPort((length) =>
  getRandomValues(new Uint8Array(length)),
);

// StoragePort (T6): encrypted SQLite. Async because first open provisions the key.
export { openEncryptedStorage, KeyLostError } from './storage/opsqlite.js';

/** Wall clock in Unix seconds (Solana blockTime units -- never milliseconds). */
export const clock: ClockPort = {
  now: () => asUnixSeconds(Math.floor(Date.now() / 1000)),
};

/**
 * Which chain the app watches. 'devnet' through W2: the demo path (T15/T16) runs
 * against devnet payments end to end. Flips to 'mainnet' when the settings screen
 * lands (post-W2), where the user-supplied RPC URL (PROJECT.md line 72) also plugs
 * into mainnetEndpoints' failover list.
 */
export const NETWORK: 'devnet' | 'mainnet' = 'devnet';

export function rpcEndpoints(userRpcUrl?: string): readonly RpcPort[] {
  return NETWORK === 'mainnet' ? mainnetEndpoints(userRpcUrl) : devnetEndpoints();
}

export { mainnetEndpoints, devnetEndpoints };
