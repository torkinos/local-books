# S1 — Spike: public-RPC backfill + rate limits

**Date:** 2026-08-23 · **Verdict: GO**, with a mandated endpoint order (see below).
> **2026-09-16:** the endpoint order below is superseded — publicnode was found
> serving only ~2 days of history (DECISIONS.md D9 amendment); mainnet-beta is now
> the sole public endpoint. The throughput numbers stand as measured.
**Harness:** `spikes/01-rpc-backfill/` — runs the *real* `packages/core` backfill driver
(compiled, unmodified) against live endpoints through a fetch-based `RpcPort` adapter,
the same shape T9 will ship. Raw metrics in `spikes/01-rpc-backfill/raw/` (gitignored).

Reproduce:

```sh
npx tsc -p packages/core --outDir spikes/01-rpc-backfill/.build --noEmit false --declaration false --sourceMap false
node spikes/01-rpc-backfill/harness.mjs --url https://solana-rpc.publicnode.com \
  --label publicnode --address <ADDR> --max-pages 25 --state-dir /tmp/s1 --tag run1 --fresh
```

## Finding 0 — the "public endpoint pool" is two endpoints, not many

Probed six candidates. Only two serve unauthenticated Solana mainnet today:

| Endpoint | Status |
|---|---|
| `api.mainnet-beta.solana.com` | works |
| `solana-rpc.publicnode.com` | works |
| dRPC (`solana.drpc.org`) | "chain not available on free plan" |
| Ankr (`rpc.ankr.com/solana`) | 403, API key required |
| OnFinality public | rate-limited immediately, key required |
| Omniatech public | dead (521) |

PROJECT.md line 72's "rotation/failover across public endpoints" is really rotation
across **two**. That makes the user-supplied endpoint (already permitted, line 72) more
than a power-user perk — it is the documented escape hatch, and the settings screen
should say so.

## Finding 1 — signature paging is cheap everywhere

Stress address: `5Q544…e4j1` (Raydium authority — far busier than any real user).
25 pages × 1000 signatures per run:

| Run | Wall clock | 429s |
|---|---|---|
| mainnet-beta, 250 ms pace | 31.9 s | 2 (each with `Retry-After: 10s`) |
| mainnet-beta, 0 ms pace | 26.5 s | 2 |
| publicnode, 250 ms pace | 14.6 s | 0 |
| publicnode, 0 ms pace | 14.3 s | 0 |

A freelancer-scale address (≤ 2,000 txs) is **1–2 pages** — signature paging is never
the bottleneck. The driver's backoff honored mainnet-beta's server-advised 10 s waits
and recovered both times; `failover-needed` never triggered at production pacing.

## Finding 2 — `getTransaction` is the real cost, and the endpoints are night and day

Sequential `getTransaction` (jsonParsed), 40 txs at 100 ms pacing:

| Endpoint | Effective rate | 429s | JSON-RPC batch |
|---|---|---|---|
| publicnode | **5.1 tx/s** | 0 | rejected (HTTP 400, any size) |
| mainnet-beta | **0.6 tx/s** | 5 in 40 calls (429 after every ~10) | 10 OK; 50 rate-limited |

Backfill cost is `N × getTransaction`, not signature pages. For a 2,000-tx address:
**~7 min on publicnode** (one-time, resumable, with progress UI) vs **~55 min on
mainnet-beta** — tolerable vs not. Batching cannot rescue mainnet-beta because
publicnode rejects batches entirely and mainnet-beta caps them small; the T9 adapter
should fetch sequentially and let the driver pace, exactly as designed (D8).

## Finding 3 — kill −9 mid-sync, resume is exactly-once (page granularity)

Killed the harness with `SIGKILL` mid-backoff after 10 pages. The checkpoint file held
the page-10 cursor. The resumed run:

- **0 duplicate signatures** across the two runs (10,000 + 1,000 sigs);
- its first page **exactly matched** a fresh fetch `before=<run 1's last sig>` — no gap
  (`verify-resume.mjs`, exit 0).

An unplanned second kill (SIGPIPE via a closed pipe) also resumed cleanly — two crash
shapes survived, not one.

## Go/no-go

**GO.** No architecture change. Conditions, which become T9 requirements:

1. **Default endpoint order: publicnode primary, mainnet-beta failover.** Not
   round-robin — the endpoints are not peers (Finding 2).
2. **Sequential `getTransaction`, no JSON-RPC batching** (Finding 2). Pace via the
   driver's `pauseMs`, per D8.
3. **Settings exposes a user RPC URL** (e.g. a free Helius key) as the first remedy in
   rate-limit error copy (Finding 0).
4. No capped-history fallback needed at freelancer scale on publicnode; revisit only if
   the on-device re-run contradicts these numbers.

## Caveats / remaining on-device work

- Measured from a datacenter IP; public endpoints often throttle datacenters *harder*
  than residential/mobile IPs, so these are plausibly worst-case — but re-run the
  harness from a phone-tethered connection during W2 device testing (~15 min).
- Airplane-mode-mid-page on a physical device still untested; the kill tests cover the
  same code path (checkpoint durability + resume), so the risk is a hung fetch, which
  is the adapter's timeout concern (T9), not the driver's.
