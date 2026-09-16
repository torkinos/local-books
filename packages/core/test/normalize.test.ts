import { describe, expect, it } from 'vitest';
import {
  mergeEvents,
  normalizeTransaction,
  normalizeTransactions,
} from '../src/normalize/index.js';
import type { RawTransaction } from '../src/ports/index.js';
import { asAddress, asSignature, asUnixSeconds } from '../src/types/index.js';
import { REAL_SPL_TRANSFER_CHECKED } from './fixtures/real-transactions.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const realTx: RawTransaction = {
  signature: asSignature(REAL_SPL_TRANSFER_CHECKED.signature),
  slot: REAL_SPL_TRANSFER_CHECKED.slot,
  blockTime: asUnixSeconds(REAL_SPL_TRANSFER_CHECKED.blockTime),
  raw: REAL_SPL_TRANSFER_CHECKED.raw,
};

// ---------------------------------------------------------------------------
// Synthetic jsonParsed builders. Field shapes mirror the real fixture above.
// ---------------------------------------------------------------------------

interface Key {
  pubkey: string;
  signer?: boolean;
  writable?: boolean;
}

function tx(opts: {
  signature?: string;
  instructions: unknown[];
  accountKeys?: Key[];
  tokenBalances?: Array<{ accountIndex: number; mint: string; owner: string; decimals: number }>;
  innerInstructions?: Array<{ index: number; instructions: unknown[] }>;
  err?: unknown;
}): RawTransaction {
  return {
    signature: asSignature(opts.signature ?? 'synthetic-signature'),
    slot: 100,
    blockTime: asUnixSeconds(1_760_000_000),
    raw: {
      meta: {
        err: opts.err ?? null,
        innerInstructions: opts.innerInstructions ?? [],
        preTokenBalances: (opts.tokenBalances ?? []).map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: { amount: '0', decimals: b.decimals },
        })),
        postTokenBalances: (opts.tokenBalances ?? []).map((b) => ({
          accountIndex: b.accountIndex,
          mint: b.mint,
          owner: b.owner,
          uiTokenAmount: { amount: '0', decimals: b.decimals },
        })),
      },
      transaction: {
        message: {
          accountKeys: (opts.accountKeys ?? []).map((k) => ({
            pubkey: k.pubkey,
            signer: k.signer ?? false,
            writable: k.writable ?? true,
          })),
          instructions: opts.instructions,
        },
      },
    },
  };
}

const splTransfer = (source: string, destination: string, authority: string, amount: string): unknown => ({
  program: 'spl-token',
  programId: TOKEN_PROGRAM,
  parsed: { type: 'transfer', info: { source, destination, authority, amount } },
});

const solTransfer = (source: string, destination: string, lamports: number): unknown => ({
  program: 'system',
  programId: SYSTEM_PROGRAM,
  parsed: { type: 'transfer', info: { source, destination, lamports } },
});

const memoIx = (text: string): unknown => ({
  program: 'spl-memo',
  programId: MEMO_PROGRAM,
  parsed: text,
});

describe('normalizeTransaction: real mainnet transferChecked', () => {
  it('books an incoming USDC transfer for the recipient wallet, via token-balance owners', () => {
    const events = normalizeTransaction(realTx, asAddress(REAL_SPL_TRANSFER_CHECKED.recipient));
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.direction).toBe('in');
    expect(event.amount.raw).toBe(500_000n);
    expect(event.amount.decimals).toBe(6);
    expect(event.amount.mint).toBe(USDC);
    expect(event.amount.symbol).toBe('USDC');
    expect(event.counterparty).toBe(REAL_SPL_TRANSFER_CHECKED.sender);
    // Top-level position in message.instructions: two createIdempotent precede it.
    expect(event.instructionIndex).toBe(2);
    expect(event.succeeded).toBe(true);
    expect(event.memo).toBeNull();
    expect(event.kind).toBe('spl-transfer');
    expect(event.blockTime).toBe(REAL_SPL_TRANSFER_CHECKED.blockTime);
    expect(event.slot).toBe(REAL_SPL_TRANSFER_CHECKED.slot);
  });

  it('books the same transfer as outgoing for the sender wallet', () => {
    const events = normalizeTransaction(realTx, asAddress(REAL_SPL_TRANSFER_CHECKED.sender));
    expect(events).toHaveLength(1);
    expect(events[0]!.direction).toBe('out');
    expect(events[0]!.counterparty).toBe(REAL_SPL_TRANSFER_CHECKED.recipient);
  });

  it('produces nothing for an uninvolved address', () => {
    expect(normalizeTransaction(realTx, asAddress('SomeUninvolvedAddress11111111111111111111111'))).toHaveLength(0);
  });
});

