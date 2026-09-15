# DECISIONS

Every non-obvious technical decision, recorded when made (per PROJECT.md line 138).

Format: what was decided, why, what it costs, and what would make us revisit. A decision
without a revisit trigger is a belief, not a decision.

---

## D0 — v0.1 target date moves to Sunday, September 27, 2026

**Date:** 2026-08-13 · **Status:** accepted

PROJECT.md originally carried Sep 13 2026 in two places (Context, and the v0.1 scope
heading). From the planning date of Thu Aug 13 that is 31 days — **4.4 weeks**, not the
~6.5 weeks the build plan assumes. At 6–8 h/week that is ~27–35 hours; reserving the
final 1.5 weeks for polish, landing page, demo video, and Release packaging left only
~3 weeks (~20 h) of actual build time for six scope items.

Moved to **Sun Sep 27 2026** (45 days ≈ 6.4 weeks), which is the date the plan was
implicitly written against. PROJECT.md has been updated so the stale date does not
survive in the source of truth.

**Cost:** two weeks of calendar against the grant milestone. Taken deliberately in
preference to the alternative, which was discovering the shortfall in week 4 with
valuation and CSV export unbuilt.

**Revisit if:** the grant milestone date is externally fixed and cannot move. Then the
cut list (PROJECT.md line 117) is applied from the bottom immediately rather than in
week 5 — CSV export and valuation come out, and v0.1 ships as ingestion + reference
matching + invoice PDF, which is still a coherent demo.

---

## D1 — Encryption at rest is in v0.1 scope

**Date:** 2026-08-13 · **Status:** accepted

PROJECT.md line 93 states "Encrypted at rest" under Storage with no deferral marker. It
is absent from the v0.1 "In" list, which made the scope genuinely ambiguous. Read as
**in scope**, on the reasoning that everything actually deferred in PROJECT.md is
labelled as such — P2P replication is "post-grant" (line 92), the AI layer is "deferred"
(line 95), the tier-b matcher is on the cut list (line 123). Encryption carries no such
label, and the app holds client names, invoice amounts, and a complete income history
for a product whose entire premise is privacy.

**Consequence:** decides D2 in favour of op-sqlite.

**Revisit if:** week-1 work shows SQLCipher materially complicating the Android build.
Falling back to Android's file-based encryption is defensible for v0.1 and would flip
D2 — but that is a decision to make deliberately, not to arrive at by accident.

---

## D2 — SQLite driver: op-sqlite

**Date:** 2026-08-13 · **Status:** accepted

PROJECT.md line 91 explicitly leaves this open and asks for it to be recorded here.
Candidates were `@op-engineering/op-sqlite` and `expo-sqlite`.

**Chose op-sqlite:**

1. **SQLCipher.** op-sqlite ships it as a build-time option. expo-sqlite has no
   encryption story short of encrypting columns by hand in application code, which is
   both more work and easier to get wrong. Given D1, this is close to decisive on its
   own.
2. **Bulk-write throughput.** Spike 1 backfills a "real, busy address" (line 130) —
   tens of thousands of signatures inserted in batches. op-sqlite's JSI path avoids the
   bridge serialization that dominates expo-sqlite on large writes.
3. **The native-module cost is already paid.** Line 59 commits to prebuild/dev client,
   so we are not sacrificing Expo Go — we never had it.

**Cost:** op-sqlite can lag Expo SDK releases. Mitigated by pinning the Expo SDK for the
whole build window (no upgrades before Sep 27) and by keeping SQLite behind
`StoragePort`, which holds a swap to roughly a day.

**Revisit if:** the SDK pin has to break mid-window, or SQLCipher blocks the Android
build. `StoragePort` exists precisely so this stays reversible.

> **Pin set 2026-08-23 (T5):** Expo SDK **57** — `expo ~57.0.15`, `react-native
> 0.86.2`, `react 19.2.3`, matching the official `sdk-57` template exactly. Current
> stable, fifteen patch releases in; op-sqlite 18.1.4 declares open peer ranges, so
> nothing constrains against it. No upgrades before Sep 27.

---

## D3 — Domain logic lives in a pure-TypeScript core, and purity is enforced

**Date:** 2026-08-13 · **Status:** accepted

PROJECT.md line 61 requires a pure-TS core with zero UI/platform dependencies so the
post-grant desktop surface (line 60) reuses it unchanged. Recorded as a decision because
the interesting part is the *enforcement*: an architectural rule that lives only in a
README decays the first time someone reaches for a React hook or `Date.now()`.

