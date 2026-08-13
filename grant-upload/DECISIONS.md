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
