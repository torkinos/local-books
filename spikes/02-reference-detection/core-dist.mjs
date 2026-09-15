/**
 * Single import point for the compiled core used by the S2 scripts.
 *
 * Build first (from repo root):
 *   npx tsc -p packages/core --outDir spikes/02-reference-detection/.build --noEmit false --declaration false --sourceMap false
 *
 * Same stance as S1: the spike runs the REAL normalizer and matcher from
 * packages/core, unmodified, so what it reports is what the app will do.
 */
export { normalizeTransactions } from './.build/src/normalize/index.js';
export { matchByReference, amountAgreement } from './.build/src/match/index.js';
export { asAddress, asReferenceKey, asSignature, asUnixSeconds } from './.build/src/types/index.js';
