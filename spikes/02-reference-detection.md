# S2 — Spike: reference-key detection (runbook)

**Status:** RUN 2026-09-15 · **Verdict: GO.** See "Result" below; the four
transactions are pinned in `packages/core/test/s2-devnet.test.ts`.

**Question:** does a Solana Pay QR payment get detected and matched end to end, does
the **second** USDC payment still get detected (the token-account fix, D19), and
does a plain transfer without the QR stay unmatched (the tier-b gap we only size,
never build)? Three payments answer it. Everything else (wrong amounts, duplicates,
late arrivals) is pinned by unit tests already and is optional here.

## Setup (once)

Two Solflare accounts on **Devnet** (Settings › General › Network › Devnet):
**PAYER** with devnet SOL and USDC, **WATCHED** with nothing.

- SOL for PAYER: <https://faucet.solana.com> (GitHub sign-in, 0.5 SOL is plenty), or
  `solana airdrop 0.5 <PAYER> -u devnet`. Ground truth is the explorer
  (`explorer.solana.com/address/<PAYER>?cluster=devnet`), not the wallet's balance
  screen. Phantom's Testnet Mode is known to spin forever on devnet; use Solflare.
- USDC for PAYER: <https://faucet.circle.com> › Solana Devnet › paste PAYER. Mint must
  be `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- App: `apps/mobile/.env.development` with `EXPO_PUBLIC_NETWORK=devnet`, then
  `npm run android` from `apps/mobile`. The ledger shows a DEVNET strip under the
  header; no strip means Metro started before the env file existed.
- Start the phone's screen recorder before the first tap. This footage is T16.

## The run (~20 min)

Scan QR codes with the scanner on Solflare's **main screen**, not the one inside
Send — the Send scanner only accepts bare addresses and calls a pay link "invalid".

**A — QR payment.** App: **+ Watch** › WATCHED. **Invoices › + New** › client
"Acme", one line `1 × 1.5`, token USDC (devnet), **+7d**, pay-to WATCHED, **Create
invoice**. **Share PDF**, scan it from PAYER, send. Pull to refresh in the app.

Expect: a `+1.5 USDC` ledger row and the invoice **paid · matched by reference**.

**B — second QR payment.** New invoice for `2 USDC`, same steps. WATCHED's USDC
account now exists, so this transaction never names WATCHED itself; owner-only
paging would have missed it.

Expect: same as A. If it does not appear, that is the D19 code path failing.

**C — direct transfer, no QR.** New invoice for `3 USDC`, but do NOT scan. In
Solflare: Send › 3 USDC › WATCHED.

Expect: a `+3 USDC` ledger row, the invoice stays **open**, and nothing under
"Needs your decision". That is the tier-b gap, sized: 1 of 3 payments in this run.

## Result

| case | matched? | signature (devnet) | notes |
|---|---|---|---|
| A (1 USDC, first payment) | yes, by reference | `2hxU3WUd…S4kaP` (10:50 UTC) | ATA-create + transfer; the only tx that names WATCHED |
| A again (1 USDC) | yes, by reference | `2VhXYszg…aipx4` (12:55 UTC) | names only the token account |
| B (2 USDC) | yes, by reference | `N3VcTqQa…JRWZ` (12:57 UTC) | names only the token account — the D19 case |
| C (3 USDC, direct) | stayed open | `mXKWyLB8…mjin` (12:59 UTC) | no reference; deposit shown, nothing to decide |

WATCHED `EFhBHyks…MRjEy`, PAYER `CuxRzb13…dkmY`, Solflare on Devnet, Circle devnet
USDC. Solflare paid into the associated token account every time (derivation, not
enumeration, was the right D19 call), and 3 of the 4 payments were invisible to
owner-only paging — the pre-D19 app would have shown one payment and missed the
rest. Income screen and CSV export exercised in the same session; app killed and
reopened with the rows intact (T6/T15 device halves).

**GO** = A and B matched without a manual step and C stayed open.
**NO-GO** = B not detected → note whether Solflare paid into a non-associated
token account (explorer › the transaction › token balances); that decides whether
D19 needs `getTokenAccountsByOwner` on a user RPC URL instead of derivation.

Verdict: **GO** · Date: 2026-09-15 · Device: Android (user's phone) · Wallet: Solflare (Devnet)

## Optional, if you have time

- Wrong amount via QR (edit the amount in Solflare before sending, if it lets you):
  expect the invoice to appear under **Needs your decision** with the shortfall
  named; **Mark paid** flips it to paid · matched by you.
- Fixtures for core's tests: copy each signature from the explorer, then
  `node spikes/02-reference-detection/dump-fixture.mjs --sig <SIG> --out packages/core/test/fixtures/s2/<case>.json`
  and `node spikes/02-reference-detection/check-fixture.mjs <file> --owner <WATCHED> --reference <ref>`
  (the reference is printed on the PDF under the QR). `check-fixture` needs core
  compiled once:
  `npx tsc -p packages/core --outDir spikes/02-reference-detection/.build --noEmit false --declaration false --sourceMap false && echo '{"type":"module"}' > spikes/02-reference-detection/.build/package.json`
