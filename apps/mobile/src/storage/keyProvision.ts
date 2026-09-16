/**
 * The D12 key-loss rule as a decision table, split from the native binding so it
 * runs -- and is tested -- in plain Node (opsqlite.ts keeps the Expo/op-sqlite
 * wiring and injects the real keystore and CSPRNG here).
 *
 * SecureStore can legitimately return null on a device that HAS books: Android Auto
 * Backup restores app data but never Keystore keys; a lock-screen change can
 * invalidate the Keystore; prefs and keystore can desync. If "no key" were treated
 * as "first launch", a fresh key would overwrite the entry and the books would
 * become undecryptable with no error -- the worst failure this app can have. So
 * provisioning is recorded OUT-OF-BAND in a tiny plain (unencrypted) meta database
 * holding no secrets, just the fact that a key exists and a fingerprint of it.
 *
 * The table (DECISIONS.md D12), given the stored key and the fingerprint marker:
 *   - no key + no marker  -> genuine first run: mint, store;
 *   - no key + marker     -> KeyLostError('missing'), surfaced to the user;
 *   - key + matching      -> proceed;
 *   - key + mismatch      -> KeyLostError('mismatch');
 *   - key + NO marker     -> proceed with the EXISTING key: the process died between
 *     storeKey and the marker write once; minting over that key would lose books.
 *
 * The marker is written by `markProvisioned`, which the CALLER invokes only after
 * the encrypted DB opened successfully with this key -- resolveDbKey itself never
 * writes it, so a crash before first open still reads as "first run" next launch.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { SqlExecutor } from './sqliteStorage.js';

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

export const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Non-reversible fingerprint stored in the plain meta DB; identifies, never reveals. */
const fingerprint = (key: string): string =>
  toHex(sha256(new TextEncoder().encode(key))).slice(0, 16);

export interface KeyProvisionDeps {
  /** The plain, secret-free meta database (NOT the encrypted books). */
  readonly meta: SqlExecutor;
  getStoredKey(): Promise<string | null>;
  storeKey(key: string): Promise<void>;
  mintKeyHex(): string;
}

export interface ResolvedDbKey {
  readonly key: string;
  /**
   * True when the fingerprint marker was absent at resolve time -- the caller must
   * invoke markProvisioned after the encrypted DB opens, and only then (mirrors the
   * `provisioned === undefined` condition the flow has always had).
   */
  readonly provisioningNeeded: boolean;
  /** INSERT OR REPLACE: calling it when the row already matches changes nothing. */
  markProvisioned(): Promise<void>;
}

export async function resolveDbKey(deps: KeyProvisionDeps): Promise<ResolvedDbKey> {
  await deps.meta.execute(
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  const provisioned = (
    await deps.meta.execute("SELECT value FROM meta WHERE key = 'key-fingerprint'")
  ).rows[0]?.['value'] as string | undefined;

  let key = await deps.getStoredKey();
  if (!key) {
    if (provisioned !== undefined) throw new KeyLostError('missing');
    key = deps.mintKeyHex();
    await deps.storeKey(key);
  } else if (provisioned !== undefined && provisioned !== fingerprint(key)) {
    throw new KeyLostError('mismatch');
  }

  const resolved = key;
  return {
    key: resolved,
    provisioningNeeded: provisioned === undefined,
    async markProvisioned() {
      await deps.meta.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('key-fingerprint', ?)",
        [fingerprint(resolved)],
      );
    },
  };
}
