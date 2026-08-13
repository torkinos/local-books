# Local Books

**Private income books for people paid in crypto — the spreadsheet replacement, not a tax calculator.**

Local-first mobile app for freelancers and contractors paid in stablecoins on Solana. Create an invoice on your phone, share it as a PDF with an embedded Solana Pay QR, and the app detects the payment on-chain, matches it to the invoice, values it in local currency at receipt date, and produces income reports your accountant accepts. Watch-only, non-custodial, no backend — Solana itself is the only infrastructure.

---

## Context

- **Team:** solo engineer (React Native / TypeScript / Electron; production experience with client-side cryptography and P2P/local-first systems on the Pear/Bare stack) + co-founder (business finance & project management: report templates, tax logic, pilot recruitment, milestone reporting).
- **Funding path:** Superteam Agentic Engineering grant (v0.1, this repo) → Solana Foundation instagrant application via Superteam Georgia (full MVP) → larger ecosystem funding later.
- **Build mode:** part-time (~6–8 h/week), AI-assisted (agentic engineering), built in public.
- **v0.1 target date: Sunday, September 27, 2026.** (Moved from Sep 13; see DECISIONS.md D0.)

## Problem

Freelancers and contractors paid in stablecoins track income in spreadsheets and block explorers. Matching invoices to on-chain payments is manual, valuing income in local fiat at the receipt date is manual, and producing reports an accountant will accept is painful.

Existing tools don't serve this user:

- **Crypto tax apps** (Koinly, Awaken, CoinLedger) target traders' capital gains, not income books.
- **Cloud invoicing suites** (Request Finance and similar) target company finance teams, hold your data, and require accounts and servers.
- **Local-first trackers** (Rotki) are desktop portfolio tools — no invoicing, no income workflow, no mobile.

The real incumbent is a spreadsheet plus a block explorer.

## Core loop

1. Create an invoice locally: client, line items, token (USDC/USDT), amount, due date.
2. Share a PDF with an embedded Solana Pay transfer-request QR/URL (native share sheet: email, WhatsApp, Telegram).
3. The app detects the payment on-chain via a unique reference key per invoice and matches it automatically.
4. Payment is valued in local fiat at receipt date (official daily rate, cached, with source + timestamp stored).
5. Monthly income reports and CSV exports, generated on-device.

## Target users (priority order)

1. **Freelancers/contractors paid in USDC/USDT on Solana** — emerging markets; beachhead: Georgia (individual-entrepreneur regime requires GEL-denominated turnover tracking).
2. **Small crypto teams/DAOs** producing monthly spend reports (v2).
3. **Accountants with crypto-paid clients** (later; the future desktop read-only surface).

## Non-goals (enforced — scope must not drift here)

- **No key management, signing, or sending. Watch-only forever.** The app never holds private keys.
- **No backend of any kind.** No server, no accounts, no hosted API. Chain + public RPC + (later) P2P between the user's own devices only.
- **No capital-gains / cost-basis engine.** Koinly/Awaken territory; we export CSV for interop instead.
- **No portfolio tracking.** Rotki owns local-first desktop tracking; mobile-first income books is our lane.
- **No multi-chain in v1.** Solana only; architecture should not preclude it later.
- **No telemetry in the product, of any kind, opt-in or otherwise.**

## Success metrics

- **Primary KPI:** GitHub Release download count — externally verifiable, zero instrumentation, consistent with local-first.
- **Secondary:** pilot cohort of 5–10 crypto-paid freelancers (recruited by co-founder) using v0.1 and providing written feedback — usage evidence collected by humans, not instrumentation.
- **Considered and rejected:** making invoice reference keys derivable/taggable as an on-chain usage counter. Linkable references would let anyone identify Local Books invoices on-chain and deanonymize users' income addresses — breaks the product's core privacy promise. Recorded here deliberately; the rejection reasoning is part of the design.

## Platform strategy

- **Mobile-first: React Native (Expo + prebuild/dev client).** Android is the primary target (better background execution, Solana dApp Store distribution later, dominant in the beachhead market). iOS follows with known limitations.
- **Desktop later** (post-grant), sharing the same core, as the accountant-facing read-only surface.
- **Architecture consequence:** all domain logic (ingestion, normalization, matching, valuation, event log, report generation) lives in a **pure-TypeScript core package with zero UI/platform dependencies**. The RN app is a shell over it; the future desktop app reuses it unchanged.
- **Accepted mobile constraint:** serverless means no push notifications (APNs/FCM require a sender). Payment detection is on-app-open plus best-effort background: Android WorkManager periodic sync (near-real-time feasible), iOS BGAppRefreshTask (opportunistic only). In-app framing: "checks when you open, and periodically in the background on Android" — never promise real-time.

## Architecture

### 1. Chain ingestion (watch-only)