describe('normalizeTransaction: batch payout', () => {
  // One transaction, one signature, three SPL transfers to three recipients -- the
  // case that makes (signature, instructionIndex) the identity, not signature alone.
  const payerAta = 'PayerAta1111111111111111111111111111111111';
  const payer = 'Payer1111111111111111111111111111111111111';
  const atas = ['RecipAtaA111111111111111111111111111111111', 'RecipAtaB111111111111111111111111111111111', 'RecipAtaC111111111111111111111111111111111'];
  const owners = ['RecipA111111111111111111111111111111111111', 'RecipB111111111111111111111111111111111111', 'RecipC111111111111111111111111111111111111'];

  const batch = tx({
    signature: 'batch-payout-signature',
    accountKeys: [
      { pubkey: payer, signer: true },
      { pubkey: payerAta },
      ...atas.map((pubkey) => ({ pubkey })),
      { pubkey: TOKEN_PROGRAM, writable: false },
    ],
    tokenBalances: [
      { accountIndex: 1, mint: USDC, owner: payer, decimals: 6 },
      { accountIndex: 2, mint: USDC, owner: owners[0]!, decimals: 6 },
      { accountIndex: 3, mint: USDC, owner: owners[1]!, decimals: 6 },
      { accountIndex: 4, mint: USDC, owner: owners[2]!, decimals: 6 },
    ],
    instructions: atas.map((ata, i) => splTransfer(payerAta, ata, payer, String((i + 1) * 1_000_000))),
  });

  it('produces three events with distinct instruction indices for the payer', () => {
    const events = normalizeTransaction(batch, asAddress(payer));
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.instructionIndex)).toEqual([0, 1, 2]);
    expect(events.map((e) => e.direction)).toEqual(['out', 'out', 'out']);
    expect(events.map((e) => e.amount.raw)).toEqual([1_000_000n, 2_000_000n, 3_000_000n]);
    // Plain `transfer` carries no mint or decimals; both must resolve via balances.
    expect(events[0]!.amount.mint).toBe(USDC);
    expect(events[0]!.amount.decimals).toBe(6);
  });

  it('produces exactly one incoming event for one recipient of the batch', () => {
    const events = normalizeTransaction(batch, asAddress(owners[1]!));
    expect(events).toHaveLength(1);
    expect(events[0]!.direction).toBe('in');
    expect(events[0]!.instructionIndex).toBe(1);
    expect(events[0]!.amount.raw).toBe(2_000_000n);
    expect(events[0]!.counterparty).toBe(payer);
  });

  it('re-ingesting the same page changes nothing', () => {
    const first = normalizeTransactions([batch], asAddress(payer));
    const again = normalizeTransactions([batch], asAddress(payer));
    expect(mergeEvents(first, again)).toEqual(first);
    expect(mergeEvents(mergeEvents(first, again), again)).toHaveLength(3);
  });
});

