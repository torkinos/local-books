/**
 * S2: fetch one transaction (jsonParsed) and save it as a fixture.
 *
 * Usage:
 *   node spikes/02-reference-detection/dump-fixture.mjs \
 *     --sig <SIGNATURE> --out packages/core/test/fixtures/s2/exact-payment.json \
 *     [--url https://api.devnet.solana.com]
 *
 * The output is exactly the RawTransaction shape core's RpcPort hands to the
 * normalizer: { signature, slot, blockTime, raw }, where `raw` is the RPC result
 * verbatim. Public chain data; safe to commit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args[a.slice(2)] = next;
    i += 1;
  } else {
    args[a.slice(2)] = true;
  }
}

const url = args.url ?? 'https://api.devnet.solana.com';
const signature = args.sig;
const out = args.out;
if (!signature || !out) {
  console.error('required: --sig <signature> --out <file.json> [--url <rpc url>]');
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ],
  }),
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const json = await res.json();
if (json.error) {
  console.error(`RPC ${json.error.code}: ${json.error.message}`);
  process.exit(1);
}
if (json.result === null) {
  console.error('null result: the endpoint does not know this signature (wrong network, or not yet confirmed)');
  process.exit(1);
}

const fixture = {
  signature,
  slot: json.result.slot,
  blockTime: json.result.blockTime ?? null,
  raw: json.result,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${out} (slot ${fixture.slot}, blockTime ${fixture.blockTime})`);
