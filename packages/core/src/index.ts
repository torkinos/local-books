/**
 * @local-books/core -- the entire domain of Local Books, with no idea it is on a phone.
 *
 * The RN app is a shell over this (PROJECT.md line 61) and the post-grant desktop
 * surface reuses it unchanged. Nothing here imports React, React Native, Expo, SQLite,
 * web3.js, or a Node builtin; the ESLint config in this package enforces that.
 */

export * from './types/index.js';
export * from './ports/index.js';

export {
  backfillAddress,
  syncNewSignatures,
  backoffMs,
  DEFAULT_BACKFILL_OPTIONS,
} from './ingest/backfill.js';
export type { BackfillOptions, BackfillProgress } from './ingest/backfill.js';

export {
  dedupEvents,
  mergeEvents,
  eventKey,
  sortByRecency,
  missingSignatures,
} from './normalize/index.js';

export { sortOps, dedupOps, makeOpId, stableStringify, opsAsOf } from './oplog/index.js';

export { matchByReference, amountAgreement } from './match/index.js';
export type { MatchCandidate, MatchTier, HeuristicMatchInput, HeuristicMatcher } from './match/index.js';

export { project, withOverdue } from './projection/index.js';
export type {
  ProjectionState,
  InvoiceView,
  InvoiceStatus,
  PaymentRef,
  WatchedAddressView,
} from './projection/index.js';

export {
  valueAtReceipt,
  isStable,
  formatUnits,
  parseUnits,
  multiplyDecimals,
  STABLE_MINTS,
  UnsupportedValuationError,
} from './value/index.js';

export { buildIncomeStatement, toCsv, csvEscape, isoDate, CSV_COLUMNS } from './report/index.js';
export type { IncomeStatement, IncomeRow } from './report/index.js';
