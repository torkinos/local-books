# TASKS — Local Books v0.1

Agent-executable tasks. Each is **≤ half a day** (~3–4 h at this budget) and carries
acceptance criteria that can be checked without asking the author what they meant.

**`[M2]`** marks a grant deliverable — installable Android build, repo access, landing
page. None of them sits in the final week only; the repo is public in W1 and the first
Release APK ships in W2.

Order matters: tasks are sequenced so the **demo path closes by end of W2**
(T7 → T16), which is the milestone the rest of the plan leans on.

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cut

---

## W1 · Thu Aug 13 – Sun Aug 23 — scaffold + spikes

### `[ ]` T1 · Repo, license, README `[M2]`
Initialise the repo, MIT license, README with a one-paragraph description and a build
section. Push to GitHub **public**.
**Accept:** repo reachable at a public URL by someone logged out; README states what the
app is, that it is watch-only, and that it has no backend; `PROJECT.md`, `PLAN.md`,
`TASKS.md`, `DECISIONS.md` present at root.

### `[ ]` T2 · Monorepo + core package skeleton
npm workspaces (DECISIONS.md D6): `packages/core`, `apps/mobile`. Core is `type: module`,
strict TS, `types: []`.
**Accept:** `npm install` succeeds from a clean clone; `npm run typecheck` passes;
`packages/core` has zero runtime dependencies.

### `[ ]` T3 · Vitest + the purity guard
Vitest for core. ESLint config banning `react*`, `react-native*`, `expo*`,
`@op-engineering/*`, `@solana/*`, Node builtins, `Date.now`, `Math.random`, `fetch`.
**Accept:** `npm test` runs (green, even with one trivial test); adding
`import 'react-native'` to a core file **fails lint** — demonstrated once and the output
pasted into the PR. A guard nobody has watched fail is not known to work.

### `[ ]` T4 · CI
GitHub Actions: install, typecheck, lint, test on push and PR.
**Accept:** a red build blocks; badge in README.

### `[ ]` T5 · Expo prebuild + dev client on a physical Android device
Expo app in `apps/mobile`, prebuild, dev client, **pinned SDK** (D2).
**Accept:** the app launches on a real Android phone and renders a placeholder screen;
the pinned SDK version is written into DECISIONS.md.

### `[ ]` T6 · op-sqlite + SQLCipher behind `StoragePort`
Wire op-sqlite with SQLCipher; key from `expo-secure-store`. Nothing in core imports it.
**Accept:** the app opens an encrypted DB, writes and reads a row across a restart;
inspecting the DB file with plain `sqlite3` fails to open it. Lint still passes (proving
core never learned SQLite exists).

### `[ ]` T7 · Telemetry off (D5)
Disable Expo/EAS analytics; no crash reporter.
**Accept:** documented in DECISIONS.md with the exact settings; a grep for analytics SDKs
in `package.json` files returns nothing.

### `[ ]` S1 · **Spike: RPC backfill + rate limits** (weekend, ~4 h)
Page a real busy mainnet address across 2–3 public endpoints, persisting cursor state.
Kill mid-sync; resume. Toggle airplane mode mid-page.
**Accept:** `spikes/01-rpc-backfill.md` records, per endpoint: pages fetched, calls made,
429 count, wall-clock to completion, and whether resume was exactly-once. Ends with an
explicit **go/no-go** and, if no-go, a named fallback (user-supplied RPC URL, or capped
history depth).

### `[ ]` S2 · **Spike: reference-key detection** (weekend, ~3 h)
Devnet: transfer request → payment → `findReference`. Then a **direct transfer that
ignores the QR**.
**Accept:** `spikes/02-reference-detection.md` confirms tier-a detection end to end, and
records fixtures + counts for: exact payment, direct transfer, wrong amount, duplicate
amounts in one window, late arrival. Fixtures land in `packages/core/test/fixtures/`.
Explicitly **does not** implement tier b.

### `[ ]` S3 · **Spike: PDF + QR quality** (weekend, ~3 h)
Generate an invoice PDF via `expo-print` with an embedded Solana Pay URL and QR. Scan
with **Phantom on a physical device**.
**Accept:** `spikes/03-pdf-qr.md` includes the generated PDF, confirms Phantom parses the
QR into a transfer request with correct mint/amount/reference, and notes any layout,
font, or page-break problems with a fix or a workaround.

---

## W2 · Mon Aug 24 – Sun Aug 30 — the demo path

