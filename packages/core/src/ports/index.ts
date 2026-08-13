/**
 * Ports: everything core needs from the outside world, as interfaces.
 *
 * Core depends only on these. apps/mobile supplies the adapters (web3.js, op-sqlite,
 * expo-print, the NBG rate endpoint); tests supply fakes. This is what lets the whole
 * domain suite run in a plain Node process in seconds with no native modules, and what
 * makes the post-grant desktop surface (PROJECT.md line 60) a re-implementation of a
 * handful of small interfaces rather than a rewrite.
 *
 * Seams for deferred work live at the bottom of this file as types only -- no
 * implementations, no dependencies, no dead code paths. PROJECT.md's non-goals are
 * scope boundaries, and a stub that "just needs wiring" is how scope drifts.
 */
import type {
  Address,
  ChainEvent,
  FiatCode,
  Op,
  ReferenceKey,
  Signature,
  UnixSeconds,
  Valuation,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// RpcPort -- the only network surface for chain data
// ---------------------------------------------------------------------------

export interface SignaturePage {
  readonly signatures: readonly SignatureInfo[];
  /**
   * Cursor for the next (older) page: the last signature of this page. `null` when
   * history is exhausted. Solana pages backwards via `before`.
   */
  readonly nextBefore: Signature | null;
}

export interface SignatureInfo {
  readonly signature: Signature;
  readonly slot: number;
  readonly blockTime: UnixSeconds | null;
  readonly err: boolean;
}

/**
 * Raw transaction as returned by `getTransaction` with `jsonParsed`.
 *
 * Deliberately `unknown`-shaped: core's normalizer owns the parsing, and pinning a
 * structural type here would couple core to a web3.js version. The adapter hands over
 * whatever the RPC said; normalize/ turns it into ChainEvents and is the one place
 * that knows the wire format.
 */
export interface RawTransaction {
  readonly signature: Signature;
  readonly slot: number;
  readonly blockTime: UnixSeconds | null;
  readonly raw: unknown;
}

export interface RpcPort {
  /**
   * One page of signatures for an address, newest first.
   *
   * `before` continues an existing backfill; omit it to start from the tip. The
   * adapter must surface rate limiting as a `RateLimitedError` rather than retrying
   * silently -- the backfill driver owns pacing so it can checkpoint between pages
   * (Spike 1, PROJECT.md line 130).
   */
  getSignatures(
    address: Address,
    opts: { readonly before?: Signature; readonly limit: number },
  ): Promise<SignaturePage>;

  /** Fetch full transactions. Batched because per-signature round-trips dominate backfill. */
  getTransactions(signatures: readonly Signature[]): Promise<readonly RawTransaction[]>;

  /** Identifies the endpoint in spike measurements and failover logs. */
  readonly endpointLabel: string;
}

/** Thrown by RpcPort adapters on 429 / server-side throttling. */
export class RateLimitedError extends Error {
  constructor(
    readonly endpointLabel: string,
    /** Server-advised wait in ms, when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(`RPC rate limited: ${endpointLabel}`);
    this.name = 'RateLimitedError';
  }
}

// ---------------------------------------------------------------------------
// StoragePort -- persistence, no SQL dialect in core
// ---------------------------------------------------------------------------

/**
 * Persistence, split by the source-of-truth boundary.
 *
 * `appendOps`/`readOps` touch the durable op log. Everything under `projection` is the
 * disposable SQLite index (PROJECT.md line 91) and may be dropped and rebuilt at will
 * -- `rebuild()` in projection/ depends on that being true.
 */
export interface StoragePort {
  appendOps(ops: readonly Op[]): Promise<void>;
  readOps(): Promise<readonly Op[]>;

  putChainEvents(events: readonly ChainEvent[]): Promise<void>;
  getChainEvents(address: Address): Promise<readonly ChainEvent[]>;

  /** Backfill checkpoints, keyed by address. Survives process death mid-sync. */
  getCheckpoint(address: Address): Promise<BackfillCheckpoint | null>;
  putCheckpoint(checkpoint: BackfillCheckpoint): Promise<void>;

  /** Drop every projection table. The op log must NOT be touched. */
  clearProjection(): Promise<void>;
}

/**
 * Resume state for a paged backfill (PROJECT.md line 71).
 *
 * Holds two cursors because backfill runs in both directions: `oldestSeen` walks
 * history backwards and is the resume point for an interrupted initial sync;
 * `newestSeen` is where incremental refresh stops so app-open sync does not re-walk
 * history it already has.
 */
export interface BackfillCheckpoint {
  readonly address: Address;
  /** `before` cursor for the next older page. `null` before the first page lands. */
  readonly oldestSeen: Signature | null;
  /** Newest signature ever ingested. Incremental sync stops when it reaches this. */
  readonly newestSeen: Signature | null;
  /** True once history has been walked to genesis; initial backfill never repeats. */
  readonly complete: boolean;
  readonly updatedAt: UnixSeconds;
}

// ---------------------------------------------------------------------------
// ClockPort
// ---------------------------------------------------------------------------

/** Injected time. Makes match windows and report ranges deterministic under test. */
export interface ClockPort {
  now(): UnixSeconds;
}

// ---------------------------------------------------------------------------
// RatePort -- valuation inputs
// ---------------------------------------------------------------------------

export interface RateQuote {
  readonly rate: string;
  readonly source: string;
  readonly rateDate: UnixSeconds;
  readonly fetchedAt: UnixSeconds;
}

export interface RatePort {
  /**
   * Official daily rate for `fiat` per 1 USD on `date`.
   *
   * "On `date`" is load-bearing: tax filings use the rate published for the receipt
   * date, not today's. Adapters cache locally and must return the rate actually
   * effective on that date, or throw -- silently substituting a nearby day would
   * quietly corrupt a filing.
   */
  getUsdRate(fiat: FiatCode, date: UnixSeconds): Promise<RateQuote>;
}

// ---------------------------------------------------------------------------
// DocPort -- rendering lives outside core
// ---------------------------------------------------------------------------

/**
 * Core produces report and invoice *models*; the app renders them.
 *
 * Keeping expo-print behind this line is what lets the desktop surface render the same
 * invoice with a different engine, and lets report logic be unit-tested without a PDF
 * renderer anywhere in the process.
 */
export interface DocPort {
  renderPdf(doc: RenderableDoc): Promise<{ readonly uri: string }>;
  share(uri: string, opts?: { readonly mimeType?: string }): Promise<void>;
}

export interface RenderableDoc {
  readonly title: string;
  readonly kind: 'invoice' | 'income-statement';
  /** Serializable model. The renderer owns layout; core owns content. */
  readonly model: unknown;
  /** Solana Pay URL to encode as a QR, for invoices. */
  readonly qrPayload?: string;
}

// ---------------------------------------------------------------------------
// Reference key generation
// ---------------------------------------------------------------------------

/**
 * Mints the unique reference public key per invoice (PROJECT.md line 78).
 *
 * A port rather than a core function because it needs a real keypair generator, and
 * because injecting it keeps invoice tests reproducible.
 *
 * References MUST be unpredictable and unlinkable. PROJECT.md line 55 records the
 * rejection of derivable/taggable references: anything that lets an outsider recognise
 * a Local Books invoice on-chain deanonymises the user's income address. Do not
 * "improve" this into a deterministic derivation.
 */
export interface ReferenceKeyPort {
  generate(): Promise<ReferenceKey>;
}

// ---------------------------------------------------------------------------
// Deferred seams -- shapes only (PROJECT.md lines 92, 95-99)
// ---------------------------------------------------------------------------

/**
 * Multi-device replication. Post-grant, over Autobase/Hyperswarm on Bare.
 *
 * Present so the op log is written against a replication-shaped interface from day
 * one; v0.1 ships single-device and nothing implements this.
 */
export interface ReplicationPort {
  readonly __deferred: 'post-grant: P2P sync between the user own devices';
}

/** On-device receipt OCR. v0.1 attaches receipt photos without reading them (line 98). */
export interface OcrPort {
  readonly __deferred: 'post-grant: capture -> merchant/date/amount';
}

/**
 * Natural-language query. The model would translate a question into a validated
 * structured query that the deterministic engine executes -- the model never does
 * arithmetic (line 97).
 */
export interface NlQueryPort {
  readonly __deferred: 'post-grant: NL -> validated structured query';
}

/** Every port the app must supply for core to run. */
export interface CorePorts {
  readonly rpc: RpcPort;
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly rates: RatePort;
  readonly docs: DocPort;
  readonly referenceKeys: ReferenceKeyPort;
}

export type { Valuation };
