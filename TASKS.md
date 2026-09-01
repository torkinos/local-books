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

### `[x]` T1 · Repo, license, README `[M2]`
> **2026-08-23:** repo public (verified logged-out, HTTP 200), four root docs present,
> README added — states watch-only, no backend, and has a build section.
Initialise the repo, MIT license, README with a one-paragraph description and a build
section. Push to GitHub **public**.
**Accept:** repo reachable at a public URL by someone logged out; README states what the
app is, that it is watch-only, and that it has no backend; `PROJECT.md`, `PLAN.md`,
`TASKS.md`, `DECISIONS.md` present at root.

### `[x]` T2 · Monorepo + core package skeleton
npm workspaces (DECISIONS.md D6): `packages/core`, `apps/mobile`. Core is `type: module`,
strict TS, `types: []`.
**Accept:** `npm install` succeeds from a clean clone; `npm run typecheck` passes;
`packages/core` has zero runtime dependencies.

### `[x]` T3 · Vitest + the purity guard
> **2026-08-23:** guard watched failing: a `react-native` import in core fails lint with
> "core is platform-free (PROJECT.md line 61). Keep RN in apps/mobile".
Vitest for core. ESLint config banning `react*`, `react-native*`, `expo*`,
`@op-engineering/*`, `@solana/*`, Node builtins, `Date.now`, `Math.random`, `fetch`.
**Accept:** `npm test` runs (green, even with one trivial test); adding
`import 'react-native'` to a core file **fails lint** — demonstrated once and the output
pasted into the PR. A guard nobody has watched fail is not known to work.

### `[~]` T4 · CI
GitHub Actions: install, typecheck, lint, test on push and PR.
**Accept:** a red build blocks; badge in README.
> **2026-08-23:** `.github/workflows/ci.yml` written (typecheck, lint, purity-guard
> self-check, tests) and badge in README. Remaining: push and watch the first remote
> run go green, then enable branch protection so red blocks.

### `[x]` T5 · Expo prebuild + dev client on a physical Android device
Expo app in `apps/mobile`, prebuild, dev client, **pinned SDK** (D2).
**Accept:** the app launches on a real Android phone and renders a placeholder screen;
the pinned SDK version is written into DECISIONS.md.
> **2026-08-23:** scaffold complete — SDK 57 pinned (recorded under D2), monorepo
> metro config, placeholder screen that calls `@local-books/core` (bigint on Hermes
> proof), telemetry off in every script.
> **Done:** verified on a physical Android device — app launches and renders the
> placeholder (user-confirmed). W1 is now fully closed.

### `[~]` T6 · op-sqlite + SQLCipher behind `StoragePort`
Wire op-sqlite with SQLCipher; key from `expo-secure-store`. Nothing in core imports it.
**Accept:** the app opens an encrypted DB, writes and reads a row across a restart;
inspecting the DB file with plain `sqlite3` fails to open it. Lint still passes (proving
core never learned SQLite exists).
> **2026-08-23:** code half done and review-hardened — SQL layer tested against real
> SQLite (11 storage tests incl. restart-from-disk and core `rebuild()` against the
> real adapter); serialized port calls (concurrent-transaction corruption
> demonstrated, then fixed); key-loss rule per D12 (never re-mint over existing
> books); `isSQLCipher()` asserted; corrupted rows fail with table+row named. The
> same review fixed the CORE driver: checkpoint now written only after the consumer
> acknowledged the page (D8 amendment — no more silent history holes on process
> kill).
> **2026-09-01:** the D12 key-loss decision table extracted to
> `storage/keyProvision.ts` and unit-tested row by row (incl. marker-written-only-
> after-open and the died-between-writes case) — it was the one review-hardened T6
> logic with zero automated coverage. **Remaining on device:** encrypted file
> unreadable by plain `sqlite3`; physical restart through the op-sqlite binding.

### `[x]` T7 · Telemetry off (D5)
Disable Expo/EAS analytics; no crash reporter.
**Accept:** documented in DECISIONS.md with the exact settings; a grep for analytics SDKs
in `package.json` files returns nothing.
> **2026-08-23:** `EXPO_NO_TELEMETRY=1` on every mobile script, documented under D5
> with the grep proof (no analytics/crash SDKs anywhere). EAS-side env var noted for
> T17.

### `[x]` S1 · **Spike: RPC backfill + rate limits** (weekend, ~4 h)
> **2026-08-23:** done — `spikes/01-rpc-backfill.md`, verdict **GO**; ran the real core
> driver against both live endpoints; endpoint order + no-batching decision recorded as D9.
> Remaining: 15-min on-device re-run during the W2 device pass (datacenter-IP caveat).
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

