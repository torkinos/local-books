# Local Books

[![CI](https://github.com/torkinos/local-books/actions/workflows/ci.yml/badge.svg)](https://github.com/torkinos/local-books/actions/workflows/ci.yml)

**Private income books for people paid in crypto — the spreadsheet replacement, not a
tax calculator.**

Local-first Android app for freelancers and contractors paid in stablecoins on Solana.
Create an invoice on your phone, share it as a PDF with an embedded Solana Pay QR, and
the app detects the payment on-chain, matches it to the invoice, values it in local
currency at the receipt date, and produces income reports your accountant accepts.

Three things it will never do:

- **Hold keys.** Watch-only forever — the app never signs or sends anything.
- **Talk to our servers.** There are none. No backend, no accounts, no telemetry of any
  kind. The app's only network traffic is Solana public RPC (or your own RPC endpoint)
  and the National Bank of Georgia's public daily-rate endpoint for valuation.
- **Promise real-time.** It checks when you open the app, and periodically in the
  background on Android.

## Status

v0.1 is under construction toward **Sep 27, 2026** (Superteam Agentic Engineering
grant). The pure-TypeScript domain core — ingestion, normalization, matching,
projection, valuation, reporting — is built and tested; the Expo shell is next. See
[PLAN.md](./PLAN.md) for the week-by-week plan and [TASKS.md](./TASKS.md) for live
task status.

## Build

Requires Node 20+.

```sh
npm install
npm run check   # typecheck + lint + tests
```

The repo is an npm-workspaces monorepo:

- `packages/core` — the entire domain, pure TypeScript, zero runtime dependencies.
  An ESLint guard fails the build if anything platform-shaped (React Native, Expo,
  SQLite, web3.js, Node builtins, ambient clock/randomness) is imported here.
- `apps/mobile` — the Expo (React Native) shell over core. Android first.
- `spikes/` — de-risking spikes with written go/no-go verdicts.

## Documents

- [PROJECT.md](./PROJECT.md) — what this is, for whom, architecture, scope.
- [PLAN.md](./PLAN.md) — the plan to v0.1.
- [TASKS.md](./TASKS.md) — agent-executable tasks with acceptance criteria.
- [DECISIONS.md](./DECISIONS.md) — every non-obvious technical decision, recorded when
  made.

## License

MIT
