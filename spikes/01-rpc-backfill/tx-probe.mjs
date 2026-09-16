/**
 * S1: measure the cost that actually dominates backfill — getTransaction (jsonParsed).
 *
 * A freelancer's address with N transactions needs ceil(N/1000) getSignaturesForAddress
 * calls but N getTransaction calls, so tx fetch rate decides whether initial backfill
 * completes in a tolerable window. Measures sequential throughput and whether the
 * endpoint accepts JSON-RPC batch arrays (and up to what size).
 *
 * Usage: node tx-probe.mjs <url> <label> <sigsJsonl> [count]
 */
import { readFileSync } from 'node:fs';
import { makeRpc, freshMetrics } from './rpc-adapter.mjs';
import { RateLimitedError } from './core-dist.mjs';

const [url, label, sigsFile, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 40);
const sigs = readFileSync(sigsFile, 'utf8')
  .trim()
  .split('\n')
  .slice(0, Math.max(count, 60))
  .map((l) => JSON.parse(l).sig);

const metrics = freshMetrics();
const rpc = makeRpc({ url, label, metrics });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sequential fetches at a modest 100ms pace -- roughly what a phone would do.
let fetched = 0;
let notFound = 0;
const t0 = performance.now();
for (const sig of sigs.slice(0, count)) {
  try {
    const [tx] = await rpc.getTransactions([sig]);
    if (tx.raw === null) notFound += 1;
    fetched += 1;
  } catch (err) {
    if (err instanceof RateLimitedError) {
      console.log(`  429 after ${fetched} fetches; backing off 10s`);
      await sleep(10_000);
    } else throw err;
  }
  await sleep(100);
}
const seqMs = performance.now() - t0;
const effRate = (fetched / (seqMs / 1000)).toFixed(1);
console.log(
  `[${label}] sequential: ${fetched}/${count} txs in ${(seqMs / 1000).toFixed(1)}s (${effRate} tx/s incl. pacing), 429s: ${metrics.rateLimited}, null results: ${notFound}`,
);

for (const size of [10, 50]) {
  await sleep(1000);
  try {
    const probe = await rpc.batchGetTransactions(sigs.slice(0, size));
    console.log(
      `[${label}] batch of ${size}: HTTP ${probe.httpStatus}, ${probe.ok ? `accepted, ${probe.size} results` : 'REJECTED (non-array response)'}`,
    );
  } catch (err) {
    console.log(`[${label}] batch of ${size}: ${err.name}: ${err.message.slice(0, 120)}`);
  }
}