### `[x]` T8 · Domain types + ports
`Address`, `Signature`, `ReferenceKey`, `TokenAmount` (bigint), `ChainEvent`, `Op`,
`Valuation`. Ports: `RpcPort`, `StoragePort`, `ClockPort`, `RatePort`, `DocPort`,
`ReferenceKeyPort`. Deferred seams (P2P, OCR, NL) as **types only**.
**Accept:** typecheck passes; no deferred seam has an implementation; money is bigint
everywhere — a grep for `parseFloat`/`Number(` on amounts returns nothing.

### `[x]` T9 · `RpcPort` adapter over web3.js
Lives in `apps/mobile`. Surfaces 429s as `RateLimitedError` rather than retrying
silently — the backfill driver owns pacing.
**Accept:** fetches a real page of signatures on devnet; a forced 429 throws
`RateLimitedError` with `retryAfterMs` when the server sent it.
> **2026-08-23:** implemented as plain fetch JSON-RPC, not web3.js — recorded as D11.
> `apps/mobile/src/adapters/rpc.ts`: D9 endpoint order (user RPC first when set),
> sequential tx fetches, per-request timeout, 429→`RateLimitedError` incl. the
> in-band-200 provider shape. Live devnet integration test run and passed (real
> signature page fetched). Adversarial review then hardened it: only an EMPTY page
> ends history (short pages cursor on — a short page must never mark the checkpoint
> complete), `getTransactions` preserves partial progress across mid-batch throttling
> (contract updated on the port), body reads covered by the timeout, RFC 9110
> HTTP-date Retry-After parsed, malformed results labeled with the endpoint. 23 unit
> tests (audit corrected the note's original count; +1 hung-body-read test 09-01),
> concurrency measured not assumed.

### `[x]` T10 · Checkpointed backfill driver (core)
Async generator yielding after every checkpointed page, returning a requested `pauseMs`;
the caller sleeps (D8).
**Accept:** unit tests cover — pages to end of history; checkpoints after **every** page;
resumes from the stored cursor after being killed mid-sync; retries the *same* cursor
after a 429; asks for failover after N consecutive 429s; stops at the page budget. No
timers or network in core.

### `[x]` T11 · Transaction normalizer + dedup
> **2026-08-23:** extraction implemented (`normalize/extract.ts`) against a real
> mainnet fixture; batch-payout and idempotency tests in place; instruction indices are
> endpoint-stable and dedup identity includes the watched address (D10); malformed
> amounts skip rather than abort the page. 29 normalizer tests.
`jsonParsed` → `ChainEvent`. SOL transfers, SPL transfers via pre/post token balances,
memo, blockTime, counterparty, reference accounts.
**Accept:** identity is `(signature, instructionIndex)`, not signature alone — a batch
payout with three transfers in one transaction produces three events, proven by a test.
Re-ingesting the same page changes nothing.

### `[x]` T12 · Op log + projection + **rebuild equivalence** (D4)
> **2026-08-23:** `rebuild()` added (loads ops + events for every op-log-named address,
> clears, refolds); equivalence, idempotence, and op-log-purity tests green. The
> app-side half of D4 (SQLite tables vs fresh fold) waits on T6/T15 — noted in the
> test file.
Append-only op log; `project(ops, chainEvents)` pure and synchronous; `rebuild()` in the
app clears the projection and refolds.
**Accept:** a test folds inputs, clears, rebuilds from the same inputs, and asserts
**identical** state. Chain data never enters the op log — asserted by a test that reads
the log after ingestion and finds no `ChainEvent`.

### `[x]` T13 · Reference-key generation (D7)
`ReferenceKeyPort` over a real keypair generator. Random, unlinkable, **not** derived
from invoice fields.
**Accept:** 1000 generated keys are unique; a code comment states the deanonymisation
reasoning and points at PROJECT.md line 55.
> **2026-08-23:** `apps/mobile/src/adapters/referenceKeys.ts` — `@noble/ed25519` over
> injected CSPRNG (expo-crypto wired in `ports.ts`); 1000-key uniqueness test green;
> D7/line-55 comment on the implementation; secret zeroed after derivation.

### `[x]` T14 · Tier-a matcher
Match incoming successful transfers carrying an invoice's reference.
**Accept:** tests cover — matches on reference; **does not** match a direct transfer with
no reference (the tier-b gap, asserted as a passing test); ignores failed transactions;
ignores outgoing; keeps two transfers in one transaction distinct; still matches when the
client underpays, flagging the shortfall separately.

### `[~]` T15 · Minimal UI: add address + ledger list
Two screens. Paste an address, label it, watch backfill progress; a ledger list of
events with direction, amount, counterparty, date.
**Accept:** works on a physical device against devnet; backfill progress is visible and
survives backgrounding the app.
> **2026-08-27:** code half done. (1) App-side **sync engine**
> (`apps/mobile/src/sync/engine.ts`, D13): drives core's D8 generators, hydrates with
> shortfall retry via `missingSignatures`, rotates endpoints per D9, persists every
> chunk BEFORE the checkpoint-advancing pull, abandons unpersistable pages without
> pulling. (2) Both screens + `App.tsx` orchestration: add-address with base58/32-byte
> validation; ledger with per-address progress (honest counts, no fake percentages);
> sync on open, foreground, pull-to-refresh, and a 30 s foreground timer — no
> real-time claim anywhere. 41 net new tests (count corrected by the 09-01 audit)
> incl. an exact D8-interleaving assertion and a resume-after-cancel replay test. Two adversarial workflow rounds (21 agents)
> confirmed and fixed five real data-loss bugs — recorded under D8 (two watermark
> rules), D11 (two wire-trust rules, verified against live devnet), and D13 (engine
> policy). **Remaining on device:** run both screens against devnet on the physical
> phone — backfill progress visible, survives backgrounding.

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

### `[x]` T18 · Invoice model + creation screen
Client, line items, token, amount, due date. Emits an `invoice-created` op.
**Accept:** an invoice round-trips through the op log and appears in the projection;
amounts stay bigint end to end.
> **2026-08-31:** done, plus the tier-a auto-match wiring the demo path needs (D14).
> Round-trip proven against REAL SQLite incl. close-and-reopen with the exact bigint
> total; the amounts grep is clean (`Number(` touches only regex-guarded integer
> quantities, dates, and an HTTP header — never money). Decisions in code:
> `invoiceId` IS the reference key (1:1 per D7; split only if reissuing ever lands);
> quantities are positive INTEGERS (fractional units are priced into `unitAmount` —
> exact bigint or nothing); due dates are local end-of-day; devnet USDC added to
> `STABLE_MINTS` so the devnet demo values 1:1. Screens: create-invoice (line items,
> token + due-date chips, payTo from watched), invoices list (open/paid/overdue
> badges, "matched by reference" attribution), ledger header link. Adversarial
> workflow (13 agents) confirmed 2 policy majors — both auto-apply gates in D14 —
> plus a double-tap double-invoice race, unobserved refresh failures (now a ledger
> banner), and two RN form nits; all fixed. 24 new tests (count corrected 09-01).
> **2026-09-01:** the two fixes that were code-only are now pinned — the double-tap
> latch extracted to `ui/submitOnce.ts` and unit-tested, and a test pins D14 gate 2
> counting human-REJECTED claims toward pass-level ambiguity. Screen gets eyeballed
> in the W3 device pass alongside T15.

### `[~]` T19 · Invoice PDF via `DocPort`
Core builds the model; `apps/mobile` renders with `expo-print`. Applies S3's findings.
**Accept:** a multi-line invoice renders with correct totals and no clipped content;
core has no PDF dependency.
> **2026-09-01:** code half done. Core: `src/doc/` — `invoiceDoc` model builder
> (amounts formatted from exact bigints, line totals recomputed and asserted against
> the stored total, QR payload and printed total from the same `TokenAmount`; D17).
> Mobile: `src/doc/invoiceHtml.ts` (pure HTML renderer — every model string escaped,
> pinned field-by-field; long base58 wraps, rows keep whole across page breaks, zero
> external resources) + `src/adapters/docs.ts` DocPort over expo-print/expo-sharing
> (Expo modules dynamically imported inside the two port methods so the whole HTML
> path tests under Node). Share button on every invoice row. 18 tests.
> **Remaining on device:** S3 pass — print/render on the phone, apply findings.

### `[~]` T20 · Solana Pay QR + share sheet
Embed the transfer-request URL as a QR; share via the native sheet.
**Accept:** Phantom scans the QR from the shared PDF and pre-fills the correct mint,
amount, and reference; sharing works to at least WhatsApp and email.
> **2026-08-31:** pure half done — `packages/core/src/pay/`: spec-shaped
> transfer-request URL builder (exact bigint amounts via `formatUnitsTrimmed`, no
> URLSearchParams, byte-stable output pinned verbatim). Verification round fetched
> the Solana Pay spec and mutation-tested the suite; both confirmed findings were
> test-strength gaps, fixed (float-implementation-killing fixtures added). Useful
> immediately for the S2/S3 spikes, which need these URLs.
> **2026-09-01:** QR + share sheet code built with T19: QR generated locally as SVG
> (`qrcode`, pure JS) into the invoice PDF; native share via expo-sharing behind
> `DocPort.share`. **Remaining on device:** S3 — Phantom scans the QR from the
> shared PDF with correct mint/amount/reference; share to WhatsApp and email.

### `[ ]` T21 · Landing page skeleton `[M2]`
Deployed and thin: what it is, one screenshot, a Release download link.
**Accept:** live on a public URL, responsive, no analytics (D5). Deployed now so DNS,
hosting, and the deploy step are not discovered in W6.

### `[ ]` T22 · Invoice → payment → match, end to end
**Accept:** create an invoice on the phone, share the PDF, pay from another device, watch
it auto-match. Screen-captured.

---

## W4 · Mon Sep 7 – Sun Sep 13 — valuation + export

### `[x]` T23 · NBG rate adapter + cache
`RatePort` over the National Bank of Georgia daily rates, cached locally.
**Accept:** returns the rate **effective on the requested date**, not today's; throws
rather than substituting a nearby day; works offline once cached.
> **2026-09-01:** done, live-verified. `adapters/rates.ts` + `storage/rateCache.ts`
> (plain SQLite, first-write-wins — D15): NBG's own effectivity model (a Friday rate
> IS the weekend rate, `validFromDate <=` requested), `rateFormated` used VERBATIM
> (float field never consulted, pinned by a disagreeing fixture), zero rates refused
> at fetch AND at cache read, strict date-part parsing (no `Date.parse` local-time
> trap), future dates throw, offline-with-nothing-cached throws actionable copy —
> never a neighbouring day. Receipt days are GEORGIAN days (+4h; D15.4). Fixtures
> pinned byte-for-byte from a live 2026-09-01 probe; env-gated integration test ran
> against the real endpoint (holiday + weekend carry both verified). 23 unit tests
> + 2 live. Review round then hardened all of the above (zero-rate, zone-less
> validFromDate, dual-write coverage were its findings).

