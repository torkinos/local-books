# S2 — Spike: reference-key detection (runbook)

**Status:** NOT RUN — needs the phone and a devnet wallet. Fill in the tables below
as you go; the go/no-go at the bottom is the deliverable.

**Question:** does tier-a matching (Solana Pay reference on the transfer) detect
payments reliably end to end, and how big is the gap it structurally cannot see (a
direct transfer that ignores the QR)? Since 2026-09-14 there is a second question:
does the token-account paging fix (D19) actually catch the **second** USDC payment,
which owner-only paging never could.

Tier b is **not** built here (PROJECT.md line 123). This spike only sizes the gap
and produces fixtures.

---

## 0. Before you start (~20 min, once)

You need two wallets on **devnet**, both in Phantom is fine (two accounts):

- **WATCHED** — the freelancer. The app watches this address. Needs nothing in it.
- **PAYER** — the client. Needs devnet SOL (fees) and devnet USDC.

1. Phantom → Settings → Developer Settings → **Testnet Mode ON**, then check the
   Solana network picker under it reads **Devnet** (not Testnet — a wallet on
   Testnet never sees the faucet USDC below, and its sends land where the devnet
   build never looks).
2. Devnet SOL for PAYER: <https://faucet.solana.com> (or `solana airdrop 1 <PAYER> -u devnet`).
3. Devnet USDC for PAYER: <https://faucet.circle.com> → Solana Devnet → paste PAYER.
   The mint must be `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle's devnet
   USDC — the one `tokens.ts` and `STABLE_MINTS` know). Phantom labels it USDC.
4. Build the app for devnet: create `apps/mobile/.env.development` containing the
   single line `EXPO_PUBLIC_NETWORK=devnet` (see `.env.example` for why that file
   and not `.env`), then from `apps/mobile` run `npm run prebuild` (native deps
   changed on 09-01) and `npm run android`. The ledger header must show a
   **DEVNET** tag — if it does not, the env did not reach the bundle.
5. Compile core for the check script (once, from repo root):
   ```sh
   npx tsc -p packages/core --outDir spikes/02-reference-detection/.build --noEmit false --declaration false --sourceMap false
   echo '{"type":"module"}' > spikes/02-reference-detection/.build/package.json   # silences Node's module-type warning
   ```
6. Start the phone's screen recorder before step 1 of the run — this footage IS
   T16's deliverable. Don't re-shoot later.

## 1. The run (~60–90 min)

Every case: note the **signature** (Phantom → activity → View on explorer, or copy
from the app's ledger row later). After the run, dump each one:

```sh
node spikes/02-reference-detection/dump-fixture.mjs --sig <SIG> \
  --out packages/core/test/fixtures/s2/<case>.json
node spikes/02-reference-detection/check-fixture.mjs packages/core/test/fixtures/s2/<case>.json \
  --owner <WATCHED> --reference <INVOICE_REFERENCE> [--expect-amount <raw units>]