`packages/core` is guarded by an ESLint config banning imports of `react*`,
`react-native*`, `expo*`, `@op-engineering/*`, `@solana/*`, and Node builtins, plus
`Date.now`, `Math.random`, `fetch`, and `localStorage`. Its `tsconfig` sets `types: []`,
so `@types/node` globals do not even typecheck. CI runs the rule.

Core reaches the outside world through ports: `RpcPort`, `StoragePort`, `ClockPort`,
`RatePort`, `DocPort`, `ReferenceKeyPort`. The payoff is practical, not aesthetic — the
whole domain suite runs in a plain Node process against fixtures with no native modules
and no network, so the test loop stays in seconds.

**Revisit if:** never, within v0.1. If a port genuinely cannot express something,
add a port rather than an exception.

---

## D4 — The op log holds human decisions only; SQLite is disposable

**Date:** 2026-08-13 · **Status:** accepted

Direct from PROJECT.md line 90, recorded here because it is the rule most likely to be
broken by accident. Chain-derived data (`ChainEvent`) is **not** written to the op log:
it is re-derivable from RPC, so mirroring it would turn a compact record of intent into
an unbounded copy of the chain and make the post-grant replication story (line 92) far
more expensive than it needs to be.

Ops are append-only and never rewritten. A mistake is corrected by appending a
compensating op (`match-rejected` undoes `match-confirmed`), so the record of what the
user decided, and when, stays intact — which is the point for an audit trail.

**Enforcement:** a test folds op log + chain events into projection state, clears the
projection, rebuilds from the same inputs, and asserts the result is identical. If
chain data ever leaks into the op log, or the fold picks up ambient state, that test
fails. This is scheduled as task T11 in week 2, not later — an untested rebuild path is
an architecture claim, not an architecture.

---

## D5 — No telemetry, and it has to be switched off explicitly

**Date:** 2026-08-13 · **Status:** accepted

PROJECT.md line 49 forbids telemetry of any kind, opt-in or otherwise. Recorded because
this needs an *action*, not just abstention: Expo and EAS ship analytics that are on by
default, so shipping without disabling them would violate the constraint while nobody
had written a line of tracking code.

Task T6 disables Expo/EAS telemetry and documents the check. The same rule blocks
crash reporters (Sentry and similar) for v0.1 — which is consistent with the KPI
choice, since PROJECT.md line 53 already picked GitHub Release download count precisely
because it needs zero instrumentation.

> **Settings as of 2026-08-23 (T7, exact):** every `apps/mobile` npm script prefixes
> `EXPO_NO_TELEMETRY=1`, which disables the Expo CLI's telemetry. No analytics or
> crash-reporting SDK exists in any package.json (grep for
> sentry|amplitude|segment|posthog|firebase|analytics across workspaces: no matches).
> Remaining when EAS enters (T17): run builds with `EXPO_NO_TELEMETRY=1` set in the
> environment as well.

---

## D6 — npm workspaces, not pnpm

**Date:** 2026-08-13 · **Status:** accepted

The monorepo uses **npm workspaces**.

The trigger was mundane — pnpm was not present and installing it globally needed root —
but the reasoning is not: pnpm's symlinked `node_modules` is a known source of Metro
and native-module resolution failures in Expo monorepos, and working around it requires
`node-linker=hoisted`, which discards most of what pnpm is for. npm workspaces hoist by
default, which is the layout Expo's own monorepo guidance assumes.

**Cost:** slower installs, less strict dependency isolation than pnpm would give.
Acceptable for a two-package workspace.

**Revisit if:** the workspace grows past a handful of packages, or install time becomes
a real irritant in CI.

---

## D7 — Reference keys stay random and unlinkable

**Date:** 2026-08-13 · **Status:** accepted (restating PROJECT.md line 55)

Restated here as a decision rather than left in the success-metrics section, because it
reads as a metrics footnote and is actually a security constraint that a future
contributor could plausibly undo while trying to be helpful.

Invoice reference keys are randomly generated and carry no derivable structure. Making
them derivable or taggable would allow anyone to identify Local Books invoices on-chain
and deanonymise users' income addresses — breaking the core privacy promise in exchange
for a usage counter.

`ReferenceKeyPort.generate()` is therefore a port over a real keypair generator, not a
deterministic derivation from invoice fields. **Do not "improve" it into one.**

---

## D8 — Backfill is a generator that requests pauses rather than taking them

**Date:** 2026-08-13 · **Status:** proposed — confirm against Spike 1

The paged-backfill driver in core is an async generator that yields after every
checkpointed page and returns a requested `pauseMs`; the *caller* sleeps. Core therefore
contains no timers, no network, and no clock.

