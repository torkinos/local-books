/**
 * S1 spike harness: run the real core backfill driver against a live public endpoint.
 *
 * Usage:
 *   node spikes/01-rpc-backfill/harness.mjs \
 *     --url https://api.mainnet-beta.solana.com --label mainnet-beta \
 *     --address <ADDR> --max-pages 25 [--page-size 1000] [--pace 250] \
 *     --state-dir /tmp/s1 --tag run1 [--fresh]
 *
 * Writes, under --state-dir:
 *   checkpoint-<label>.json   durable checkpoint (what StoragePort will hold on device)
 *   sigs-<tag>.jsonl          every signature seen, one per line, with page + run tags
 *   metrics-<tag>.json        counters + wall clock, rewritten after every page so a
 *                             kill -9 still leaves an accurate record
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { backfillAddress } from './core-dist.mjs';
import { makeRpc, freshMetrics } from './rpc-adapter.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args[key] = next;
    i += 1;
  } else {
    args[key] = true;
  }
}

const url = args.url;
const label = args.label;
const address = args.address;
const tag = args.tag ?? 'run';
const stateDir = args['state-dir'];
if (!url || !label || !address || !stateDir) {
  console.error('required: --url --label --address --state-dir');
  process.exit(1);
}
mkdirSync(stateDir, { recursive: true });

const checkpointFile = join(stateDir, `checkpoint-${label}.json`);
const sigsFile = join(stateDir, `sigs-${tag}.jsonl`);
const metricsFile = join(stateDir, `metrics-${tag}.json`);
if (args.fresh) {
  for (const f of [checkpointFile, sigsFile, metricsFile]) if (existsSync(f)) rmSync(f);
}

const metrics = freshMetrics();
const rpc = makeRpc({ url, label, metrics });

const storage = {
  async getCheckpoint() {
    if (!existsSync(checkpointFile)) return null;
    return JSON.parse(readFileSync(checkpointFile, 'utf8'));
  },
  async putCheckpoint(checkpoint) {
    // Atomic write: the on-device StoragePort gets this from SQLite transactions.
    const tmp = `${checkpointFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
    renameSync(tmp, checkpointFile);
  },
};
const clock = { now: () => Math.floor(Date.now() / 1000) };

const options = {
  pageSize: Number(args['page-size'] ?? 1000),
  maxPagesPerRun: Number(args['max-pages'] ?? 25),
  basePaceMs: Number(args.pace ?? 250),
  maxBackoffMs: 30_000,
  maxConsecutiveRateLimits: 5,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const record = { label, url, address, tag, options, pages: 0, sigs: 0, events: [] };

function flushMetrics(extra = {}) {
  writeFileSync(
    metricsFile,
    JSON.stringify(
      {
        ...record,
        ...metrics,
        wallClockMs: Math.round(performance.now() - t0),
        avgHttpMs: metrics.calls ? Math.round(metrics.httpMsTotal / metrics.calls) : 0,
        ...extra,
      },
      null,
      2,
    ),
  );
}

let outcome = 'unknown';
for await (const p of backfillAddress(address, { rpc, storage, clock }, options)) {
  if (p.kind === 'page') {
    record.pages += 1;
    record.sigs += p.signatures.length;
    const lines = p.signatures
      .map((s) => JSON.stringify({ tag, page: record.pages, sig: s.signature, slot: s.slot, blockTime: s.blockTime }))
      .join('\n');
    appendFileSync(sigsFile, `${lines}\n`);
    console.log(
      `[${label}] page ${record.pages}: ${p.signatures.length} sigs, cursor ${p.checkpoint.oldestSeen?.slice(0, 8)}…, pause ${p.pauseMs}ms`,
    );
    flushMetrics();
    if (p.pauseMs > 0) await sleep(p.pauseMs);
  } else if (p.kind === 'rate-limited') {
    record.events.push({ kind: '429', consecutiveHits: p.consecutiveHits, backoffMs: p.pauseMs });
    console.log(`[${label}] 429 #${p.consecutiveHits}, backing off ${p.pauseMs}ms`);
    flushMetrics();
    await sleep(p.pauseMs);
  } else if (p.kind === 'failover-needed') {
    outcome = 'failover-needed';
    console.log(`[${label}] FAILOVER after ${options.maxConsecutiveRateLimits} consecutive 429s`);
    process.exitCode = 2;
  } else if (p.kind === 'done') {
    outcome = `done:${p.reason}`;
    console.log(`[${label}] done: ${p.reason} (${record.pages} pages, ${record.sigs} sigs)`);
  }
}
flushMetrics({ outcome });
console.log(`[${label}] wall clock ${(Math.round(performance.now() - t0) / 1000).toFixed(1)}s, calls ${metrics.calls}, 429s ${metrics.rateLimited}`);
