# PLAN — Local Books v0.1

**Window:** Thu Aug 13 2026 → **Sun Sep 27 2026** · **Budget:** ~6–8 h/week, ~45 h total
· **Scope:** the v0.1 cut in PROJECT.md lines 106–115, nothing else.

The date moved from Sep 13; see [DECISIONS.md](./DECISIONS.md) D0.

## Shape of the plan

Risk is front-loaded into week 1 and the last 1.5 weeks are reserve. Between those,
three build weeks in the order PROJECT.md's own cut list implies — the things that can
never be cut get built first, so a slip lands on CSV export rather than on the demo.

Two rules keep this honest:

- **Feature freeze is Wed Sep 16.** Reserve that gets spent on features is not reserve.
- **No M2 deliverable exists only in the final week.** The repo is public in week 1 and
  the first installable APK ships in week 2 — five weeks before it is due — so the build
  pipeline fails early, on a Tuesday, rather than on Sep 26.

| Week | Dates | Focus | Hours |
|---|---|---|---|
| **W1** | Thu Aug 13 – Sun Aug 23 | Scaffold + all three spikes | ~12 |
| **W2** | Mon Aug 24 – Sun Aug 30 | **Demo path** + first Release APK | ~8 |
| **W3** | Mon Aug 31 – Sun Sep 6 | Invoice → PDF + QR → share sheet | ~7 |
| **W4** | Mon Sep 7 – Sun Sep 13 | Valuation + CSV export | ~7 |
| **W5** | Mon Sep 14 – Sun Sep 20 | Cut line, then freeze. Polish. | ~7 |
| **W6** | Mon Sep 21 – Sun Sep 27 | Landing, demo video, Release | ~7 |

---

## W1 · Thu Aug 13 – Sun Aug 23 — de-risk before building

Eleven days and two weekends, which is what makes three spikes fit *before* anything is
built on top of their answers. This is the only week that gets more than 8 hours, and
the extra goes to spikes rather than features.

**Spikes** (one weekend session each, ~3–4 h). Each ends in a written go/no-go in
`spikes/`. A spike that does not change what we do next was not a spike.

**S1 — Public-RPC backfill and rate limits.** *Ranked first: everything sits on top of
ingestion, and this is the risk that can invalidate the architecture rather than merely
cost a week.* Page `getSignaturesForAddress` over a real busy mainnet address across 2–3
public endpoints, persisting cursor state; kill the app mid-sync and resume; toggle
airplane mode. Measure: calls made, 429 rate, wall-clock to completion, whether resume
is exactly-once.
**Go/no-go:** if no public endpoint completes a representative address in a tolerable
window, v0.1 needs a user-supplied RPC URL (line 72 already permits it) or a capped
history depth. That is a scope decision, and it gets made in week 1.

**S2 — Reference-key detection.** End-to-end on devnet: transfer request → payment →
`findReference`. Then the case that actually matters (line 81) — a direct transfer that
ignores the QR, carries no reference, and is therefore *structurally invisible* to tier a.
The spike's job is to size that gap and produce fixtures for tier-b design, **not** to
build tier b (deferred, line 123).
**Go/no-go:** tier-a detection is reliable end-to-end, and a fixture set exists covering
exact payment, direct transfer, wrong amount, duplicate amounts in one window, and late
arrival.

**S3 — On-device PDF + QR quality.** Generate a real invoice PDF via `expo-print` with an
embedded Solana Pay URL and QR; scan it with **Phantom on a physical device** (line 132),
not a simulator. Bounded and fast to falsify.
**Go/no-go:** Phantom parses the QR into a correct transfer request — right mint, right
amount, right reference.

**Also this week:** monorepo scaffold, core package with tests and the purity guard,
Expo prebuild running on a physical Android device, op-sqlite + SQLCipher behind
`StoragePort`, telemetry off, **public repo live `[M2]`**.

**Exit:** three go/no-go calls written down; `npm test` green; the app launches on a real
phone.