Three things fall out of this. Progress is durable between pages, so an Android process
kill loses at most one page (line 71). The UI can render progress and a background task
can stop at a time budget, without ingestion knowing either exists. And the tests run
instantly — "kill it mid-sync" is expressed by simply not pulling the next value.

Resume is exactly-once at page granularity: the cursor only advances past signatures
actually handed to the caller, so a crash mid-page re-fetches that page, and dedup on
`(signature, instructionIndex)` makes the replay harmless. Re-fetching one page is the
cheaper failure than advancing first and losing it.

**Confirm in Spike 1.** If measured 429 behaviour shows the pacing model is wrong —
e.g. endpoints need jitter, or per-endpoint concurrency beats sequential paging — this
gets revised before anything is built on top of it.

> **Confirmed by S1 (2026-08-23).** The driver absorbed mainnet-beta's server-advised
> 10 s backoffs and resumed exactly-once after two different crash shapes, unmodified
> (`spikes/01-rpc-backfill.md`). Status: accepted.
>
> **Amended 2026-08-23 (T6 review): the durability handshake.** The driver originally
> persisted the checkpoint *before* yielding the page — an Android kill between the
> two left a permanent hole in history (cursor advanced past data the caller never
> stored). Now the checkpoint is written only when the consumer pulls the *next*
> item, i.e. after its loop body persisted the page. A page not followed by another
> pull is re-fetched on resume; dedup absorbs the replay. Replay is recoverable,
> holes are not. Pinned by two tests in `backfill.test.ts`.
>
> **Amended 2026-08-27 (sync-engine review): two watermark rules.** (1) An
> incremental run that exhausts its page budget *before reaching the stored
> watermark* must not advance the watermark — that would jump it over signatures
> never fetched, a permanent hole reported as success. It now reopens the checkpoint
> (`complete: false`, `oldestSeen` = the paging cursor) and reports
> `page-budget-reached`, converting the unwalked gap into a resumable backfill;
> replay below the old watermark is absorbed by dedup. (2) `complete` with no
> `newestSeen` means "the address was empty when walked", not "never look again":
> the next incremental reopens it, so a freshly created wallet's first-ever payment
> lands instead of the address freezing forever (this would have bricked the T16
> demo shape — watch a new wallet, then pay it). Both pinned in `backfill.test.ts`;
> `BackfillCheckpoint.complete` is documented as NOT a one-way latch.

## D9 — Endpoint order is fixed (user RPC when set → publicnode → mainnet-beta), no JSON-RPC batching

**Date:** 2026-08-23 · **Status:** accepted — from S1 measurements

> **2026-09-01 (heading reconciled):** the T9 adapter was built and tested with a
> user-supplied RPC URL FIRST in the failover list when one is configured
> (`rpc.ts mainnetEndpoints`): a URL the user typed in is the endpoint they chose,
> and it is not rate-limited like the public pool. The original heading listed it
> last and contradicted the shipped order; the body below (public-pool ranking, the
> error-copy remedy, no batching) was always consistent with the code and stands.

S1 (`spikes/01-rpc-backfill.md`) found the free public pool is exactly two endpoints,
and they are not peers: publicnode sustains ~5 tx/s of `getTransaction` with zero 429s
where mainnet-beta manages ~0.6 tx/s with a 429 every ~10 calls. So the T9 adapter uses
**publicnode as primary and mainnet-beta as failover** — an ordered list, not
round-robin — with a user-supplied RPC URL (PROJECT.md line 72) offered in rate-limit
error copy as the first remedy.

`getTransactions` fetches **sequentially, never via JSON-RPC batch arrays**: publicnode
rejects batches outright (HTTP 400) and mainnet-beta rate-limits them above ~10, so
batching buys nothing on the primary and complicates pacing on the failover. The
driver's `pauseMs` (D8) stays the only throttle.

Revisit only if the on-device re-run of the S1 harness (W2 device pass) contradicts the
datacenter-measured numbers.

## D10 — Event identity is endpoint-stable and per-watched-address

**Date:** 2026-08-23 · **Status:** accepted — from adversarial review of the normalizer

Two identity rules, both existing to survive re-fetches and multi-wallet users:

**`instructionIndex` never depends on inner-instruction recording.** Whether a node
serves `meta.innerInstructions` is that node's configuration, and the backfill driver
rotates endpoints on failover — so the same signature can arrive with and without CPI
detail. A top-level instruction keeps its position in `message.instructions` (part of
the signed transaction, identical everywhere); an inner instruction gets
`(parent+1)*1024 + offset`. A provider omitting inner data can make a CPI event
*absent* (harmless: stored-wins merge keeps the original) but can never *renumber*
anything — renumbering would defeat `(signature, instructionIndex)` dedup and
double-book payments on failover.