### `[x]` T24 · Valuation at receipt date
> **2026-08-23:** `value.test.ts` added — half-up-at-2dp cases float arithmetic gets
> wrong, non-stable-mint throw, full provenance passthrough, receipt-date (not "now")
> rate request. 14 tests.
Stablecoin→USD 1:1; USD→local via the daily rate. Integer arithmetic only.
**Accept:** every `Valuation` carries source, rate, and rate date (line 86) — the type
makes this impossible to omit; a non-stable mint throws rather than guessing;
`multiplyDecimals` is tested for half-up rounding at 2 dp.

### `[x]` T25 · Generic CSV export
> **2026-08-23:** RFC 4180 round-trip tested through a strict parser; unvalued rows
> reported; corrupted fiat amounts throw instead of truncating; spreadsheet formula
> injection neutralized (attacker-controlled memo → inert text).
> **2026-09-01:** app half wired — Export CSV on the income screen writes `toCsv`
> output to a cache file and hands it to the native share sheet
> (`adapters/files.ts`). Screen total and CSV column tied to the cent through ONE
> statement (D16). Remaining device check: open the shared file in a spreadsheet.
Audit columns: rate, rate source, rate date alongside amounts.
**Accept:** RFC 4180 escaping tested against a memo containing a comma, a quote, and a
newline; the file opens cleanly in a spreadsheet; unvalued rows are **reported**, not
silently dropped from the total.

### `[~]` T26 · Income statement screen
Monthly totals per client from the projection.
**Accept:** totals match the CSV to the cent.
> **2026-08-23:** core half done — `monthlyTotalsPerClient` with a test tying monthly
> totals, statement total, and the summed CSV column to the cent. The *screen* waits
> on the app shell (T5/T15).
> **2026-09-01:** screen + valuation wiring done — `ui/IncomeScreen.tsx` over
> `ui/incomeSummary.ts` (one statement feeds screen, monthly groups, and CSV —
> to-the-cent is structural) and `valuation.ts` (`valueEvents`: per-row failure
> isolation, per-day failure memo). An adversarial review round (49 agents, 21
> confirmed findings, all fixed) drove the load-bearing policies now in D16:
> internal transfers between the user's own wallets are EXCLUDED from income and
> counted; day/month labels are Georgian calendar days matching the NBG rate days;
> period end clears skewed blockTimes; the unvalued note separates fetch failures
> ("reconnect and refresh") from unsupported tokens (no false retry promise);
> loading never renders as a definitive 0.00. **Remaining on device:** eyeball the
> screen in the W3 device pass; spreadsheet-open the exported CSV.

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