---

## W2 · Mon Aug 24 – Sun Aug 30 — the demo path

The week everything else depends on. By Sunday: **add an address → make a devnet payment
→ the app detects and matches it → it appears in the ledger.**

Ports and domain types, the web3.js `RpcPort` adapter, the checkpointed backfill driver,
the transaction normalizer with dedup, the op log and projection with a tested
`rebuild()`, reference-key generation, the tier-a matcher, and a minimal two-screen UI
(add address, ledger list).

**Also:** first EAS build cut to a **GitHub Release APK `[M2]`**, even though it only
ingests and matches. The point is to prove the pipeline now.

**Exit:** the demo path runs end to end on a physical device, recorded as a screen
capture for the eventual demo video. Rebuild-equivalence test green (DECISIONS.md D4).

---

## W3 · Mon Aug 31 – Sun Sep 6 — invoicing

Invoice model and creation screen, PDF generation through `DocPort`, embedded Solana Pay
QR, native share sheet. This is scope item 2 and PROJECT.md line 122 marks it never-cut,
so it lands before valuation.

**Also:** landing page skeleton `[M2]` — deployed and thin, one paragraph and a
screenshot. Deployed early so DNS, hosting, and the deploy step are not discovered in
week 6.

**Exit:** create an invoice on the phone, share the PDF via WhatsApp, pay it from another
device, watch it match. That is the product's whole loop.

---

## W4 · Mon Sep 7 – Sun Sep 13 — valuation and export

NBG daily-rate fetch and local cache, valuation at receipt date storing source + rate +
rate date (line 86), and generic CSV export with the audit columns.

Stablecoin→USD is 1:1 (line 85); the leg that matters is USD→GEL. Non-stable mints throw
rather than guess — v0.1 values stablecoin income only, and a SOL payment should fail
loudly rather than be booked at an invented rate.

**Exit:** a month of devnet income exports to CSV with defensible rates attached.

---

## W5 · Mon Sep 14 – Sun Sep 20 — cut line, then freeze

**Mon–Wed: the cut line.** Whatever is unfinished gets cut from the bottom of
PROJECT.md line 117 — CSV export first, then valuation. Ingestion + reference matching
and invoice PDF + QR are never cut; they are the demo.

**Wed Sep 16: feature freeze.** Nothing new after this, including "small" things.

Thursday onward is polish on what exists: empty states, error copy, the backfill progress
UI, and the honest framing PROJECT.md line 62 insists on — "checks when you open, and
periodically in the background on Android", never a real-time promise.

---

## W6 · Mon Sep 21 – Sun Sep 27 — ship

Landing page content `[M2]`, demo video, signed release build, GitHub Release with the
APK and notes `[M2]`, README and repo tidy for grant review `[M2]`, and the final
build-in-public thread.

No new features. If something is broken, it gets fixed or cut — not extended.

**Exit:** a stranger can find the landing page, watch the video, download the APK from
the Release, install it, add an address, and see their own income.

---

## Cut list, standing

Applied bottom-up, from PROJECT.md line 117:

1. Ingestion + reference matching — **never cut**
2. Invoice PDF + QR — **never cut**
3. Valuation — cut second
4. CSV export — **cut first**
5. Heuristic matching (tier b) — already deferred
6. Categorization beyond minimal — already deferred

## Standing risks

- **RPC rate limits** eating more of W2 than planned. S1 exists to find this in W1; the
  fallback is a user-supplied endpoint or capped history depth.
- **The 6–8 h/week budget is optimistic** on any week with life in it. The reserve
  absorbs one bad week, not three.
- **Android build breakage** from op-sqlite + SQLCipher. Mitigated by pinning the Expo
  SDK for the whole window and by shipping the first APK in W2.
- **Scope drift into tier-b matching**, which will be tempting the moment S2 shows the
  direct-transfer gap. It is on the cut list. It stays there.
