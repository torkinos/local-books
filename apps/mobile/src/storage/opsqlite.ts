/**
 * Device wiring for T6: op-sqlite with SQLCipher, key held in the platform keystore
 * via expo-secure-store.
 *
 * SQLCipher is enabled by the `"op-sqlite": { "sqlcipher": true }` block in this
 * package's package.json (a prebuild-time switch -- D2), and `isSQLCipher()` is
 * asserted at open so a build that silently lost the flag fails loudly instead of
 * writing the user's financial records to disk in plaintext.
 *
 * The database key is 32 CSPRNG bytes minted on first launch and stored ONLY in
 * SecureStore (AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: available to background sync
 * after boot, never migrated by backup). It is never derived from anything and never
 * logged.
 *
 * **The key-loss rule** (D12) -- no key + provisioning marker => KeyLostError, never
 * a silent re-mint -- lives as a decision table in keyProvision.ts, where the test
 * suite exercises every row in plain Node; this file injects the real keystore and
 * CSPRNG into it.
 *
 * This file is the only place the native module is touched; everything SQL lives in
 * sqliteStorage.ts where the test suite runs it against real SQLite in Node.
 */
import { isSQLCipher, open } from '@op-engineering/op-sqlite';
import { getRandomValues } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { StoragePort } from '@local-books/core';
import { resolveDbKey, toHex } from './keyProvision.js';
import { createSqliteStorage, type SqlExecutor } from './sqliteStorage.js';

export { KeyLostError } from './keyProvision.js';

const KEY_STORE_ENTRY = 'local-books.sqlcipher-key';
const DB_NAME = 'local-books.db';
const META_DB_NAME = 'local-books-meta.db';
const RATES_DB_NAME = 'local-books-rates.db';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function wrapExecutor(db: ReturnType<typeof open>): SqlExecutor {
  return {
    async execute(sql, params) {
      const result = await db.execute(sql, params ? [...params] : []);
      return { rows: (result.rows ?? []) as readonly Record<string, unknown>[] };
    },
  };
}

/**
 * Plain (unencrypted) DB for the NBG rate cache (T23). Deliberately outside
 * SQLCipher: official exchange rates are public data and re-fetchable, so they hold
 * no secrets worth encrypting -- and a lost books key (D12) must never take the rate
 * cache down with it.
 */
export function openRatesDb(): SqlExecutor {
  return wrapExecutor(open({ name: RATES_DB_NAME }));
}

export async function openEncryptedStorage(): Promise<StoragePort> {
  if (!isSQLCipher()) {
    throw new Error(
      'op-sqlite was built WITHOUT SQLCipher -- refusing to store books in plaintext. ' +
        'Check the "op-sqlite": {"sqlcipher": true} block in apps/mobile/package.json ' +
        'and re-run prebuild (D1/D2).',
    );
  }

  // Plain, unencrypted, secret-free: one row recording that a key was provisioned.
  const meta = wrapExecutor(open({ name: META_DB_NAME }));
  const { key, provisioningNeeded, markProvisioned } = await resolveDbKey({
    meta,
    getStoredKey: () => SecureStore.getItemAsync(KEY_STORE_ENTRY, SECURE_STORE_OPTIONS),
    storeKey: (value) => SecureStore.setItemAsync(KEY_STORE_ENTRY, value, SECURE_STORE_OPTIONS),
    mintKeyHex: () => toHex(getRandomValues(new Uint8Array(32))),
  });

  const db = open({ name: DB_NAME, encryptionKey: key });
  const storage = await createSqliteStorage(wrapExecutor(db));

  // Recorded only after the encrypted DB opened successfully with this key.
  if (provisioningNeeded) await markProvisioned();

  return storage;
}