**Stored events dedup on `(signature, instructionIndex, watchedAddress)`.** A transfer
between two wallets the user watches is one movement but two ledger facts — an `out`
for one address, an `in` for the other. Deduplicating on the movement alone silently
dropped one side. `eventKey` (movement) remains what ops and matching join on;
`eventIdentity` (movement + watched address) is what the event store dedups on.

In the same review pass: tier-a auto-apply now requires the transaction to admit
exactly one transfer-to-invoice pairing (references are recovered at transaction
level, so a two-invoice settlement is ambiguous by construction — PROJECT.md line 81's
"a human confirms" extends to it); income statements are half-open `[start, end)` and
exclude failed transactions; CSV export neutralizes spreadsheet formula injection in
free-text cells; malformed wire amounts skip the instruction instead of aborting the
page.

## D11 — The RPC adapter is plain fetch JSON-RPC, not web3.js

**Date:** 2026-08-23 · **Status:** accepted

T8's original sketch said "RpcPort adapter over web3.js". Implemented without it:

1. **Watch-only needs two methods.** `getSignaturesForAddress` and `getTransaction`
   (jsonParsed) — the whole of web3.js buys nothing for a read-only surface, and
   core's normalizer deliberately owns the wire shape (`RawTransaction.raw` is
   `unknown` precisely so no web3.js typing leaks inward).
2. **React Native cost.** web3.js drags the Buffer/crypto polyfill swamp into the app.
   The one thing that genuinely needs cryptography — reference keygen (T13, D7) — uses
   `@noble/ed25519` + expo-crypto's CSPRNG instead: pure JS, Hermes-clean, ~5 KB.
3. **The shape is spike-proven.** The S1 harness ran this exact adapter design against
   live mainnet for the whole measurement matrix.

The adapter (`apps/mobile/src/adapters/rpc.ts`) also carries a per-request timeout —
S1's airplane-mode caveat resolves here: a dead connection throws instead of hanging
sync, and the driver's checkpoint makes the retry safe.

**Revisit if:** v2 needs signing or websockets (it must not — watch-only forever), or
an RPC provider requires a non-JSON-RPC transport.

