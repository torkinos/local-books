/**
 * S1: verify kill/resume was exactly-once at page granularity.
 *
 * Checks, given two sig collections (run 1 killed mid-sync, run 2 resumed):
 *   1. No signature appears in both runs (no page replayed, nothing double-ingested).
 *   2. Run 2's first page equals a fresh fetch with before=<run 1's last sig> — the
 *      resume continued from exactly the checkpointed cursor, no gap. (Paging via
 *      `before` is a stable view of history, so this is ground truth.)
 *
 * Usage: node verify-resume.mjs <stateDir> <url>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [stateDir, url] = process.argv.slice(2);
const load = (tag) =>
  readFileSync(join(stateDir, `sigs-${tag}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

const run1 = load('kill1');
const run2 = load('kill2');
const set1 = new Set(run1.map((r) => r.sig));
const dupes = run2.filter((r) => set1.has(r.sig));
console.log(`run1: ${run1.length} sigs, run2: ${run2.length} sigs, duplicates across runs: ${dupes.length}`);

const lastOfRun1 = run1[run1.length - 1].sig;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: ['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', { before: lastOfRun1, limit: 50, commitment: 'confirmed' }],
  }),
});
const json = await res.json();
const reference = json.result.map((s) => s.signature);
const firstOfRun2 = run2.slice(0, 50).map((r) => r.sig);
const match = reference.every((sig, i) => sig === firstOfRun2[i]);
console.log(`gap check: run2's first 50 sigs ${match ? 'EXACTLY match' : 'DIVERGE from'} a fresh fetch from run1's checkpoint cursor`);
process.exit(dupes.length === 0 && match ? 0 : 1);
