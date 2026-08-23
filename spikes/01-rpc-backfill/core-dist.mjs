/**
 * Single import point for the compiled core used by the spike harness.
 *
 * Build first (from repo root):
 *   npx tsc -p packages/core --outDir spikes/01-rpc-backfill/.build --noEmit false --declaration false --sourceMap false
 *
 * The spike deliberately runs the REAL backfill driver from packages/core -- the point
 * is to measure how production pacing/checkpoint logic behaves against live public
 * endpoints, not a reimplementation of it.
 */
export { backfillAddress, syncNewSignatures, DEFAULT_BACKFILL_OPTIONS } from './.build/src/ingest/backfill.js';
export { RateLimitedError } from './.build/src/ports/index.js';
