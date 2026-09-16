/**
 * Fakes for sync-engine tests.
 *
 * HistoryRpc models an address's signature history as one newest-first list and
 * derives pages from the `before` cursor -- the same contract the real adapter
 * implements (nextBefore = last signature of every NON-EMPTY page; empty page means
 * exhausted). Modeling history rather than scripting pages is what lets tests assert
 * checkpoint CONTINUITY across endpoint rotations: the second endpoint serves
 * whatever the cursor actually asks for.
 *
 * RecordingStorage keeps an ordered log of writes so tests can assert the D8
 * interleaving -- every page's events land before the checkpoint that covers them.
 * It dedups events by eventIdentity, mirroring the SQL PRIMARY KEY + OR IGNORE.
 */
import type {
  Address,
  BackfillCheckpoint,
  ChainEvent,
  ClockPort,
  Op,
  RawTransaction,
  RpcPort,
  Signature,
  SignatureInfo,
  SignaturePage,
  StoragePort,
} from '@local-books/core';
import { asAddress, asSignature, asUnixSeconds, eventIdentity } from '@local-books/core';
import { RpcResponseError } from '../../src/adapters/rpc.js';

export const WATCHED = asAddress('WatchedAddr1111111111111111111111111111111');
export const PAYER = asAddress('PayerAddr111111111111111111111111111111111');

export const sig = (n: number): Signature => asSignature(`sig-${String(n).padStart(4, '0')}`);

export const sigInfo = (n: number): SignatureInfo => ({
  signature: sig(n),
  slot: n,
  blockTime: asUnixSeconds(1_700_000_000 + n),
  err: false,
});

/** Newest-first history for signatures n..1. */
export const history = (newest: number): SignatureInfo[] =>
  Array.from({ length: newest }, (_, i) => sigInfo(newest - i));

export const fixedClock = (at = 1_700_000_000): ClockPort => ({ now: () => asUnixSeconds(at) });

/** A jsonParsed SOL transfer INTO the watched address; normalizes to one 'in' event. */
export function rawSolTransfer(
  signature: Signature,
  opts: { slot?: number; from?: Address; to?: Address; lamports?: number } = {},
): RawTransaction {
  const from = opts.from ?? PAYER;
  const to = opts.to ?? WATCHED;
  return {
    signature,
    slot: opts.slot ?? 1,
    blockTime: asUnixSeconds(1_700_000_000),
    raw: {
      transaction: {
        message: {
          accountKeys: [
            { pubkey: from, signer: true, writable: true },
            { pubkey: to, signer: false, writable: true },
            { pubkey: '11111111111111111111111111111111', signer: false, writable: false },
          ],
          instructions: [
            {
              program: 'system',
              programId: '11111111111111111111111111111111',
              parsed: {
                type: 'transfer',
                info: { source: from, destination: to, lamports: opts.lamports ?? 1000 },
              },
            },
          ],
        },
      },
      meta: { err: null },
    },
  };
}

export const USDC_MINT = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * A jsonParsed SPL `transferChecked` INTO an existing token account. Faithful to the
 * wire shape that motivates D19: the account list names the payer, the two token
 * accounts, the mint, and the token program -- and NOT the recipient wallet, which
 * appears only as the destination balance's `owner`. Paging the owner never returns
 * this transaction; paging the token account does.
 */
export function rawSplTransferChecked(
  signature: Signature,
  opts: {
    slot?: number;
    payer?: Address;
    payerTokenAccount?: Address;
    destinationTokenAccount: Address;
    destinationOwner: Address;
    mint?: Address;
    amount?: string;
    references?: readonly Address[];
  },
): RawTransaction {
  const payer = opts.payer ?? PAYER;
  const payerTokenAccount = opts.payerTokenAccount ?? asAddress('PayerTokenAcct11111111111111111111111111111');
  const mint = opts.mint ?? USDC_MINT;
  const amount = opts.amount ?? '1000000';
  const references = opts.references ?? [];
  return {
    signature,
    slot: opts.slot ?? 1,
    blockTime: asUnixSeconds(1_700_000_000),
    raw: {
      transaction: {
        message: {
          accountKeys: [
            { pubkey: payer, signer: true, writable: true },
            { pubkey: payerTokenAccount, signer: false, writable: true },
            { pubkey: opts.destinationTokenAccount, signer: false, writable: true },
            { pubkey: mint, signer: false, writable: false },
            ...references.map((pubkey) => ({ pubkey, signer: false, writable: false })),
            { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', signer: false, writable: false },
          ],
          instructions: [
            {
              program: 'spl-token',
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              parsed: {
                type: 'transferChecked',
                info: {
                  source: payerTokenAccount,
                  destination: opts.destinationTokenAccount,
                  authority: payer,
                  mint,
                  tokenAmount: { amount, decimals: 6 },
                },
              },
            },
          ],
        },
      },
      meta: {
        err: null,
        preTokenBalances: [
          { accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: '5000000', decimals: 6 } },
          { accountIndex: 2, mint, owner: opts.destinationOwner, uiTokenAmount: { amount: '0', decimals: 6 } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: '4000000', decimals: 6 } },
          { accountIndex: 2, mint, owner: opts.destinationOwner, uiTokenAmount: { amount, decimals: 6 } },
        ],
      },
    },
  };
}