### `[ ]` T8 · Domain types + ports
`Address`, `Signature`, `ReferenceKey`, `TokenAmount` (bigint), `ChainEvent`, `Op`,
`Valuation`. Ports: `RpcPort`, `StoragePort`, `ClockPort`, `RatePort`, `DocPort`,
`ReferenceKeyPort`. Deferred seams (P2P, OCR, NL) as **types only**.
**Accept:** typecheck passes; no deferred seam has an implementation; money is bigint
everywhere — a grep for `parseFloat`/`Number(` on amounts returns nothing.

### `[ ]` T9 · `RpcPort` adapter over web3.js
Lives in `apps/mobile`. Surfaces 429s as `RateLimitedError` rather than retrying
silently — the backfill driver owns pacing.
**Accept:** fetches a real page of signatures on devnet; a forced 429 throws
`RateLimitedError` with `retryAfterMs` when the server sent it.

### `[ ]` T10 · Checkpointed backfill driver (core)
Async generator yielding after every checkpointed page, returning a requested `pauseMs`;
the caller sleeps (D8).
**Accept:** unit tests cover — pages to end of history; checkpoints after **every** page;
resumes from the stored cursor after being killed mid-sync; retries the *same* cursor
after a 429; asks for failover after N consecutive 429s; stops at the page budget. No
timers or network in core.

### `[ ]` T11 · Transaction normalizer + dedup
`jsonParsed` → `ChainEvent`. SOL transfers, SPL transfers via pre/post token balances,
memo, blockTime, counterparty, reference accounts.
**Accept:** identity is `(signature, instructionIndex)`, not signature alone — a batch
payout with three transfers in one transaction produces three events, proven by a test.
Re-ingesting the same page changes nothing.

### `[ ]` T12 · Op log + projection + **rebuild equivalence** (D4)
Append-only op log; `project(ops, chainEvents)` pure and synchronous; `rebuild()` in the
app clears the projection and refolds.
**Accept:** a test folds inputs, clears, rebuilds from the same inputs, and asserts
**identical** state. Chain data never enters the op log — asserted by a test that reads
the log after ingestion and finds no `ChainEvent`.

### `[ ]` T13 · Reference-key generation (D7)
`ReferenceKeyPort` over a real keypair generator. Random, unlinkable, **not** derived
from invoice fields.
**Accept:** 1000 generated keys are unique; a code comment states the deanonymisation
reasoning and points at PROJECT.md line 55.

### `[ ]` T14 · Tier-a matcher
Match incoming successful transfers carrying an invoice's reference.
**Accept:** tests cover — matches on reference; **does not** match a direct transfer with
no reference (the tier-b gap, asserted as a passing test); ignores failed transactions;
ignores outgoing; keeps two transfers in one transaction distinct; still matches when the
client underpays, flagging the shortfall separately.

### `[ ]` T15 · Minimal UI: add address + ledger list
Two screens. Paste an address, label it, watch backfill progress; a ledger list of
events with direction, amount, counterparty, date.
**Accept:** works on a physical device against devnet; backfill progress is visible and
survives backgrounding the app.

### `[ ]` T16 · **Demo path end-to-end on devnet**
Add address → pay with a Solana Pay transfer request → detected → matched → visible.
**Accept:** runs on a physical device, start to finish, **recorded as a screen capture**
(raw footage for the W6 demo video — capture it while it is fresh).

### `[ ]` T17 · EAS build → GitHub Release APK `[M2]`
Configure EAS, produce a signed APK, publish as a GitHub Release.
**Accept:** the APK downloads from the Release page and installs on a **clean** device
that has never had a dev build. Ships in W2 deliberately — five weeks before it is due,
so the pipeline fails early rather than on Sep 26.

---

## W3 · Mon Aug 31 – Sun Sep 6 — invoicing

### `[ ]` T18 · Invoice model + creation screen
Client, line items, token, amount, due date. Emits an `invoice-created` op.
**Accept:** an invoice round-trips through the op log and appears in the projection;
amounts stay bigint end to end.

### `[ ]` T19 · Invoice PDF via `DocPort`
Core builds the model; `apps/mobile` renders with `expo-print`. Applies S3's findings.
**Accept:** a multi-line invoice renders with correct totals and no clipped content;
core has no PDF dependency.

