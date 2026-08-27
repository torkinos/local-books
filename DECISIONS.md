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

## D9 — Endpoint order is fixed (publicnode → mainnet-beta → user RPC), no JSON-RPC batching

**Date:** 2026-08-23 · **Status:** accepted — from S1 measurements

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
