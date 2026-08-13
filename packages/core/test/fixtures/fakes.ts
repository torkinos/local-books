/**
 * In-memory port fakes.
 *
 * Every one of these exists so the domain suite runs in a plain Node process with no
 * native modules, no network, and no wall-clock -- which is the practical payoff of the
 * ports design and the reason the test loop stays in seconds.
 */
import type {
  BackfillCheckpoint,
  ClockPort,
  RpcPort,
  SignatureInfo,
  SignaturePage,
  StoragePort,
  RawTransaction,
} from '../../src/ports/index.js';
import { RateLimitedError } from '../../src/ports/index.js';
import type {
  Address,
  ChainEvent,
  Op,
  Signature,
  TokenAmount,
  UnixSeconds,
} from '../../src/types/index.js';
import { asAddress, asSignature, asUnixSeconds } from '../../src/types/index.js';

export const USDC_MINT = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export function usdc(whole: string): TokenAmount {
  const [w = '0', f = ''] = whole.split('.');
  return {
    raw: BigInt(`${w}${f.padEnd(6, '0').slice(0, 6)}`),
    decimals: 6,
    mint: USDC_MINT,
    symbol: 'USDC',
  };
}

export function sig(n: number): Signature {
  return asSignature(`sig${String(n).padStart(4, '0')}`);
}

export function fixedClock(at = 1_700_000_000): ClockPort {
  return { now: () => asUnixSeconds(at) };
}

/**
 * RPC fake driven by a scripted list of pages.
 *
 * `failWith` injects rate limiting at chosen call indices, which is how the backoff and
 * failover paths get exercised without waiting on a real endpoint to throttle us.
 */
export class FakeRpc implements RpcPort {
  readonly endpointLabel = 'fake';
  calls: Array<{ before?: Signature; limit: number }> = [];

  constructor(
    private readonly pages: SignaturePage[],
    private readonly failWith: Map<number, RateLimitedError> = new Map(),
  ) {}

  async getSignatures(
    _address: Address,
    opts: { before?: Signature; limit: number },
  ): Promise<SignaturePage> {
    const index = this.calls.length;
    const failure = this.failWith.get(index);
    this.calls.push(opts);
    if (failure) throw failure;

    // A rate-limited call consumes a call index but no page, so page selection counts
    // only the calls that actually succeeded.
    const pageIndex = this.calls.filter((_, i) => !this.failWith.has(i)).length - 1;
    return this.pages[pageIndex] ?? { signatures: [], nextBefore: null };
  }

  async getTransactions(signatures: readonly Signature[]): Promise<readonly RawTransaction[]> {
    return signatures.map((signature) => ({
      signature,
      slot: 1,
      blockTime: asUnixSeconds(1_700_000_000),
      raw: {},
    }));
  }
}

export function page(
  signatures: readonly SignatureInfo[],
  nextBefore: Signature | null,
): SignaturePage {
  return { signatures, nextBefore };
}

export function sigInfo(n: number, slot = n): SignatureInfo {
  return { signature: sig(n), slot, blockTime: asUnixSeconds(1_700_000_000 + n), err: false };
}

/** In-memory StoragePort. `putCheckpoint` counts writes so durability can be asserted. */
export class FakeStorage implements StoragePort {
  ops: Op[] = [];
  events = new Map<Address, ChainEvent[]>();
  checkpoints = new Map<Address, BackfillCheckpoint>();
  checkpointWrites = 0;
  projectionCleared = 0;

  async appendOps(ops: readonly Op[]): Promise<void> {
    this.ops.push(...ops);
  }
  async readOps(): Promise<readonly Op[]> {
    return this.ops;
  }
  async putChainEvents(events: readonly ChainEvent[]): Promise<void> {
    for (const event of events) {
      const list = this.events.get(event.watchedAddress) ?? [];
      list.push(event);
      this.events.set(event.watchedAddress, list);
    }
  }
  async getChainEvents(address: Address): Promise<readonly ChainEvent[]> {
    return this.events.get(address) ?? [];
  }
  async getCheckpoint(address: Address): Promise<BackfillCheckpoint | null> {
    return this.checkpoints.get(address) ?? null;
  }
  async putCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
    this.checkpointWrites += 1;
    this.checkpoints.set(checkpoint.address, checkpoint);
  }
  async clearProjection(): Promise<void> {
    this.projectionCleared += 1;
    this.events.clear();
  }
}

export function chainEvent(overrides: Partial<ChainEvent> = {}): ChainEvent {
  return {
    kind: 'spl-transfer',
    signature: sig(1),
    instructionIndex: 0,
    slot: 1,
    blockTime: asUnixSeconds(1_700_000_000),
    watchedAddress: asAddress('watched-address'),
    counterparty: asAddress('client-address'),
    direction: 'in',
    amount: usdc('100'),
    memo: null,
    references: [],
    succeeded: true,
    ...overrides,
  } as ChainEvent;
}

export function rateLimited(retryAfterMs?: number): RateLimitedError {
  return new RateLimitedError('fake', retryAfterMs);
}

export const T = (n: number): UnixSeconds => asUnixSeconds(n);