### `[ ]` T20 · Solana Pay QR + share sheet
Embed the transfer-request URL as a QR; share via the native sheet.
**Accept:** Phantom scans the QR from the shared PDF and pre-fills the correct mint,
amount, and reference; sharing works to at least WhatsApp and email.

### `[ ]` T21 · Landing page skeleton `[M2]`
Deployed and thin: what it is, one screenshot, a Release download link.
**Accept:** live on a public URL, responsive, no analytics (D5). Deployed now so DNS,
hosting, and the deploy step are not discovered in W6.

### `[ ]` T22 · Invoice → payment → match, end to end
**Accept:** create an invoice on the phone, share the PDF, pay from another device, watch
it auto-match. Screen-captured.

---

## W4 · Mon Sep 7 – Sun Sep 13 — valuation + export

### `[ ]` T23 · NBG rate adapter + cache
`RatePort` over the National Bank of Georgia daily rates, cached locally.
**Accept:** returns the rate **effective on the requested date**, not today's; throws
rather than substituting a nearby day; works offline once cached.

### `[ ]` T24 · Valuation at receipt date
Stablecoin→USD 1:1; USD→local via the daily rate. Integer arithmetic only.
**Accept:** every `Valuation` carries source, rate, and rate date (line 86) — the type
makes this impossible to omit; a non-stable mint throws rather than guessing;
`multiplyDecimals` is tested for half-up rounding at 2 dp.

### `[ ]` T25 · Generic CSV export
Audit columns: rate, rate source, rate date alongside amounts.
**Accept:** RFC 4180 escaping tested against a memo containing a comma, a quote, and a
newline; the file opens cleanly in a spreadsheet; unvalued rows are **reported**, not
silently dropped from the total.

### `[ ]` T26 · Income statement screen
Monthly totals per client from the projection.
**Accept:** totals match the CSV to the cent.

---

## W5 · Mon Sep 14 – Sun Sep 20 — cut line, then freeze

### `[ ]` T27 · Apply the cut line (Mon–Wed)
Cut from the bottom of PROJECT.md line 117 — CSV export first, then valuation.
**Accept:** anything cut is recorded in DECISIONS.md with a reason and moved to a
post-grant list. Nothing is left half-built in the tree.

> **Wed Sep 16 — FEATURE FREEZE.** Nothing new after this, including "small" things.

### `[ ]` T28 · Empty states + error copy
Every screen has a first-run state; RPC failures say what to do next.
**Accept:** a fresh install with no addresses is comprehensible without a tutorial.

### `[ ]` T29 · Backfill progress + honest sync framing
Per PROJECT.md line 62: "checks when you open, and periodically in the background on
Android." **Never** promise real-time.
**Accept:** the copy makes no real-time claim anywhere; progress is visible during a long
backfill.

### `[ ]` T30 · Device pass on a clean install
**Accept:** install the Release APK on a device that has never run a dev build; complete
the full loop; log every rough edge as a fix-or-cut decision.

---

## W6 · Mon Sep 21 – Sun Sep 27 — ship

### `[ ]` T31 · Landing page content `[M2]`
Real copy, screenshots, the download link, a note that it is watch-only and has no
backend.
**Accept:** a stranger understands what it does and who it is for in under 30 seconds.

### `[ ]` T32 · Demo video
Cut from footage captured in T16 and T22 — do not re-shoot from scratch.
**Accept:** ≤ 3 minutes, shows the whole loop (invoice → share → pay → match → report),
published and linked from the landing page and README.

### `[ ]` T33 · Release build + GitHub Release `[M2]`
Signed APK, release notes, known limitations stated plainly.
**Accept:** downloads and installs from a logged-out browser on a clean device; the loop
works; release notes name the deferred items so expectations are set.

### `[ ]` T34 · Repo tidy for grant review `[M2]`
README, architecture note, `DECISIONS.md` current, build instructions that work from a
clean clone.
**Accept:** someone else follows the README on a fresh machine and gets a running dev
build without asking a question.

### `[ ]` T35 · Final build-in-public thread
**Accept:** posted, links the Release and the landing page.

---

## Deferred — post-grant, not this window

Tier-b heuristic matching · iOS hardening · P2P multi-device sync · desktop/accountant
surface · OCR · NL queries · DAO/multisig ingestion · token-2022 edge cases ·
Koinly-compatible CSV · Solana dApp Store submission · monthly report PDFs beyond the
basic income statement.

(PROJECT.md line 126. Tier-b will be tempting the moment S2 shows the direct-transfer
gap. It stays here.)
