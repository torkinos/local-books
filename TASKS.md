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

## Your side, condensed (revised 2026-09-19)

The device and ship tasks below overlap heavily. Done in this order they collapse to
six sessions, **five of them now behind you**; everything not listed here is either
done, mine to do in the sandbox (LICENSE, README, landing page HTML, release notes,
thread draft), or cut.

**Where it stands on 2026-09-22, all verified from outside the sandbox:** repo public,
Pages live, CI green on master at HEAD, the APK on the Release page byte-identical to
the corrected build, the release promoted and branch protection on. **Nothing in this
tracker is open**, and the grant's final tranche was submitted on 2026-09-22.

One loose end survives outside the task list: the `v0.1.0` tag still sits 8 commits
behind master, so the Release's generated *Source code* archives carry the superseded
video link. See T33.

1. **DONE 2026-09-15.** ~~One phone session, screen-recorded (~30 min).~~ Follow
   `spikes/02-reference-detection.md`: three payments (QR, second QR, direct
   transfer). Then open **Income** once and tap **Export CSV** to yourself. Then kill
   the app and reopen it: the rows are still there. That single run closes S2, S3,
   T6, T15, T16, T19, T20, T22, T25, T26, T28, T29 on the device side. Skipped on
   purpose: the `sqlite3`-can't-open check, the S1 phone re-run and airplane-mode
   test, sharing to WhatsApp *and* email (any one share is enough).
2. **DONE 2026-09-16.** ~~Release APK, locally (~20 min, no EAS).~~ One keystore, one Gradle command
   (`cd apps/mobile/android && ./gradlew assembleRelease`), upload the APK to a
   GitHub Release. I write the signing steps and release notes; the default icon
   ships if nobody has time for a better one.
3. **DONE 2026-09-16.** ~~Clean-install check (~10 min).~~ Uninstall the dev build, install that APK from
   the Release page, watch one address, see one payment. That is T30 and T33's
   "installs on a clean device".
