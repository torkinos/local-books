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
 * **The key-loss rule.** SecureStore can legitimately return null on a device that
 * HAS books: Android Auto Backup restores app data but never Keystore keys; a
 * lock-screen change can invalidate the Keystore; prefs and keystore can desync. If
 * "no key" were treated as "first launch", a fresh key would overwrite the entry and
 * the books would become undecryptable with no error -- the worst failure this app
 * can have. So provisioning is recorded OUT-OF-BAND in a tiny plain (unencrypted)
 * meta database holding no secrets, just the fact that a key exists and a
 * fingerprint of it. No key + provisioning marker => KeyLostError, surfaced to the
 * user; never a silent re-mint.
 *
 * This file is the only place the native module is touched; everything SQL lives in
 * sqliteStorage.ts where the test suite runs it against real SQLite in Node.
 */
import { isSQLCipher, open } from '@op-engineering/op-sqlite';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomValues } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { StoragePort } from '@local-books/core';
import { createSqliteStorage, type SqlExecutor } from './sqliteStorage.js';

const KEY_STORE_ENTRY = 'local-books.sqlcipher-key';
const DB_NAME = 'local-books.db';
const META_DB_NAME = 'local-books-meta.db';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The books exist but their key is gone. Recovery is a user decision, never ours. */
export class KeyLostError extends Error {
  constructor(reason: 'missing' | 'mismatch') {
    super(
      reason === 'missing'
        ? 'The database key is missing from the device keystore (commonly: the app was ' +
          'restored from a backup, which never includes keystore entries). The local ' +
          'books cannot be decrypted. Starting fresh requires explicitly deleting the ' +
          'old database -- the app will not do that on its own.'
        : 'The device keystore returned a key that does not match the one this database ' +
          'was encrypted with. Refusing to touch the database.',
    );
    this.name = 'KeyLostError';
  }
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Non-reversible fingerprint stored in the plain meta DB; identifies, never reveals. */
const fingerprint = (key: string): string => toHex(sha256(new TextEncoder().encode(key))).slice(0, 16);

function wrapExecutor(db: ReturnType<typeof open>): SqlExecutor {
  return {
    async execute(sql, params) {
      const result = await db.execute(sql, params ? [...params] : []);
      return { rows: (result.rows ?? []) as readonly Record<string, unknown>[] };
    },
  };
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
  await meta.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const provisioned = (
    await meta.execute("SELECT value FROM meta WHERE key = 'key-fingerprint'")
  ).rows[0]?.['value'] as string | undefined;

  let key = await SecureStore.getItemAsync(KEY_STORE_ENTRY, SECURE_STORE_OPTIONS);
  if (!key) {
    if (provisioned !== undefined) throw new KeyLostError('missing');
    key = toHex(getRandomValues(new Uint8Array(32)));
    await SecureStore.setItemAsync(KEY_STORE_ENTRY, key, SECURE_STORE_OPTIONS);
  } else if (provisioned !== undefined && provisioned !== fingerprint(key)) {
    throw new KeyLostError('mismatch');
  }

  const db = open({ name: DB_NAME, encryptionKey: key });
  const storage = await createSqliteStorage(wrapExecutor(db));

  if (provisioned === undefined) {
    // Recorded only after the encrypted DB opened successfully with this key.
    await meta.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('key-fingerprint', ?)", [
      fingerprint(key),
    ]);
  }

  return storage;
}