describe('normalizeTransaction: SOL system transfers', () => {
  const alice = 'Alice1111111111111111111111111111111111111';
  const bob = 'Bob111111111111111111111111111111111111111';

  it('books lamports at 9 decimals with a null mint', () => {
    const events = normalizeTransaction(
      tx({ instructions: [solTransfer(alice, bob, 1_500_000_000)] }),
      asAddress(bob),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('sol-transfer');
    expect(events[0]!.direction).toBe('in');
    expect(events[0]!.amount).toEqual({ raw: 1_500_000_000n, decimals: 9, mint: null, symbol: 'SOL' });
    expect(events[0]!.counterparty).toBe(alice);
  });

  it('skips a self-transfer instead of booking phantom income', () => {
    const events = normalizeTransaction(
      tx({ instructions: [solTransfer(alice, alice, 1_000_000)] }),
      asAddress(alice),
    );
    expect(events).toHaveLength(0);
  });
});

describe('normalizeTransaction: memo, failure, references', () => {
  const alice = 'Alice1111111111111111111111111111111111111';
  const bob = 'Bob111111111111111111111111111111111111111';
  const reference = 'RefKey11111111111111111111111111111111111111';

  it('attaches memo text to the event', () => {
    const events = normalizeTransaction(
      tx({ instructions: [memoIx('invoice 42'), solTransfer(alice, bob, 5)] }),
      asAddress(bob),
    );
    expect(events[0]!.memo).toBe('invoice 42');
  });

  it('marks events from failed transactions unsucceeded', () => {
    const events = normalizeTransaction(
      tx({ instructions: [solTransfer(alice, bob, 5)], err: { InstructionError: [0, 'Custom'] } }),
      asAddress(bob),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.succeeded).toBe(false);
  });

  it('surfaces non-signer, non-writable extras as candidate references, never programs', () => {
    const events = normalizeTransaction(
      tx({
        accountKeys: [
          { pubkey: alice, signer: true },
          { pubkey: bob },
          { pubkey: reference, writable: false },
          { pubkey: SYSTEM_PROGRAM, writable: false },
          { pubkey: TOKEN_PROGRAM, writable: false },
        ],
        instructions: [solTransfer(alice, bob, 5)],
      }),
      asAddress(bob),
    );
    expect(events[0]!.references).toEqual([reference]);
  });

  it('the real transaction yields no false reference for the mint or programs', () => {
    const events = normalizeTransaction(realTx, asAddress(REAL_SPL_TRANSFER_CHECKED.sender));
    // The recipient wallet appears non-signer/non-writable (ATA create) and is the one
    // over-approximation candidate; the mint and every program must be filtered out.
    expect(events[0]!.references).toEqual([REAL_SPL_TRANSFER_CHECKED.recipient]);
  });
});

describe('normalizeTransaction: instructionIndex is endpoint-stable', () => {
  // The same signature fetched from two providers can disagree about
  // meta.innerInstructions (recording is node configuration). Top-level events must
  // keep identical indices either way, or (signature, instructionIndex) dedup breaks
  // and a failover re-fetch double-books a payment.
  const payer = 'Payer1111111111111111111111111111111111111';
  const payerAta = 'PayerAta1111111111111111111111111111111111';
  const watched = 'Watched11111111111111111111111111111111111';
  const watchedAta = 'WatchedAta111111111111111111111111111111111';

  const base = {
    signature: 'cpi-batch-signature',
    accountKeys: [
      { pubkey: payer, signer: true },
      { pubkey: payerAta },
      { pubkey: watchedAta },
      { pubkey: TOKEN_PROGRAM, writable: false },
    ],
    tokenBalances: [
      { accountIndex: 1, mint: USDC, owner: payer, decimals: 6 },
      { accountIndex: 2, mint: USDC, owner: watched, decimals: 6 },
    ],
    instructions: [
      { programId: 'Payout111111111111111111111111111111111111', accounts: [], data: 'xx' },
      solTransfer(payer, watched, 7_000),
    ],
  };

  const cpiTransfers = [
    splTransfer(payerAta, watchedAta, payer, '1000000'),
    splTransfer(payerAta, watchedAta, payer, '2000000'),
  ];

  it('numbers inner CPI transfers in the (parent+1)*1024 range and keeps top-level positions', () => {
    const events = normalizeTransaction(
      tx({ ...base, innerInstructions: [{ index: 0, instructions: cpiTransfers }] }),
      asAddress(watched),
    );
    expect(events.map((e) => e.instructionIndex)).toEqual([1024, 1025, 1]);
  });

  it('a provider omitting innerInstructions renumbers nothing, and the merge produces no duplicates', () => {
    const withInner = normalizeTransaction(
      tx({ ...base, innerInstructions: [{ index: 0, instructions: cpiTransfers }] }),
      asAddress(watched),
    );
    const withoutInner = normalizeTransaction(tx({ ...base }), asAddress(watched));

    // The top-level SOL transfer keeps index 1 from both providers...
    expect(withoutInner.map((e) => e.instructionIndex)).toEqual([1]);
    // ...so merging the two fetches dedups it instead of double-booking.
    expect(mergeEvents(withInner, withoutInner)).toEqual(withInner);
  });
});

describe('normalizeTransaction: malformed amounts never abort a page', () => {
  const alice = 'Alice1111111111111111111111111111111111111';
  const bob = 'Bob111111111111111111111111111111111111111';
  const aliceAta = 'AliceAta111111111111111111111111111111111';
  const bobAta = 'BobAta11111111111111111111111111111111111';

  const splWith = (amount: string) =>
    tx({
      signature: `bad-${amount}`,
      accountKeys: [{ pubkey: alice, signer: true }, { pubkey: aliceAta }, { pubkey: bobAta }],
      tokenBalances: [
        { accountIndex: 1, mint: USDC, owner: alice, decimals: 6 },
        { accountIndex: 2, mint: USDC, owner: bob, decimals: 6 },
      ],
      instructions: [splTransfer(aliceAta, bobAta, alice, amount)],
    });

  it.each(['12.5', '1e6', 'abc', '-500000', ''])(
    'skips SPL amount %j without throwing',
    (amount) => {
      expect(normalizeTransaction(splWith(amount), asAddress(bob))).toEqual([]);
    },
  );

  it('skips non-integer lamports without throwing', () => {
    const bad = tx({ instructions: [solTransfer(alice, bob, 0.5)] });
    expect(normalizeTransaction(bad, asAddress(bob))).toEqual([]);
  });

  it('one hostile transaction does not take a good one down with it', () => {
    const good = tx({ signature: 'good-1', instructions: [solTransfer(alice, bob, 5_000)] });
    const events = normalizeTransactions([splWith('12.5'), good], asAddress(bob));
    expect(events).toHaveLength(1);
    expect(events[0]!.amount.raw).toBe(5_000n);
  });
});

describe('normalizeTransaction: both sides watched', () => {
  it('keeps both ledger sides when the user watches both wallets of a transfer', () => {
    const alice = 'Alice1111111111111111111111111111111111111';
    const bob = 'Bob111111111111111111111111111111111111111';
    const move = tx({ signature: 'internal-move', instructions: [solTransfer(alice, bob, 9_000)] });

    const merged = mergeEvents(
      normalizeTransaction(move, asAddress(alice)),
      normalizeTransaction(move, asAddress(bob)),
    );
    // Same (signature, instructionIndex), two watched addresses: dedup must not
    // collapse the out side and the in side into one.
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.direction).sort()).toEqual(['in', 'out']);
  });
});

describe('normalizeTransaction: hostile input', () => {
  it.each([null, undefined, 42, 'string', {}, { transaction: {} }, { transaction: { message: {} } }])(
    'produces no events and does not throw on %j',
    (raw) => {
      const hostile: RawTransaction = {
        signature: asSignature('sig-hostile'),
        slot: 1,
        blockTime: null,
        raw,
      };
      expect(normalizeTransaction(hostile, asAddress('Anyone111111111111111111111111111111111111'))).toEqual([]);
    },
  );
});