```

The invoice reference is printed on the shared PDF: the `Payment reference:` line
(also the `reference=` parameter of the printed pay URL and the `Invoice …` header).
The app itself does not display it. `--expect-amount` is the invoice total in raw
units (1.5 USDC = `1500000`).

### Case A — exact payment via QR (the happy path; also T16)

1. App: **+ Watch** → paste WATCHED, label it. Wait for "No transactions found yet".
2. App: **Invoices → + New** → client "Acme", one line `1 × 1.5` USDC, pay-to WATCHED.
3. **Share PDF** → send it anywhere you can open it on the PAYER phone/screen (or
   just show the PDF on this phone and scan it with Phantom's scanner on the other).
4. Phantom (PAYER): scan → it should prefill **1.5 USDC to WATCHED**. Send.
5. App: pull to refresh. Expect within one refresh: a `+1.5 USDC` ledger row, and
   the invoice **paid · matched by reference**.

| | expected | got |
|---|---|---|
| Phantom parsed the QR (mint, amount, recipient) | yes | |
| Ledger row appears after refresh | yes | |
| Invoice status | paid · by reference | |
| `check-fixture`: visible via owner paging | yes (first payment creates the ATA) | |
| `check-fixture`: tier a | DETECTED, auto-match | |
| signature | | |

### Case B — second payment via QR (**the D19 check**)

Same as A with a new invoice (say `2 USDC`). Now the ATA exists, so the transaction
will NOT name WATCHED.

| | expected | got |
|---|---|---|
| Ledger row + invoice paid after refresh | yes | |
| `check-fixture`: visible via owner paging | **NO** | |
| `check-fixture`: visible via token-account paging | yes (`<- the D19 case`) | |
| `check-fixture`: tier a | DETECTED, auto-match | |
| signature | | |

If this case fails in the app but `check-fixture` says "visible via token-account
paging: yes", the bug is in the sync engine, not the derivation. If it says "NO"
for both, Phantom paid into a non-associated token account — record it; that
would mean D19's derivation approach needs enumeration after all.

### Case C — direct transfer, no QR (the tier-b gap, PROJECT.md line 81)

Create an invoice (`3 USDC`). Do NOT scan. In Phantom: Send → 3 USDC → WATCHED.

| | expected | got |
|---|---|---|
| Ledger row appears | yes (`+3 USDC`) | |
| Invoice status | **open** — structurally invisible to tier a | |
| "Needs your decision" list | empty (no reference to hang a decision on) | |
| `check-fixture`: tier a | NOT DETECTED | |
| signature | | |

This is the case tier b would have to handle. Do not build it. Just record it.

### Case D — wrong amount via QR

Create an invoice (`4 USDC`). Scan with Phantom; before sending, try to **edit the
amount** to 3.5. If Phantom lets you: send.

| | expected | got |
|---|---|---|
| Phantom lets the amount be edited | (record either way) | |
| Ledger row | `+3.5 USDC` | |
| Invoice status | **open** | |
| "Needs your decision" | one row: "Paid 3.5 USDC of 4 USDC — short by 0.5 USDC." | |
| Tap **Mark paid** → invoice | paid · **matched by you** | |
| `check-fixture --expect-amount 4000000` | DETECTED, amount=under → needs your decision | |
| signature | | |

If Phantom does not let you edit a fixed-amount request, that is a finding in
itself (record it) and this case cannot be produced from Phantom; skip it.

### Case E — duplicate amounts in one window

Create two invoices of `1 USDC` each (X and Y). Pay **X via its QR**. Pay **Y by
direct transfer** (no QR), same amount, minutes apart.

| | expected | got |
|---|---|---|
| X | paid · by reference | |
| Y | open; its 1 USDC shows as an unexplained ledger row | |
| "Needs your decision" | empty | |

Then pay **X's QR a second time** (Phantom will happily re-scan the same PDF):

| | expected | got |
|---|---|---|
| X stays paid; the second payment is a plain ledger row | yes | |
| (variant) if X were still open: both payments listed under "Needs your decision" as "another payment also references this invoice" | | |

### Case F — late arrival

Create an invoice (`0.5 USDC`), **close the app fully** (swipe it away), pay via QR,
wait a few minutes, reopen.

| | expected | got |
|---|---|---|
| Sync line on open | "Checking for new payments…" then the row | |
| Invoice | paid · by reference | |
| Nothing ever claims real-time | true | |

## 2. Fixtures

Commit every dumped JSON under `packages/core/test/fixtures/s2/` (public devnet
data). Then, in a follow-up, pin them: a normalizer test per fixture (events under
WATCHED) and a matcher test for A/B/D — the same assertions `check-fixture`
printed, made permanent.

| fixture | case | owner-paging | ATA-paging | tier a |
|---|---|---|---|---|
| `exact-payment.json` | A | | | |
| `second-payment.json` | B | | | |
| `direct-transfer.json` | C | | | |
| `wrong-amount.json` | D | | | |
| `duplicate-qr.json` / `duplicate-direct.json` | E | | | |
| `late-arrival.json` | F | | | |

## 3. Go / no-go

**GO** means: A, B and F detected and auto-matched with no manual step; D shows up
under "Needs your decision" with the right shortfall; C and E's direct transfer
stay unmatched (expected — that is the tier-b gap, sized here as "1 of N payments
in this run", which is the number to carry into the post-grant tier-b design).

**NO-GO** triggers and their named fallbacks:

- B invisible to both paging paths → Phantom used a non-associated token account:
  add `getTokenAccountsByOwner` enumeration on a user RPC URL (publicnode gates it).
- A detected only via owner paging AND B not detected at all → engine bug in
  `sync/wallet.ts`; the fixture reproduces it in `test/wallet.test.ts`.
- Phantom does not parse the QR at all → S3's problem, not S2's; note the exact
  failure (no prefill? wrong mint?) and continue with the URL typed by hand.

Verdict: ______ · Date: ______ · Device: ______ · Phantom version: ______
