# S3 — Spike: PDF + QR quality

**Date:** 2026-09-15 · **Verdict: GO**, with one acceptance deviation (Solflare, not
Phantom — Finding 0) and one device-only bug found and fixed on the spot (Finding 1).

> Written up 2026-09-22 from the device-session record in `TASKS.md` (S2, T19, T20).
> The run itself was 2026-09-15; this file was the one M1 artifact never written at the
> time, and the delay is the reason it reads as a reconstruction rather than a log.

**Question:** does an invoice PDF rendered on the phone by `expo-print` carry a Solana
Pay QR that a real wallet parses into a transfer request with the correct mint, amount
and reference — and does the page survive real content (long base58 strings, multi-line
invoices) without clipping?

Run in the same physical-device session as S2 (`spikes/02-reference-detection.md`),
which is why the two share a screen recording. That session closed S2, S3, T6, T15,
T16, T19, T20, T22, T25, T26, T28 and T29 on the device side.

## Finding 0 — Phantom could not run this test; Solflare did

The acceptance line named **Phantom on a physical device**. Phantom's Testnet Mode never
showed the devnet funds, so it could not pay a devnet transfer request at all — the same
wall S2 hit, which is why `spikes/02-reference-detection.md` already tells you to use
Solflare. **Solflare scanned the QR out of the shared PDF and prefilled mint, amount and
recipient correctly.**

What this proves: the QR payload is spec-shaped and a major wallet parses it into the
right transfer request. What it does not prove: anything about Phantom specifically, or
about mainnet, neither of which was run. Treat "Phantom scans it" as **untested**, not
as passed.

## Finding 1 — dynamic `import()` broke Share PDF on-device, away from Metro

The first **Share PDF** tap on the phone failed with `cannot read property 'reload' of
undefined`. Cause: `DocPort` dynamically `import()`ed the Expo modules inside its two
methods — deliberately, so the whole HTML path could be tested under plain Node — and
Metro served `expo-print` as a **split bundle fetched at tap time**. Expo's loader broke
without a live Metro connection, which is exactly the condition a release build runs in.

Fixed the same day: static imports, with the pure HTML renderer moved to
`apps/mobile/src/doc/invoicePdfHtml.ts` so the Node-side tests keep running against it.
Recorded as an amendment to D17.

This is the finding that justified the spike. It was invisible to every test that can run
in a sandbox, and it would have shipped as a release-build-only crash on the app's single
most important button.

## Finding 2 — layout held; the guards were already in the renderer

No layout, font or page-break problem surfaced on device. `invoicePdfHtml.ts` (built in
T19) already carried the guards this spike existed to find:

- long base58 strings **wrap** rather than overflow the page
- invoice rows **stay whole** across page breaks
- **zero external resources** — no web fonts, no remote CSS, no network at print time
  (D5), so the PDF renders identically offline
- every model string is escaped, pinned field-by-field in the tests

The QR is generated locally as an SVG by `qrcode` (pure JS) and inlined into the
document, so it carries no network dependency either.

## Artifacts

The generated PDF is **not checked into this repo**: it was produced on-device and shared
through the native sheet, and the run is visible in the T16/T22 screen recording that
became the demo video. The share sheet was exercised once — sharing to WhatsApp *and*
email was skipped deliberately, any one target being enough.

The pieces the PDF is assembled from are pinned by tests that do run in CI: the transfer
request URL builder in `packages/core/src/pay/`, and the HTML renderer in
`apps/mobile/test/invoiceHtml.test.ts`.
