/**
 * Canonical domain vocabulary for Local Books.
 *
 * Two families of data live here and the boundary between them is the single most
 * important rule in the codebase (PROJECT.md line 90):
 *
 *   - ChainEvent  -- derived from the chain. NOT source of truth. Re-derivable from
 *                    RPC at any time, so it never enters the op log and is safe to
 *                    delete and rebuild.
 *   - Op          -- a human decision. Source of truth. Append-only, never rewritten.
 *
 * If chain data ever leaks into the op log, the op log stops being a compact record of
 * intent and becomes an unbounded mirror of the chain -- which breaks the eventual
 * P2P replication story (line 92) before it is written.
 */

/** Base58-encoded Solana address. Branded so a mint cannot be passed as an owner. */
export type Address = string & { readonly __brand: 'Address' };

/** Base58-encoded transaction signature. Unique per transaction; our dedup key. */
export type Signature = string & { readonly __brand: 'Signature' };

/** Base58 public key minted per invoice and attached as a non-signer account. */
export type ReferenceKey = string & { readonly __brand: 'ReferenceKey' };

/** Unix seconds. Solana `blockTime` is seconds, not milliseconds -- do not mix. */
export type UnixSeconds = number & { readonly __brand: 'UnixSeconds' };

/** ISO-4217 code, e.g. 'GEL', 'USD'. */
export type FiatCode = string & { readonly __brand: 'FiatCode' };

export const asAddress = (v: string): Address => v as Address;
export const asSignature = (v: string): Signature => v as Signature;
export const asReferenceKey = (v: string): ReferenceKey => v as ReferenceKey;
export const asUnixSeconds = (v: number): UnixSeconds => v as UnixSeconds;
export const asFiatCode = (v: string): FiatCode => v as FiatCode;

/**
 * A token amount in its smallest indivisible unit, with the decimals needed to render
 * it. Held as bigint because USDC has 6 decimals and SOL has 9: float arithmetic on
 * money is how books stop balancing. Never converted to `number` for arithmetic.
 */
export interface TokenAmount {
  /** Smallest unit (lamports for SOL, micro-units for a 6-decimal USDC). */
  readonly raw: bigint;
  readonly decimals: number;
  /** Mint address; `null` denotes native SOL, which has no mint account. */
  readonly mint: Address | null;
  /** Display symbol when known. Never used for identity -- the mint is identity. */
  readonly symbol?: string;
}

// ---------------------------------------------------------------------------
// Chain-derived (re-derivable; never in the op log)
// ---------------------------------------------------------------------------

export type ChainEventKind = 'sol-transfer' | 'spl-transfer';

/**
 * One normalized value movement touching a watched address.
 *
 * A single transaction can produce several of these (a batch payout hits many
 * recipients), so identity is `signature` plus `instructionIndex`, not `signature`
 * alone. Dedup collapses on that pair -- see normalize/dedup.ts.
 */
export interface ChainEvent {
  readonly kind: ChainEventKind;
  readonly signature: Signature;
  /** Position within the transaction. Disambiguates multi-transfer transactions. */
  readonly instructionIndex: number;
  readonly slot: number;
  /** Absent on very old transactions whose blockTime the RPC no longer serves. */
  readonly blockTime: UnixSeconds | null;
  /** The watched address this event was ingested for. */
  readonly watchedAddress: Address;
  /** Counterparty: sender when incoming, recipient when outgoing. */
  readonly counterparty: Address | null;
  readonly direction: 'in' | 'out';
  readonly amount: TokenAmount;
  /** Memo program contents, when the transaction carried one. */
  readonly memo: string | null;
  /**
   * Non-signer reference accounts found on the transfer instruction. Solana Pay
   * attaches the invoice reference here; tier-a matching reads exactly this.
   */
  readonly references: readonly ReferenceKey[];
  /** False when the transaction landed but its instruction failed. */
  readonly succeeded: boolean;
}

// ---------------------------------------------------------------------------
// Human decisions (the op log; source of truth)
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  /** Unit price in the invoice's token, smallest unit. */
  readonly unitAmount: bigint;
}

export interface OpBase {
  /** Content-addressed id; stable across devices so replication can dedup later. */
  readonly id: string;
  /** When the human acted. Supplied by the caller via ClockPort, never read ambiently. */
  readonly at: UnixSeconds;
}

export interface InvoiceCreatedOp extends OpBase {
  readonly type: 'invoice-created';
  readonly invoiceId: string;
  readonly clientName: string;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly total: TokenAmount;
  readonly dueDate: UnixSeconds;
  /** Minted at creation; the join key for tier-a matching. */
  readonly reference: ReferenceKey;
  /** Address the invoice asks to be paid to. */
  readonly payTo: Address;
}

export interface MatchConfirmedOp extends OpBase {
  readonly type: 'match-confirmed';
  readonly invoiceId: string;
  readonly signature: Signature;
  readonly instructionIndex: number;
  /**
   * How the match was reached. Recorded because PROJECT.md line 81 forbids
   * auto-confirming heuristic matches -- an auditor must be able to see which matches
   * a human actually approved.
   */
  readonly via: 'reference' | 'heuristic-confirmed-by-user';
}

export interface MatchRejectedOp extends OpBase {
  readonly type: 'match-rejected';
  readonly invoiceId: string;
  readonly signature: Signature;
  readonly instructionIndex: number;
}

export interface AddressWatchedOp extends OpBase {
  readonly type: 'address-watched';
  readonly address: Address;
  readonly label: string;
}

export interface AddressUnwatchedOp extends OpBase {
  readonly type: 'address-unwatched';
  readonly address: Address;
}

export interface CategoryAssignedOp extends OpBase {
  readonly type: 'category-assigned';
  readonly signature: Signature;
  readonly instructionIndex: number;
  readonly category: string;
}

export type Op =
  | InvoiceCreatedOp
  | MatchConfirmedOp
  | MatchRejectedOp
  | AddressWatchedOp
  | AddressUnwatchedOp
  | CategoryAssignedOp;

export type OpType = Op['type'];

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * A fiat valuation of a chain event.
 *
 * PROJECT.md line 86 demands auditability over convenience: every valuation stores its
 * source, rate, and timestamp, so a filing can be defended years later. All three
 * fields are required -- there is deliberately no way to record a rate without saying
 * where it came from.
 */
export interface Valuation {
  readonly fiat: FiatCode;
  /** Units of `fiat` per 1 whole token, as a decimal string to avoid float drift. */
  readonly rate: string;
  /** Valued amount in `fiat`, decimal string, already rate-applied. */
  readonly fiatAmount: string;
  /** e.g. 'nbg.gov.ge/official-rates'. Free-form but never empty. */
  readonly source: string;
  /** The rate's own effective date, which is not when we fetched it. */
  readonly rateDate: UnixSeconds;
  readonly fetchedAt: UnixSeconds;
}