export interface TxBehavior {
  /** Throw with ZERO progress (the adapter's contract for a first-call failure). */
  readonly throw?: Error;
  /** Return only the first N transactions (the adapter's mid-batch-error contract). */
  readonly partial?: number;
}

export class HistoryRpc implements RpcPort {
  sigCalls: Array<{ before?: Signature; limit: number }> = [];
  txCalls: Signature[][] = [];

  constructor(
    readonly endpointLabel: string,
    private readonly signatures: readonly SignatureInfo[],
    private readonly hooks: {
      readonly failGetSignatures?: (call: number) => Error | undefined;
      readonly txBehavior?: (call: number, sigs: readonly Signature[]) => TxBehavior | undefined;
    } = {},
  ) {}

  async getSignatures(
    _address: Address,
    opts: { readonly before?: Signature; readonly limit: number },
  ): Promise<SignaturePage> {
    const call = this.sigCalls.length;
    this.sigCalls.push(opts.before ? { before: opts.before, limit: opts.limit } : { limit: opts.limit });
    const failure = this.hooks.failGetSignatures?.(call);
    if (failure) throw failure;

    let start = 0;
    if (opts.before !== undefined) {
      const index = this.signatures.findIndex((s) => s.signature === opts.before);
      // Mirrors the real adapter's cursor verification: an endpoint that does not
      // know the `before` cursor throws instead of serving an "exhausted" page --
      // an empty page durably ends the backfill, and a blind node must not end it.
      if (index === -1) {
        throw new RpcResponseError(this.endpointLabel, 0, 'cursor unknown to this endpoint');
      }
      start = index + 1;
    }
    const slice = this.signatures.slice(start, start + opts.limit);
    return slice.length === 0
      ? { signatures: [], nextBefore: null }
      : { signatures: slice, nextBefore: slice[slice.length - 1]!.signature };
  }

  async getTransactions(signatures: readonly Signature[]): Promise<readonly RawTransaction[]> {
    const call = this.txCalls.length;
    this.txCalls.push([...signatures]);
    const behavior = this.hooks.txBehavior?.(call, signatures);
    if (behavior?.throw) throw behavior.throw;
    const served = behavior?.partial !== undefined ? signatures.slice(0, behavior.partial) : signatures;
    return served.map((s) => rawSolTransfer(s));
  }
}

export type StorageWrite =
  | { readonly write: 'events'; readonly signatures: readonly string[] }
  | {
      readonly write: 'checkpoint';
      readonly oldestSeen: string | null;
      readonly newestSeen: string | null;
      readonly complete: boolean;
    };

export class RecordingStorage implements StoragePort {
  ops: Op[] = [];
  events = new Map<Address, ChainEvent[]>();
  checkpoints = new Map<Address, BackfillCheckpoint>();
  log: StorageWrite[] = [];
  failPutChainEvents?: (call: number) => Error | undefined;
  private putEventsCalls = 0;

  async appendOps(ops: readonly Op[]): Promise<void> {
    this.ops.push(...ops);
  }
  async readOps(): Promise<readonly Op[]> {
    return this.ops;
  }

  async putChainEvents(events: readonly ChainEvent[]): Promise<void> {
    const failure = this.failPutChainEvents?.(this.putEventsCalls);
    this.putEventsCalls += 1;
    if (failure) throw failure;
    this.log.push({ write: 'events', signatures: events.map((e) => e.signature) });
    for (const event of events) {
      const list = this.events.get(event.watchedAddress) ?? [];
      // First write wins on identity, mirroring the SQL OR IGNORE.
      if (!list.some((existing) => eventIdentity(existing) === eventIdentity(event))) {
        list.push(event);
      }
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
    this.log.push({
      write: 'checkpoint',
      oldestSeen: checkpoint.oldestSeen,
      newestSeen: checkpoint.newestSeen,
      complete: checkpoint.complete,
    });
    this.checkpoints.set(checkpoint.address, checkpoint);
  }

  async clearProjection(): Promise<void> {}

  checkpointWrites(): readonly StorageWrite[] {
    return this.log.filter((entry) => entry.write === 'checkpoint');
  }
}