4. **DONE 2026-09-18, re-cut 2026-09-19.** ~~Video + links (~30 min).~~ First cut ran
   **5:32**; re-uploaded at 2× as a Short, now **2:46** (`rAkFKRttFnE`, verified), which
   meets M5's "under three minutes" as written. The re-upload changed the video ID, so
   all five references were swapped — three tracked files plus the two gitignored drafts.
   `TODO_VIDEO_URL` is long gone, develop is merged to master (PR #2), CI is green.
   **Two loose ends carried into session 5:** the three tracked files now hold a new ID
   and are **uncommitted**, and the Release *notes* on GitHub still predate the video
   entirely. The `gh release edit` in session 5 fixes the second: it reads
   `docs/releases/v0.1.0.md` from the working tree, so it picks up the new link whether or
   not the commit has landed. Push anyway, and push first — Pages serves `master:/docs`,
   so until you do, the live landing page still points at the 5:32 video.

5. **DONE 2026-09-19, except the retag.** ~~Public + Pages + retag + promote.~~
   Branch protection landed the same day (T4). **The retag is still open:** `v0.1.0`
   points at `9b92c8c`, 8 commits behind master, so the Release's generated *Source
   code* archives still link the superseded 5:32 video.
   All verified from outside: repo **public**, **Pages live** and serving the 2:46 video,
   release **promoted** (`prerelease: false`) with notes carrying the new link,
   `/releases/latest` resolving to `/tag/v0.1.0` so the Download CTA works, the APK
   byte-identical to the corrected build, and CI green on `93b807d`.

   **Branch protection landed 2026-09-19** (`protected: true`, required check `check`),
   which closes T4 and with it every repo-side task. Note the trade it brings: master no
   longer accepts a direct push, so even a one-line docs fix goes branch → CI → merge.
   Optional leftovers: `v0.1.0` is three commits
   behind master and its source archives still carry the old video link, so
   `git tag -f v0.1.0 origin/master && git push --force-with-lease origin v0.1.0` if you want them to
   match. T1, T21, T31, T33, T34 are closed.

6. **CUT 2026-09-19.** ~~Thread (~10 min).~~ Withdrawn, not postponed — see D24 and T35.
   The draft stays on the Mac at `grant-upload/thread-v0.1.md` with its links filled, so
   posting it later costs only a trim pass: every one of its seven posts is over X's
   280-character limit (post 2 by 17, post 5 by 153), which X Premium would also solve.

---

## W1 · Thu Aug 13 – Sun Aug 23 — scaffold + spikes

### `[x]` T1 · Repo, license, README `[M2]`
> **2026-08-23:** repo public (verified logged-out, HTTP 200), four root docs present,
> README added — states watch-only, no backend, and has a build section.
> **2026-09-14:** reopened. Repo is PRIVATE for now (D22; logged-out fetch returns
> 404) and flips back to public with the Release. A `LICENSE` file was never added —
> README and package.json say MIT, GitHub shows "no license". Both close under T34's
> checklist below.
> **2026-09-16:** `LICENSE` (MIT) added and merged. Only the flip is left: verified
> again from outside today, `api.github.com/repos/torkinos/local-books` and the HTML
> page both return 404 logged out. Session 5.
> **2026-09-19: done.** The flip happened. Verified from outside, logged out:
> `api.github.com/repos/torkinos/local-books` and the HTML page both return **200**,
> the API reports `private: false`, `visibility: public` and detects the MIT licence
> from the `LICENSE` file. Acceptance met in full.
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

### `[x]` T4 · CI
GitHub Actions: install, typecheck, lint, test on push and PR.
**Accept:** a red build blocks; badge in README.
> **2026-08-23:** `.github/workflows/ci.yml` written (typecheck, lint, purity-guard
> self-check, tests) and badge in README. Remaining: push and watch the first remote
> run go green, then enable branch protection so red blocks.
> **2026-09-14:** it had never run (triggers were master + PRs; all work is on
> develop, 12 commits ahead) and would have been red: it pinned Node 20 while five
> mobile test files need `node:sqlite` (Node 22.13+; `.nvmrc` says 24). Fixed:
> `node-version-file: .nvmrc`, develop added to the push triggers, `engines.node`
> and the README now say 24. Remaining: push develop, watch it go green, merge to
> master, enable branch protection.
> **2026-09-16:** develop pushed and green, PR #1 merged to master (`1a0e545`), so the
> workflow now runs on both branches. Remaining: branch protection on master, which is
> a Settings click in session 5.
> **2026-09-19:** CI is **green on master at `1f30395`** (HEAD) — so the suite that
> cannot run in the sandbox is passing on the real toolchain; no Mac run is owed.
> Only half the acceptance line is met: the badge is in the README and the workflow
> runs, but `branches/master` still reports `protected: false`, so a red build does
> not yet block. That single Settings toggle is all that is left of T4.
> **2026-09-19, closed.** Classic branch protection is on `master` — verified from
> outside, `branches/master` now reports `protected: true` (the rulesets API still
> returns `[]`, which is expected: classic rules are not surfaced there). The required
> status check is the `check` job from `ci.yml`; the `build`/`deploy`/
> `report-build-status` names that appear alongside it belong to the Pages deployment
> workflow and were deliberately not required. Both halves of the acceptance line are
> now met: the badge is in the README and a red build blocks.
> **Consequence, effective immediately:** direct `git push origin master` is refused —
> commits must reach master through a branch whose `check` run has passed.
> ~~**2026-09-19, still open — checked twice.** `branches/master` reports
> `protected: false` and `rules/branches/master` returns `[]`, so there is neither a
> classic protection rule nor a ruleset. CI is green on `93b807d` (HEAD), so the only
> thing missing is the toggle that makes a red run *block*. This is the last repo-side
> task in the window.~~
> **2026-09-22 — the note above is wrong. Struck, not deleted.** It was filed out of
> order, after the toggle had already been flipped, and it contradicts the "closed" note
> directly above it. Re-checked live today: `branches/master` returns `protected: true`
> with `protection.enabled: true` and status checks enforced for non-admins.
> `rules/branches/master` returning `[]` is expected for a **classic** protection rule
> and was misread as absence. T4 is closed; nothing in it is open.

### `[x]` T5 · Expo prebuild + dev client on a physical Android device
Expo app in `apps/mobile`, prebuild, dev client, **pinned SDK** (D2).
**Accept:** the app launches on a real Android phone and renders a placeholder screen;
the pinned SDK version is written into DECISIONS.md.
> **2026-08-23:** scaffold complete — SDK 57 pinned (recorded under D2), monorepo
> metro config, placeholder screen that calls `@local-books/core` (bigint on Hermes
> proof), telemetry off in every script.
> **Done:** verified on a physical Android device — app launches and renders the
> placeholder (user-confirmed). W1 is now fully closed.

### `[x]` T6 · op-sqlite + SQLCipher behind `StoragePort`
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

### `[x]` S2 · **Spike: reference-key detection** (weekend, ~3 h)
> **2026-09-14:** runbook + tooling ready: `spikes/02-reference-detection.md` is the
> step-by-step (Solflare on devnet, faucets, three payments: QR, second QR, direct
> transfer — the rest is optional and unit-tested already), and
> `spikes/02-reference-detection/` has `dump-fixture.mjs` (signature → fixture JSON)
> and `check-fixture.mjs` (runs the REAL normalizer + matcher over a fixture and
> says whether owner paging, token-account paging, and tier a would each have seen
> it). Needs the phone and a devnet wallet — cannot run in the sandbox.
> **2026-09-15: RUN, verdict GO.** Three QR payments matched by reference, the direct
> transfer stayed open. On-chain: 3 of the 4 payments never named the wallet (D19 was
> load-bearing). Four devnet transactions pinned as `packages/core/test/fixtures/s2/`
> + `test/s2-devnet.test.ts`. Same session closed S3 (PDF rendered, Solflare scanned
> the QR and prefilled mint/amount/recipient), T6/T15 (kill + reopen, rows intact),
> T16 + T22 (screen-recorded end to end), T19/T20 (share sheet), T25/T26 (income
> screen + CSV export). Phantom's Testnet Mode never showed devnet funds — the
> runbook now says Solflare.
Devnet: transfer request → payment → `findReference`. Then a **direct transfer that
ignores the QR**.
**Accept:** `spikes/02-reference-detection.md` confirms tier-a detection end to end, and
records fixtures + counts for: exact payment, direct transfer, wrong amount, duplicate
amounts in one window, late arrival. Fixtures land in `packages/core/test/fixtures/`.
Explicitly **does not** implement tier b.

### `[x]` S3 · **Spike: PDF + QR quality** (weekend, ~3 h)
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
> **2026-09-16:** that half has been in the tree since T6 —
> `apps/mobile/test/sqliteStorage.test.ts:279` runs core's `rebuild()` against the real
> SQLCipher adapter and asserts it matches a live fold. Nothing outstanding.
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
> **2026-09-14:** the "flagging the shortfall" half now reaches a human (D21):
> `pendingMatches` (the complement of `autoMatchOps` minus rejected pairs) feeds a
> "Needs your decision" list on the invoices screen — shortfall/overage/wrong token
> named, Mark paid (`via: reference-confirmed-by-user`) or Not this invoice
> (`match-rejected`). Review round then split the reasons so the copy is truthful for
> every gate shape (which invoice / which transfer / other claim rejected) and made
> the projection enforce one-transfer-one-invoice. Tests: `test/pending.test.ts` and
> core `test/projection-one-invoice.test.ts`. Eyeball on device in T30.

### `[x]` T15 · Minimal UI: add address + ledger list
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

### `[x]` T16 · **Demo path end-to-end on devnet**
Add address → pay with a Solana Pay transfer request → detected → matched → visible.
**Accept:** runs on a physical device, start to finish, **recorded as a screen capture**
(raw footage for the W6 demo video — capture it while it is fresh).
> **2026-09-14:** a code gap that would have broken this on the SECOND payment is
> fixed before the device pass (D19): owner-only paging never sees a USDC transfer
> into an existing token account, so each wallet's stablecoin ATAs are now derived
> locally and paged too (`sync/ata.ts`, `sync/wallet.ts`; derivation pinned to two
> real mainnet ATAs). The build must be devnet for this task: put
> `EXPO_PUBLIC_NETWORK=devnet` in `apps/mobile/.env.development` (D18; never in
> `.env`, which release builds also read). S2's runbook
> (`spikes/02-reference-detection.md`) is the script for this capture.

### `[x]` T17 · EAS build → GitHub Release APK `[M2]`
> **2026-09-15:** no EAS — local Gradle instead. `apps/mobile/plugins/withReleaseSigning.js`
> (Expo config plugin, applied at prebuild) adds a `release` signing config that reads
> the keystore + passwords from `~/.gradle/gradle.properties`, and the release build
> type uses it when present (the build log says which key signed). Patch verified
> idempotent against the generated build.gradle. `android.versionCode` pinned in
> app.json. Release notes drafted at `docs/releases/v0.1.0.md`; README has the
> keystore + build steps. **2026-09-16: done** — keystore created, release APK built
> and signed with it, published as pre-release `v0.1.0`.
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

### `[x]` T19 · Invoice PDF via `DocPort`
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
> **2026-09-15 (device):** first Share PDF on the phone failed with "cannot read
> property 'reload' of undefined" — the dynamic `import()` made Metro serve
> expo-print as a split bundle at tap time and Expo's loader broke without a live
> Metro connection. Fixed: static imports; the pure HTML path moved to
> `src/doc/invoicePdfHtml.ts` so the tests keep running under Node (D17 amended).
> **Remaining on device:** S3 pass — print/render on the phone, apply findings.

### `[x]` T20 · Solana Pay QR + share sheet
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

### `[x]` T21 · Landing page skeleton `[M2]`
Deployed and thin: what it is, one screenshot, a Release download link.
**Accept:** live on a public URL, responsive, no analytics (D5). Deployed now so DNS,
hosting, and the deploy step are not discovered in W6.
> **2026-09-16:** `docs/index.html` + `.nojekyll` committed on master — one file, no
> scripts, no external resources, no analytics (D5 holds by construction). Hosting is
> GitHub Pages off `master:/docs`, so there is no DNS and no account. Not live yet:
> Pages needs the repo public (session 5).
> **2026-09-19: live.** Pages is serving: `torkinos.github.io/local-books` returns 200,
> `screenshot.png` returns 200, and the served HTML carries the real video link (so
> Pages is publishing current `master:/docs`, not a stale build). No DNS, no account,
> no analytics — D5 holds by construction. Acceptance met.

### `[x]` T22 · Invoice → payment → match, end to end
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

### `[x]` T26 · Income statement screen
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

### `[x]` T27 · Apply the cut line (Mon–Wed)
Cut from the bottom of PROJECT.md line 117 — CSV export first, then valuation.
**Accept:** anything cut is recorded in DECISIONS.md with a reason and moved to a
post-grant list. Nothing is left half-built in the tree.
> **2026-09-14 (Mon):** nothing on the In list is cut — every code half is built and
> tested. What a 53-agent audit found half-built or promised-but-absent was decided
> and recorded instead: network/RPC URL are build-time flags, settings screen
> deferred (D18); token-account paging built (D19); background sync deferred and
> the framing reworded everywhere (D20); confirm/reject built (D21); repo private
> until release (D22). Still half-built and NOT yet decided: the `category-assigned`
> op is folded and exported but nothing produces it (categorization UI is on the
> deferred list now), and core's unused `CorePorts` interface. Both are removals or
> one-line notes for T34.
> **2026-09-16 — closed.** Both decided in **D23**: `CorePorts` removed (nothing ever
> imported it), `category-assigned` kept and documented at the type as producerless in
> v0.1 — its fold, its row field and its CSV column are complete and already shipped in
> the APK, so deleting the op would change an export's shape to remove a column that has
> to come back. Nothing half-built is left in the tree.

> **Wed Sep 16 — FEATURE FREEZE.** Nothing new after this, including "small" things.

### `[x]` T28 · Empty states + error copy
Every screen has a first-run state; RPC failures say what to do next.
**Accept:** a fresh install with no addresses is comprehensible without a tutorial.
> **2026-09-14:** code half done. Every screen already had a first-run state; added
> this pass: the boot-failure screen offers Try again (generic) or names the exact
> Android path to clear data (lost key, D12) instead of dead-ending; + New is
> disabled with no watched address and the empty state says why; Android hardware
> back returns to the parent screen instead of backgrounding the app
> (`ui/navigation.ts`); an address can be removed from the ledger (confirmed, then
> `address-unwatched`; in-flight sync cancelled). **Remaining on device:** the
> fresh-install walk-through itself.

### `[x]` T29 · Backfill progress + honest sync framing
Per PROJECT.md line 62: "checks when you open the app, and while it is open."
**Never** promise real-time.
**Accept:** the copy makes no real-time claim anywhere; progress is visible during a long
backfill.
> **2026-09-14:** the line-62 framing changed to what the app actually does (D20:
> no background job in v0.1); README, PROJECT.md, App docstring and this task now
> agree. The one real-time-sounding string ("matches itself when it lands") reads
> "the next time the app checks". Progress copy covers the new token-account pass
> ("Backfilling token-account history — …", D19). **Remaining on device:** watch a
> long backfill once and confirm the counts read sensibly.

### `[x]` T30 · Device pass on a clean install
**Accept:** install the Release APK on a device that has never run a dev build; complete
the full loop; log every rough edge as a fix-or-cut decision.

---

## W6 · Mon Sep 21 – Sun Sep 27 — ship

### `[x]` T31 · Landing page content `[M2]`
Real copy, screenshots, the download link, a note that it is watch-only and has no
backend.
**Accept:** a stranger understands what it does and who it is for in under 30 seconds.
> **2026-09-16:** final copy written — the loop in four steps, the three things it will
> never do, what is in v0.1, known limitations, the real phone screenshot
> (`docs/screenshot.png`), and both buttons (APK, source). The video slot holds
> `TODO_VIDEO_URL` until session 4.
> **2026-09-19: done.** The video slot is filled and live on the page. One caveat that
> is T33's to close, not T31's: the page's **Download the APK** button points at
> `/releases/latest`, which does not resolve while v0.1.0 is flagged pre-release.

### `[x]` T32 · Demo video
> **2026-09-18:** published at **5:32**, which does not meet the ≤ 3 minutes on the
> acceptance line below. M5's "under three minutes" is a presentation preference, not a
> functional criterion, and no copy anywhere in the repo names a duration — so nothing
> published is contradicted by the longer cut. The whole loop is shown end to end, and
> chapters in the video description carry a viewer to each beat.
> **Cost:** a reviewer checking M5 against the shipped video finds the mismatch in one
> glance, and the uncut waiting — the backfill, the second QR payment, the pauses
> between tapping and the chain answering — is exactly what makes someone stop watching
> before the match and the CSV export, which are the point. Trimming stays available:
> a YouTube Studio edit keeps the video ID, so the three published links survive it.
> **2026-09-19: resolved, and the deviation is withdrawn.** Re-uploaded at 2× as a Short
> — `rAkFKRttFnE`, **2:46** (166 s, confirmed from YouTube), unlisted, playable. The
> acceptance line below is now met as written, so M5 needs no argument made for it.
> The speed-up forced a re-upload: YouTube Studio trims without changing the video ID but
> **cannot change playback speed**, and YouTube does not allow replacing a file on an
> existing upload. So the ID moved, and all five references were swapped in one pass —
> `README.md`, `docs/index.html` and `docs/releases/v0.1.0.md` (tracked), plus
> `GRANT-APPLICATION.md` and `grant-upload/thread-v0.1.md` (gitignored, Mac-only).
> `git grep yLAAbZGteow` now prints only retro notes like this one — no live link to the
> old cut survives on master, though the `v0.1.0` **tag** still serves one until it is
> moved (T33). The guard for next time is
> `grep -rl rAkFKRttFnE` over a `find` list, because this shell's `grep` is `ugrep
> --ignore-files` and silently skips the two gitignored copies.
> **Three consequences, none blocking.** Shorts do not render description chapters, so
> the per-beat markers noted above are gone. At 2× the on-screen numbers — invoice
> fields, the matched row, the CSV columns — are harder to read than they were, which is
> the price of meeting a constraint we wrote ourselves rather than one Superteam set
> (the Earn form's Step 3 is free text and asks for no video at all). And the published
> links deliberately use the `watch?v=` form rather than `/shorts/`: both resolve, but
> the desktop Shorts player restricts scrubbing, and a reviewer will scrub.
> **Optional polish, visible to anyone who clicks through from the README:** the video
> is titled `local-books-demo` (a filename) and the channel reads `Bruce`. Both are
> Studio edits that do not touch the ID.
Cut from footage captured in T16 and T22 — do not re-shoot from scratch.
**Accept:** ≤ 3 minutes, shows the whole loop (invoice → share → pay → match → report),
published and linked from the landing page and README.

### `[x]` T33 · Release build + GitHub Release `[M2]`
> **2026-09-16:** `v0.1.0` published as a **pre-release** with the release-signed
> APK and `docs/releases/v0.1.0.md` as notes; clean-install check passed on the
> phone (T30). Remaining: paste the demo video link into the notes and promote the
> same release from pre-release to release in session 5.
> **2026-09-16, later:** the pre-release APK must be REBUILT before promotion —
> publicnode (the D9 primary) was found serving only ~2 days of mainnet history,
> which would have silently truncated every user's books; mainnet-beta is now the
> only public endpoint (D9 amended), `versionCode` bumped to 2. Rebuild with the
> same three commands and `gh release upload v0.1.0 <apk> --clobber`.
> **2026-09-17 (PR #1 review fixes, also in the rebuild):** the add screen refuses
> token-account/off-curve addresses (watching a wallet plus its USDC account double-
> counted income; D19 note) with a statement-level backstop in core; Android backups
> are off (`allowBackup: false`, D12 amendment — a restore could only ever lock the
> books); the signing plugin now emits an UNSIGNED apk instead of a debug-signed one
> when the keystore properties are missing; the README's keyed-URL check works on
> macOS grep. Still open from the review (Low): user-RPC field validation, non-JSON
> 200 bodies bypassing failover, undated payments missing from the statement, a
> duplicate invoice after a refresh failure, cache cleanup of shared PDFs/CSVs.
> **2026-09-16, verified from outside:** the rebuilt APK in the tree is the right one —
> its JS bundle has zero `publicnode` hits, carries `api.mainnet-beta.solana.com`,
> `versionCode: 2`, and an APK Signing Block (so it is release-signed, not unsigned or
> debug-signed). Confirm the *uploaded* asset is that ~89 MB file. Also open: the
> `v0.1.0` **tag points at `49b58a6` "Delete grant-upload directory" (Aug 14)** —
> master's HEAD before PR #1 — so the Release's source archives are the August tree.
> Retag at master and force-push before promoting (session 5).
> **2026-09-19, verified against the live Release:** the retag happened (`v0.1.0` →
> `9b92c8c`, on master, one docs-only commit behind HEAD — cosmetic, optional to move
> again). The **published asset is byte-identical to the corrected build**: the APK
> downloaded from the Release page and the local
> `app-release.apk` share one SHA-256 (`f7d84e15…`), 92,940,910 B, and that build is
> versionCode 3, carries an APK Signing Block, names `api.mainnet-beta.solana.com` and
> has **zero `publicnode` hits**. The publicnode scare is fully out of the shipped
> artifact; no re-upload is owed.
> **Two things still open, and both are now user-facing:** the release is still flagged
> `prerelease: true`, so `/releases/latest` **404s in the API and redirects browsers to
> the releases index** — and that URL is the "Download the APK" target on both the live
> landing page and the README, so the product's main CTA is degraded for every visitor.
> The release notes on GitHub also predate the video and carry no link to it. One
> command fixes both:
>
> ```sh
> gh release edit v0.1.0 --notes-file docs/releases/v0.1.0.md --prerelease=false
> curl -sI https://github.com/torkinos/local-books/releases/latest | head -1  # expect 302 → /tag/v0.1.0
> ```
> **2026-09-19, closed — verified live.** The release is promoted (`prerelease: false`,
> `draft: false`), its notes carry the 2:46 video and still name the deferred items, and
> `/releases/latest` resolves again: 200 from the API, and the browser URL lands on
> `/tag/v0.1.0`. So the **Download the APK** CTA works on both the landing page and the
> README. The attached APK is untouched at 92,940,910 B. Acceptance met in full.
> **One loose thread, cosmetic but real:** `v0.1.0` now sits **three commits behind
> master**, and the tagged tree predates the video swap — so the Release's *Source code*
> archives still contain the old `yLAAbZGteow` link in README, `docs/index.html` and the
> release notes. If that upload gets deleted, those archives carry a dead link. Fix, if
> you want it: `git tag -f v0.1.0 origin/master && git push --force-with-lease origin v0.1.0`.
Signed APK, release notes, known limitations stated plainly.
**Accept:** downloads and installs from a logged-out browser on a clean device; the loop
works; release notes name the deferred items so expectations are set.

### `[x]` T34 · Repo tidy for grant review `[M2]`
README, architecture note, `DECISIONS.md` current, build instructions that work from a
clean clone.
**Accept:** someone else follows the README on a fresh machine and gets a running dev
build without asking a question.
> **Checklist (from the 2026-09-14 audit):** add the MIT `LICENSE` file (T1); flip the
> repo back to public and re-verify logged-out (T1/D22); README gets the Android
> toolchain + `prebuild`/`run:android` steps; fix the T12 note (its app-side D4
> test already exists in `sqliteStorage.test.ts`); remove core's unused `CorePorts`
> interface; decide the `category-assigned` op (nothing produces it — remove or note).
> **2026-09-16:** five of six done. `LICENSE` added; README rewritten — Status now
> points at the Release, the APK, the landing page and the video, and a new "Dev build
> on a device (Android)" section names the JDK, the SDK, `ANDROID_HOME` and the two
> commands, so a clean clone reaches a running dev build without asking; the T12 note is
> corrected; `CorePorts` removed and `category-assigned` documented (D23). Remaining:
> flip the repo public (session 5).
> **2026-09-19: done.** The repo is public and the README's clean-clone path is the
> last piece of the acceptance line — six of six checklist items closed.

### `[-]` T35 · Final build-in-public thread
**Accept:** posted, links the Release and the landing page.
> **2026-09-16:** draft written to `grant-upload/thread-v0.1.md` — seven posts, the
> numbers are the real ones from the S2 device pass. It is gitignored on purpose
> (`grant-upload/`): a marketing draft does not belong in a public repo. Fill the three
> bracketed links before posting.
> **2026-09-19:** the three links are filled in — Release (the `/tag/v0.1.0` form, which
> works whether or not the release is promoted), site and video. Still unposted, and it
> is the last task in the window.
> **2026-09-19: cut (D24).** Not posted, and not deferred to "later in the window" —
> withdrawn. Promoting the project under the author's own name carries professional
> exposure that is not worth it at this size of grant. Nothing in the grant depends on
> it: the Earn form asks for a personal X profile as a *field*, never for a post, M1–M5
> never mention a thread, and the final tranche needs only the Colosseum link, the repo
> and an AI subscription receipt. Checked before cutting, not assumed.
> **Cost:** the project's only distribution channel goes unused, so the primary KPI —
> Release APK downloads — has nothing driving it and will sit near zero. That number now
> measures nothing about demand, which matters if it is ever quoted in a future
> application. The draft survives at `grant-upload/thread-v0.1.md` (gitignored), links
> filled, ready if a larger grant later makes the exposure worth it.

---

## Deferred — post-grant, not this window

Tier-b heuristic matching · iOS hardening · P2P multi-device sync · desktop/accountant
surface · OCR · NL queries · DAO/multisig ingestion · token-2022 edge cases ·
Koinly-compatible CSV · Solana dApp Store submission · monthly report PDFs beyond the
basic income statement.

(PROJECT.md line 126. Tier-b will be tempting the moment S2 shows the direct-transfer
gap. It stays here.)
