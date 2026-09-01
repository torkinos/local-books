/**
 * D12 decision table, every row, against a REAL meta database (node:sqlite executes
 * the exact CREATE/SELECT/INSERT OR REPLACE statements the device runs). The stakes:
 * treating "no key" as "first launch" on a restored device would re-mint over the
 * key and make the books permanently undecryptable, silently. What stays a device
 * check is only the keystore itself and SQLCipher accepting the key.
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { sha256 } from '@noble/hashes/sha2.js';
import { KeyLostError, resolveDbKey } from '../src/storage/keyProvision.js';
import type { SqlExecutor } from '../src/storage/sqliteStorage.js';

// Vite strips the node: prefix and then cannot resolve `sqlite` (a node:-only
// builtin), so the module is loaded through the runtime instead of the bundler.
const { DatabaseSync: OpenDatabase } = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(name: 'node:sqlite'): { DatabaseSync: new (path: string) => DatabaseSync };
    };
  }
).process.getBuiltinModule('node:sqlite');

function makeExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql, params = []) {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: db.prepare(sql).all(...params) };
      }
      if (params.length === 0) {
        db.exec(sql);
        return { rows: [] };
      }
      db.prepare(sql).run(...params);
      return { rows: [] };
    },
  };
}

const KEY = 'a'.repeat(64); // a plausible 32-byte hex key; the resolver never parses it

// The fingerprint scheme, recomputed independently of the implementation: sha256 of
// the UTF-8 key, hex, first 16 chars. If keyProvision ever drifts from this, every
// existing device would greet its owner with a spurious KeyLostError('mismatch').
const expectedFingerprint = (key: string): string =>
  [...sha256(new TextEncoder().encode(key))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);

interface Fixture {
  readonly db: DatabaseSync;
  readonly minted: string[];
  readonly stored: string[];
  markerRow(): string | undefined;
  resolve(): ReturnType<typeof resolveDbKey>;
}

function fixture(opts: { storedKey?: string | null; marker?: string } = {}): Fixture {
  const db = new OpenDatabase(':memory:');
  if (opts.marker !== undefined) {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare("INSERT INTO meta (key, value) VALUES ('key-fingerprint', ?)").run(opts.marker);
  }
  const minted: string[] = [];
  const stored: string[] = [];
  let keystore = opts.storedKey ?? null;
  return {
    db,
    minted,
    stored,
    markerRow: () =>
      db.prepare("SELECT value FROM meta WHERE key = 'key-fingerprint'").all()[0]?.['value'] as
        | string
        | undefined,
    resolve: () =>
      resolveDbKey({
        meta: makeExecutor(db),
        getStoredKey: async () => keystore,
        storeKey: async (key) => {
          stored.push(key);
          keystore = key;
        },
        mintKeyHex: () => {
          const key = `minted-${minted.length}-${'b'.repeat(50)}`;
          minted.push(key);
          return key;
        },
      }),
  };
}

describe('resolveDbKey (D12 decision table)', () => {
  it('first run (no key, no marker): mints, stores -- and does NOT write the marker', async () => {
    const f = fixture();
    const resolved = await f.resolve();

    expect(f.minted).toHaveLength(1);
    expect(f.stored).toEqual([f.minted[0]]);
    expect(resolved.key).toBe(f.minted[0]);
    expect(resolved.provisioningNeeded).toBe(true);
    // The marker is the CALLER's move, made only after the encrypted DB actually
    // opened with this key. A resolver that writes it early would turn a crash
    // before first open into KeyLostError('missing') on the next launch.
    expect(f.markerRow()).toBeUndefined();

    await resolved.markProvisioned();
    expect(f.markerRow()).toBe(expectedFingerprint(resolved.key));
  });

  it('restored backup (no key, marker present): KeyLostError, and nothing minted or stored', async () => {
    const f = fixture({ marker: expectedFingerprint(KEY) });
    const error = await f.resolve().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KeyLostError);
    expect((error as KeyLostError).name).toBe('KeyLostError');
    // The 'missing' message, not the 'mismatch' one.
    expect((error as KeyLostError).message).toMatch(/missing from the device keystore/);
    expect((error as KeyLostError).message).toMatch(/restored from a backup/);
    expect(f.minted).toHaveLength(0); // never a silent re-mint
    expect(f.stored).toHaveLength(0);
    expect(f.markerRow()).toBe(expectedFingerprint(KEY)); // the evidence stays intact
  });

  it('keystore desync (key present, marker disagrees): KeyLostError with the mismatch message', async () => {
    const f = fixture({ storedKey: KEY, marker: 'not-the-fingerprint' });
    const error = await f.resolve().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KeyLostError);
    expect((error as KeyLostError).message).toMatch(/does not match/);
    expect((error as KeyLostError).message).not.toMatch(/missing from the device keystore/);
    expect(f.minted).toHaveLength(0);
    expect(f.stored).toHaveLength(0);
  });

  it('steady state (key + matching marker): proceeds untouched, marker rewrite is a no-op', async () => {
    const f = fixture({ storedKey: KEY, marker: expectedFingerprint(KEY) });
    const resolved = await f.resolve();

    expect(resolved.key).toBe(KEY);
    expect(resolved.provisioningNeeded).toBe(false);
    expect(f.minted).toHaveLength(0);
    expect(f.stored).toHaveLength(0);
    // Idempotent by INSERT OR REPLACE: even a redundant call changes nothing.
    await resolved.markProvisioned();
    await resolved.markProvisioned();
    expect(f.markerRow()).toBe(expectedFingerprint(KEY));
  });

  it('died between storeKey and marker write (key, NO marker): proceeds with the EXISTING key', async () => {
    const f = fixture({ storedKey: KEY });
    const resolved = await f.resolve();

    expect(resolved.key).toBe(KEY); // never re-minted over a live key
    expect(f.minted).toHaveLength(0);
    expect(f.stored).toHaveLength(0);
    expect(resolved.provisioningNeeded).toBe(true); // the marker still needs healing
    await resolved.markProvisioned();
    expect(f.markerRow()).toBe(expectedFingerprint(KEY));
  });

  it('fingerprint is deterministic across launches -- same key, same marker, no false mismatch', async () => {
    const first = fixture({ storedKey: KEY });
    await (await first.resolve()).markProvisioned();

    // A fresh "launch" against an independent meta DB derives the identical row...
    const second = fixture({ storedKey: KEY });
    await (await second.resolve()).markProvisioned();
    expect(second.markerRow()).toBe(first.markerRow());
    expect(second.markerRow()).toMatch(/^[0-9a-f]{16}$/); // sha256 hex, sliced to 16

    // ...and resolving with the marker the previous launch wrote must succeed.
    const third = fixture({ storedKey: KEY, marker: first.markerRow()! });
    await expect(third.resolve()).resolves.toMatchObject({ key: KEY, provisioningNeeded: false });
  });
});