- User adds Solana address(es); track associated token accounts (ATAs) for USDC/USDT and other SPL mints.
- Backfill: `getSignaturesForAddress` (paginated) → `getTransaction` (jsonParsed). Extract SOL system transfers, SPL token transfers (pre/post token balances), memo contents, blockTime, counterparty, signature.
- Incremental: refresh on app open + background job (see platform constraints). No WebSocket dependency.
- Backfill must be **resumable/checkpointed** (app can be killed mid-sync) and mindful of metered connections (chunked; wifi-preferred option).
- RPC strategy: rotation/failover across public endpoints; power users can paste their own endpoint (e.g. Helius). No backend of ours anywhere.
- Normalize into an append-only ledger-event log; idempotent; dedup by signature.

### 2. Invoicing + payment matching

- Invoices created and stored locally: client, line items, token, amount, due date.
- Each invoice gets a **unique reference public key** (Solana Pay transfer-request convention: reference attached as a non-signer account). PDF generated on-device (expo-print or equivalent) with embedded Solana Pay URL + QR; shared via native share sheet.
- Matching engine, two tiers:
  - **a) Exact:** scan incoming transactions for the reference key (`findReference` pattern) → auto-match, high confidence.
  - **b) Heuristic:** for clients who pay by direct transfer and ignore the QR — match on (amount ± tolerance, time window, known counterparty address) → propose match, require one-tap human confirmation. **Never auto-confirm heuristic matches.**

### 3. Valuation

- Income valued in local fiat at receipt date. Stablecoin→USD treated ~1:1; the leg that matters is USD→local currency via the official daily rate (Georgia: National Bank of Georgia publishes free official rates — what tax filings actually use). SOL/volatile tokens via a public price API.
- All rates fetched and cached locally. **Every valuation stores source, rate, and timestamp — auditability over convenience.**

### 4. Storage

- Event-sourced core: user actions (invoice created, match confirmed, category assigned) are operations in an append-only local op log. Chain-derived data is **not** part of the op log — it is re-derivable from RPC; only human decisions are source-of-truth.
- Materialized view: operations fold into local SQLite (op-sqlite or expo-sqlite — decision recorded in DECISIONS.md), which serves all queries and reports. SQLite is a disposable index; the op log is the source of truth.
- **v0.1 ships single-device.** The op-log abstraction exists from day one; replication (device pairing, accountant read-only key, desktop) is post-grant, designed for Autobase/Hyperswarm over the Bare runtime.
- Encrypted at rest.

### 5. Local AI layer — deferred, strictly optional

- Post-grant candidates: on-device receipt OCR (capture → merchant/date/amount → expense entry) and natural-language queries (local LLM translates a question into a validated structured query; the deterministic engine executes it; the model never does arithmetic).
- v0.1 includes at most **receipt photo attachment without OCR** (cheap, useful, upgradeable).
- AI must always be cuttable without the product failing.

### 6. Reports (co-founder owns the templates)

- Monthly income statement, per-client totals, Georgian individual-entrepreneur turnover report (GEL-denominated) — PDFs generated on-device, shared via share sheet.
- Generic CSV export + Koinly-compatible CSV for users who also file capital gains elsewhere.

## v0.1 scope (grant deliverable — Sep 27, 2026)

**In:**

1. Watch-only Solana address tracking with resumable backfill
2. Invoice creation → PDF with Solana Pay QR → share sheet
3. Automatic reference-key payment matching (tier a)
4. Local-currency valuation at receipt date (NBG daily rates)
5. CSV export (generic)
6. Installable Android build (GitHub Release APK), public repo, landing page, demo video

**Priority order for cuts if time runs short** (cut from the bottom):

1. Ingestion + reference matching (never cut — this is the demo)
2. Invoice PDF + QR (never cut)
3. Valuation
4. CSV export
5. Heuristic matching tier (b) — first to defer
6. Categorization UX beyond minimal — second to defer

**Deferred post-grant:** heuristic-matching polish, iOS hardening, P2P multi-device sync, desktop/accountant surface, OCR, NL queries, DAO/multisig ingestion, token-2022 edge cases, Koinly-compatible CSV, Solana dApp Store submission, monthly report PDFs beyond the basic income statement.

## Known risks (de-risk in week 1)

1. **Public-RPC rate limits** for full-history backfill from a phone — spike: backfill a real, busy address on 2–3 public endpoints; measure throttling; validate checkpoint/resume.
2. **Reference-key detection reliability** — spike: end-to-end devnet test of Solana Pay transfer request → payment → `findReference`, plus a direct transfer that ignores the QR (feeds tier-b design).
3. **On-device PDF + QR quality in Expo** — spike: generate a real invoice PDF with a scannable QR; verify with Phantom on a physical device.

## Repo conventions

- `PLAN.md` — week-by-week plan to the target date.
- `TASKS.md` — agent-executable tasks (≤ half a day each, with acceptance criteria); M2 grant deliverables flagged.
- `DECISIONS.md` — every non-obvious technical decision, recorded when made.
- Build in public: weekly progress thread; each week's post links the commits.
