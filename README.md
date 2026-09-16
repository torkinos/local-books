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
- **Promise real-time.** It checks when you open the app and while it is open — pull
  to refresh any time. Background sync while the app is closed is on the post-grant
  list.

## Status

**v0.1.0 is out.** [Download the APK](https://github.com/torkinos/local-books/releases/latest)
(Android, ~89 MB, signed), watch the [walkthrough](TODO_VIDEO_URL), or read
the [release notes](./docs/releases/v0.1.0.md) — they name what v0.1 does *not* do as
plainly as what it does. The landing page is
[torkinos.github.io/local-books](https://torkinos.github.io/local-books/).

Built in public for the Superteam Agentic Engineering grant: feature freeze Sep 16 2026,
v0.1 cut by Sep 27. The whole loop runs on one phone — watch an address, invoice a
client, share the PDF, the payment matches itself by reference, and the income statement
exports as CSV with the rate, its source and its date on every row. Deferred on purpose:
heuristic matching for plain transfers, background sync while the app is closed, tokens
beyond USDC and USDT, iOS. [PLAN.md](./PLAN.md) has the week-by-week plan,
[TASKS.md](./TASKS.md) the live task status, and [DECISIONS.md](./DECISIONS.md) every
non-obvious call with its cost.

## Build

Requires Node 24 (pinned in `.nvmrc`; the mobile test suite uses `node:sqlite`).

```sh
npm install
npm run check   # typecheck + lint + tests
```

The app is built for **mainnet** by default. For the devnet demo path, put
`EXPO_PUBLIC_NETWORK=devnet` in `apps/mobile/.env.development` (debug builds only;
a release build never reads it). A personal RPC endpoint goes in `apps/mobile/.env`
and applies to every build — including the APK, in plain text, so never share an APK
built with a keyed URL. `apps/mobile/.env.example` walks through both
(DECISIONS.md D18).

### Dev build on a device (Android)

You need a JDK 17, the Android SDK (the SDK component of Android Studio is enough) with
`ANDROID_HOME` exported, and a phone with USB debugging on — or an emulator. The
`android/` folder is generated, not committed:

```sh
cd apps/mobile
npm run android   # prebuilds android/, builds the dev client, installs it, starts Metro
```

After that first run, `npm start` alone starts Metro against the installed dev client.
Re-run `npx expo prebuild --platform android --clean` after any change to `app.json` or
to a native dependency; prebuild is reproducible, so throwing `android/` away is always
safe.

### Release build (Android)

Release builds are signed with a keystore that lives on the build machine, wired in
by `apps/mobile/plugins/withReleaseSigning.js` at prebuild time. Once, on that machine:

```sh
mkdir -p ~/.local-books
keytool -genkeypair -v -keystore ~/.local-books/release.keystore -alias localbooks \
  -keyalg RSA -keysize 2048 -validity 10000
cat >> ~/.gradle/gradle.properties <<'EOF'
LOCAL_BOOKS_RELEASE_STORE_FILE=/Users/YOU/.local-books/release.keystore
LOCAL_BOOKS_RELEASE_STORE_PASSWORD=the-store-password
LOCAL_BOOKS_RELEASE_KEY_ALIAS=localbooks
LOCAL_BOOKS_RELEASE_KEY_PASSWORD=the-key-password
EOF
```

Back the keystore up somewhere that is not this laptop: every future release must be
signed with it or Android refuses to update the installed app. Then, per release:

```sh
cd apps/mobile
grep -q EXPO_PUBLIC_RPC_URL .env 2>/dev/null && echo "REMOVE the keyed RPC URL from .env first"
npx expo prebuild --platform android --clean # regenerates android/ with the plugin
cd android && ./gradlew assembleRelease      # -> app/build/outputs/apk/release/app-release.apk
```

The build log prints which keystore signed it. Without the four properties the build
produces `app-release-unsigned.apk`, which cannot be installed, rather than a
debug-signed file that could never be updated in place. The release build reads
`.env`, never `.env.development`, so it is mainnet by construction; a devnet value in
`.env.local` or exported in the shell would reach it, so keep both clean too.

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

## Not affiliated

Local Books is an independent personal project. It is not affiliated with, endorsed by,
or sponsored by any employer of its authors, by the issuers of the tokens it supports
(USDC, USDT), or by the National Bank of Georgia, whose published daily rates it reads
through a public endpoint. Those names are used descriptively, to say what the app
reads.

## License

MIT