> **Amended 2026-08-27 (sync-engine review): two wire-trust rules.** (1) An empty
> signature page while paging with a `before` cursor is trusted only after the
> endpoint confirms it knows that cursor (`getSignatureStatuses` with
> `searchTransactionHistory`) **and** the empty page reproduces on a second ask —
> the endpoint is a pool, and the confirmation can come from a healthy sibling of
> the lagging backend that served the empty page; the retry both detects the split
> and self-corrects it (a healthy backend's answer is served instead). Otherwise
> the adapter throws and the engine rotates. Verified against live devnet: a real
> node answers an unknown cursor with an *empty page* — exactly the shape that
> would have durably marked a backfill `complete:true` and silently truncated the
> books. (2) A null `getTransaction` result — this node does not serve that
> transaction, though `getSignaturesForAddress` just listed it — is OMITTED from
> the returned batch, never wrapped as fetched. Wrapped, the engine counted it
> hydrated and checkpointed past a payment it never obtained; omitted, it stays in
> `missingSignatures` and is retried on this endpoint and then the next. Pinned in
> `rpc.test.ts` and live in `rpc.devnet.integration.test.ts`.

## D12 — The SQLCipher key is never re-minted over existing books

**Date:** 2026-08-23 · **Status:** accepted — from adversarial review of T6

SecureStore can return null on a device that HAS books: Android Auto Backup restores
app data but never Keystore entries; a lock-screen change can invalidate the Keystore.
Treating "no key" as "first launch" would overwrite the entry with a fresh key and
make the books permanently undecryptable, silently — the worst failure available to
this app.

So key provisioning is recorded **out-of-band**, in a tiny plain (unencrypted,
secret-free) meta database: the fact that a key exists plus a SHA-256 fingerprint of
it, written only after the encrypted DB first opens successfully. On launch:

- no key + no marker → genuine first run → mint and store;
- no key + marker → **`KeyLostError`**, surfaced to the user. Starting over requires
  explicitly deleting the old database; the app never does it on its own;
- key + marker with a different fingerprint → `KeyLostError('mismatch')`, same rule.

The key is stored `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — background sync works after
boot, and the entry never migrates in a backup, which makes the restore behaviour
deterministic (the marker catches it) instead of platform-dependent. `isSQLCipher()`
is asserted at open, so a build that lost the SQLCipher flag fails loudly rather than
writing plaintext books (D1).

## D13 — Sync engine: one endpoint cursor, and a page that cannot persist is abandoned, never pulled past

**Date:** 2026-08-27 · **Status:** accepted

The app-side sync engine (`apps/mobile/src/sync/engine.ts`) consumes D8's generators
and makes three policy decisions core cannot:

1. **One endpoint cursor for both paging and hydration.** Failover (D9) applies to
   the *run*, not the request: when either paging (`failover-needed`, a transport
   error) or hydration (`maxConsecutiveRateLimits` zero-progress 429s, a chunk the
   endpoint knows nothing of) exhausts an endpoint, the whole run moves to the next
   one, recreating the generator from the stored checkpoint — which makes the
   restart seamless. When the ordered list runs out, the run ends
   `endpoints-exhausted`: surfaced to the user, retried on the next open / refresh /
   poll, with the user-supplied RPC URL (PROJECT.md line 72) as the first remedy in
   the copy.

2. **Persist-then-pull, and abandon on failure.** Hydration persists each chunk
   (25 signatures — progress-reporting and cancellation granularity, NOT a JSON-RPC
   batch; D9 still forbids those) as it lands. A page that cannot fully hydrate is
   abandoned WITHOUT pulling the next generator item, so the checkpoint stays behind
   it (D8); the partial progress is kept, and the replay hydrates only the shortfall
   (`missingSignatures`). Replay is recoverable; a checkpoint past unstored data is
   not.

3. **Errors rotate only if they indict the endpoint.** `RateLimitedError`,
   `RpcHttpError`, `RpcResponseError`, network-message `TypeError`s, and timeouts
   rotate; everything else — storage corruption, programming errors — propagates.
   Retrying a broken disk against a different RPC server would only bury it. A
   plain `TypeError` is NOT sufficient: on Hermes every
   "cannot read property of undefined" is one, so only the known network messages
   qualify.

Sync scheduling is PROJECT.md line 62 verbatim: on open, on returning to the
foreground, on pull-to-refresh, and a 30 s foreground timer. Never a real-time
promise; progress is counts, never an invented percentage (total history size is
unknown until the walk completes).

**Revisit if:** the background task (T29's periodic Android sync) needs finer budget
control than the `page-budget-reached` hand-back provides, or if a future RPC
adapter's error taxonomy stops mapping onto the rotate/propagate split.

## D14 — Auto-apply requires a conclusive chain answer: exact amount, one global claim, and no prior human rejection

**Date:** 2026-08-31 · **Status:** accepted — two gates from adversarial review of T18

PROJECT.md line 81 lets a *reference* match auto-confirm. The T18 review showed
"carries the reference" is not the same as "the chain's answer is conclusive", so
auto-apply (`apps/mobile/src/matching.ts`) passes four gates:

1. **In-transaction unambiguity** (core, D10): the transaction admits exactly one
   transfer-to-invoice pairing.
2. **Pass-level unambiguity over EVERY claim.** Two on-chain payments claiming one
   invoice is ambiguous no matter which of them is individually clean — the count
   includes claims core already refused to auto-apply and claims a human rejected.
   The review demonstrated a duplicate hiding inside an ambiguous batched settlement
   silently laundering its clean twin into an auto-confirm when only auto-applicable
   candidates were counted.
3. **A rejected pair never auto-applies again.** `match-rejected` is a compensating
   op (D4); the projection tracks every rejected `(invoice, event)` pair in
   `rejectedMatches`, and automation re-confirming one would override a recorded
   human decision. A human may still re-confirm by hand.
4. **Exact amount, same mint.** Solana Pay lets the payer edit the amount before
   signing, so without this gate the PAYER decides when the freelancer's books say
   "paid" — a dust payment carrying the reference would settle a 1250 USDC invoice,
   and there is no rejection UI yet to undo it. Under-, over-, and wrong-token
   payments stay visible as unexplained deposits until a human books them
   (`amountAgreement` exists precisely to label these in the confirm UI to come).

**Cost:** legitimate partial payments and fee-shaved transfers are not auto-booked.
Accepted: a human tap on a flagged candidate is cheap; un-ringing a wrong "paid" on
a tax-relevant ledger is not.

**Revisit if:** the W5 polish pass adds the confirm/reject UI — gates stay, but
under/over candidates should then be *offered* with the shortfall labeled, not
merely left in the deposits list.

## D15 — NBG rates: the endpoint's own effectivity model, verbatim strings, Georgian receipt days

**Date:** 2026-09-01 · **Status:** accepted — T23

The RatePort contract says "the rate actually effective on that date, or throw."
NBG's date-parameterized endpoint already speaks that model: asked for a Sunday or a
holiday it returns the latest rate whose `validFromDate` is on or before the
requested day — a Friday rate IS the official weekend rate, so accepting it is
correct, not nearby-day substitution. What the adapter must never do is invent that
substitution itself: offline with nothing cached for the day, it throws; it never
serves a neighbouring day's cached row. (Live probe 2026-09-01 pinned as fixtures:
weekday, weekend-carry, and holiday-carry responses.)

Decisions inside that frame, each argued by a failure it prevents:

1. **`rateFormated` verbatim, never the float `rate` field.** The response carries
   both; only the decimal string ever touches money (floats on money are banned
   repo-wide). A fixture where the two fields disagree pins that the float is never
   consulted.
2. **A zero rate is refused, twice.** `"0.0000"` is publishable garbage, not a
   price: accepted, it would value a whole day's income at 0.00 GEL as *valued*
   rows (no banner) and first-write-wins caching would keep it forever. The adapter
   throws before caching; the cache ALSO refuses to serve a zero row (corruption).
3. **`validFromDate` is parsed as a date-part pattern, never `Date.parse`.** A
   zone-less timestamp parses as device-LOCAL time; on the UTC+4 devices this app
   ships to, midnight becomes 20:00 the previous day, mis-keying the dual write and
   poisoning the neighbouring day's cache row permanently.
4. **Receipt days are GEORGIAN calendar days (+4h, DST abolished 2005).** blockTime
   is an instant; its UTC date books a payment landing 00:00–04:00 Tbilisi to the
   previous day and values it at the previous day's rate. `receiptDateKey` converts
   instant → Tbilisi day, matching both the filing's notion of receipt date and
   NBG's own day boundaries. The income report's date/month labels use the same
   calendar (D16), so rate days and report days can never disagree.
5. **The cache is a plain (unencrypted) SQLite DB, first-write-wins.** Official
   rates are public and re-fetchable — no secret to protect, and a lost books key
   (D12) must not take the rate history with it. First-write-wins (INSERT OR
   IGNORE) is the audit-trail stance: a rate a filing already used is never
   rewritten by a later re-fetch, and the weekend dual-write (requested day + the
   rate's own day) leans on that immutability.
6. **Future receipt dates throw before cache and fetch.** NBG would happily answer
   a future date with today's rate — which would then be cached under a date it was
   never effective on.

**Revisit if:** a second fiat lands (the GEL-only gate and the +4h constant are the
two places that assume Georgia), or NBG restates a published rate (first-write-wins
would then need an explicit, user-visible correction path).

## D16 — Valuations are recomputed, never stored; internal transfers are not income

**Date:** 2026-09-01 · **Status:** accepted — T24–T26 wiring

Valuations are a pure function of (event, cached rate): `valueEvents` recomputes
them when the income screen opens, and the rate cache (D15) is the only persisted
piece. No valuations table, no staleness, nothing to migrate — and rebuild (D4)
gets valuation correctness for free. Failures are memoized per receipt day within a
pass: the rate cache remembers only successes, so without the memo an offline month
would re-fetch the same failing date once per payment, each bounded only by the
request timeout.

The statement excludes, and counts, **internal transfers**: an incoming row whose
counterparty is one of the user's OWN addresses (every address ever watched plus
every invoice payTo — the same set `rebuild()` loads). D10 keeps both legs of a
business→savings move as ledger facts, which is correct for the LEDGER; booking the
in-leg as income would inflate the turnover a Georgian 1%-regime filing pays tax
on. The exclusion is surfaced (`internalCount` + a screen note), never silent —
same stance as `unvaluedCount`.

Screen totals, monthly groups, and the exported CSV all derive from ONE statement
built in `incomeSummary` — "totals match the CSV to the cent" is structural, and
the statement's period end clears max(device now, newest blockTime) so a device
clock running behind chain time cannot silently drop the freshest payment.

**Revisit if:** valuation ever becomes expensive enough to precompute (it is one
cached lookup per day today), or a user legitimately invoices one of their own
watched addresses (the exclusion would then need a human override).

## D17 — Documents: core builds models, the app renders them; only invoices become PDFs in v0.1

**Date:** 2026-09-01 · **Status:** accepted — T19/T20 code halves

`invoiceDoc` (core) turns an `InvoiceCreatedOp` into a renderable model: amounts
formatted from exact bigints in core, line totals recomputed and asserted against
the stored total (a mismatch throws rather than printing a document that disagrees
with itself), and the Solana Pay URL built once — the QR payload and the printed
total come from the same `TokenAmount`, so the page can never ask for a different
number than it shows.

The renderer (`invoiceHtml` + the DocPort adapter) owns layout only: every model
string is HTML-escaped (pinned field-by-field), the QR is a locally generated SVG
(`qrcode`, pure JS — no canvas, no native module), and the page references no
external resource of any kind — a shared PDF must render identically offline and
years later. The HTML path (`doc/invoicePdfHtml.ts`) is a separate pure module,
which is what lets it run under vitest in Node; the DocPort adapter imports
expo-print/expo-sharing statically. (Amended 2026-09-15: the first cut imported
them with `import()` inside the methods. In a dev build Metro serves a dynamic
import as a split bundle fetched at tap time, and Expo's split-bundle loader
failed on the phone with "cannot read property 'reload' of undefined" the moment
the dev client was not connected to Metro. Static imports make the modules part
of the main bundle like every other native module.)

`RenderableDoc.kind` gates hard: income-statement PDFs are on the post-grant
deferred list, and the adapter throws on them rather than half-rendering. The CSV
export shares through the same native sheet but is not a document render — it is
`toCsv` output written to a cache file, and the strict-parser tests own its shape.

**Revisit if:** S3 (Phantom scan of the printed/shared QR) surfaces layout or
error-correction problems — QR module size and margin live in one place in the
DocPort adapter.

## D18 — Network and RPC endpoint are build-time flags; mainnet is the default

**Date:** 2026-09-14 · **Status:** accepted — W5 cut line

`NETWORK` had been a hardcoded `'devnet'` constant waiting for a settings screen
that no task ever scheduled, which meant a Release APK built from the tree could
only ever watch devnet. Two days before freeze the cheapest correct fix is a
build-time switch, not a screen: `apps/mobile/src/config.ts` reads
`EXPO_PUBLIC_NETWORK` (Expo inlines `EXPO_PUBLIC_*` at bundle time), and only the
literal `devnet` selects devnet — anything else, including absence and typos, is
mainnet, so a mistake cannot ship a devnet build to a real user. The demo path
sets it in `apps/mobile/.env.development`, which Expo loads for debug builds and
`expo start` only — plain `.env` is loaded for EVERY mode, release included, so
the devnet line must never live there (the review caught the first draft making
exactly that mistake). A release build therefore stays mainnet with nothing to
remember to delete. The ledger header shows a `DEVNET` tag so footage and
testers can tell which build they hold.

The user-supplied RPC URL (PROJECT.md line 72, S1's GO condition 3) is likewise
`EXPO_PUBLIC_RPC_URL` in `.env` (all builds), placed first in the failover list
(D9). It cannot be validated at build time — babel inlines whatever the env holds
— and a throw at module evaluation would close a release build on launch before
any screen could explain, so an invalid value is IGNORED with a logcat warning
and the public endpoints are used. The URL is baked into the APK as a plain
string, API key included: an APK built with a keyed URL must never be shared.
The in-app settings screen D9/D13 assumed is deferred post-grant; the rate-limit
copy therefore no longer promises a paste-in remedy.

**Cost:** a power user rebuilds to use their own endpoint, and must keep keyed
builds to themselves. Acceptable for a v0.1 whose users are the pilot cohort.

**Revisit if:** the pilot cohort hits public-endpoint throttling in practice — that
is the signal the settings screen has earned its place.

## D19 — Token accounts are derived locally and paged alongside the wallet

**Date:** 2026-09-14 · **Status:** accepted — bug fix inside T11/T16 scope

`getSignaturesForAddress(owner)` returns only transactions whose account list names
the owner. A plain SPL `transfer`/`transferChecked` into an EXISTING token account
names the token account and the payer — never the recipient wallet — so
owner-only paging sees the first USDC payment (its ATA-create instruction names
the owner) and none after it. PROJECT.md line 68 always said "track associated
token accounts"; the code did not.

The fix: `sync/ata.ts` derives the owner's associated token account for each
invoice mint of the running network (USDC/USDT on mainnet, devnet USDC on devnet)
with the on-chain program's own rule — sha256 over the seeds, first bump from 255
down whose hash is off the ed25519 curve — pinned against two real mainnet ATAs in
the normalizer fixture. `sync/wallet.ts` then pages the owner and each ATA in
turn. Each address keeps its own checkpoint (D8), but the ATA passes normalize and
store events under the OWNER (engine option `owner`): direction and internal-move
detection already resolve via token-balance owners, dedup identity is per watched
wallet (D10), and every consumer downstream keeps seeing one address. The ATA's
checkpoint row is keyed `<ata>@<owner>`, not `<ata>`: the app accepts any 32-byte
key as a watched address, so a user can watch a token account directly AND its
wallet, and those are two walks with two event stores — a shared cursor would let
the first walk's "complete" skip the second's entire history.

Derived, not enumerated: `getTokenAccountsByOwner` is an indexed method that
publicnode gates behind an API key (probed 2026-09-14), and enumerating would also
drag in every dust-airdrop account on a mainnet wallet. Derivation is offline,
bounded to the stablecoins the product values, and costs one extra
`getSignatures` per mint per sync. Classic Token program only; token-2022 derives
differently and stays deferred.

**Cost:** two more RPC calls per sync pass on mainnet. Within S1's measured budget.

**Verified 2026-09-15 (S2 on devnet, Solflare):** of four real USDC payments into a
watched wallet, only the first — the one whose ATA-create instruction names the
wallet — was visible to owner-only paging; the other three named the token account
alone and were found through the derived ATA. Solflare paid into the associated
account every time. Pinned in `packages/core/test/s2-devnet.test.ts`.

**Revisit if:** a wallet app is seen paying into a non-associated token account
(then enumeration is needed after all), or token-2022 stablecoins arrive.

## D20 — No background sync in v0.1; the framing says "while the app is open"

**Date:** 2026-09-14 · **Status:** accepted — W5 cut line

README, PROJECT.md line 62, the App docstring, and T29 all promised "periodically
in the background on Android". Nothing implemented it: sync runs on launch, on
foreground, on pull-to-refresh, and on a 30 s timer gated on the app being active.
Adding `expo-background-task`/WorkManager two days before freeze would be a new
native dependency, a fresh prebuild, and an untested execution path on the one
device pass left. The honest option is the cheap one: the copy now says the app
"checks when you open it, and while it is open", every document agrees, and
WorkManager sync moves to the post-grant list. The line-62 rule stands: never
promise real-time.

**Cost:** a payment landing while the app is closed shows up on the next open, not
before. That was already true.

**Revisit if:** pilot users report missing a payment because they did not open the
app — the WorkManager task then has a measured reason to exist.

## D21 — Reference candidates automation refuses get a human tap: confirm or reject

**Date:** 2026-09-14 · **Status:** accepted — closes D14's revisit trigger

D14's four gates deliberately leave under-, over-, and wrong-token payments,
ambiguous batched settlements, and second claims on one invoice unbooked. Until
now nothing offered them to anyone: `match-rejected` had no producer, and an
invoice underpaid by a fee stayed open forever. The invoices screen now lists
these under "Needs your decision" with the shortfall or overage named
(`ui/pendingCopy.ts`), and two buttons that say what they write: "Mark paid"
records `match-confirmed` with `via: 'reference-confirmed-by-user'` (a new value,
so the audit trail distinguishes a human's booking from automation's), "Not this
invoice" records `match-rejected`, which D4's projection already treats as barring
automation from the pair for good. `pendingMatches` is the exact complement of
`autoMatchOps` minus rejected pairs; both run on every refresh, automation first.

Rejected pairs are not offered again in v0.1: D4 allows a human to re-confirm one,
but a list that keeps asking about a decision already made would be the machine
relitigating the human. The deposit stays visible in the ledger. When the OTHER
claim on an invoice was the one rejected, the survivor is still offered (automation
stays out: a rejected claim still counts under D14 gate 2) with copy that says so
rather than asking the human to choose between one thing.

One transfer settles at most one invoice: the projection now enforces it (a later
confirm of the same transfer to a different invoice supersedes the earlier one,
consistent with later-decision-wins everywhere else in the fold). Before this,
the two pairings of one transfer inside an ambiguous batch could both be confirmed
and both invoices would read "paid" on one payment.

**Cost:** confirming an underpayment marks the invoice paid without recording the
shortfall as a receivable. The op log holds both amounts, so a later "partially
paid" status can be derived without migration.

**Revisit if:** the pilot cohort asks for partial-payment tracking, or tier b
lands (its candidates plug into the same list with `autoApplicable: false`).

## D22 — The repository is private until the release is ready

**Date:** 2026-09-14 · **Status:** accepted — user decision

The repo went public in W1 (T1) and was taken private during the build. It stays
private for now. The grant deliverable (PROJECT.md line 115: "public repo") is
unchanged: it flips back to public with the v0.1 Release (T33/T34), before grant
review.

**Cost:** the CI badge 404s and no outside eyes until then. **Revisit if:** the
grant reviewers ask for repo access before Sep 27.
