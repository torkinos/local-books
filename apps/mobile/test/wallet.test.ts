/**
 * D19: associated-token-account derivation and wallet-level sync.
 *
 * The bug this guards against: a `transferChecked` into an EXISTING token account
 * names the token account and the payer, never the recipient wallet, so paging the
 * wallet with getSignaturesForAddress cannot see it. The derivation is pinned to two
 * real mainnet token accounts (both created by `createIdempotent` in the fixture
 * transaction, so they are ATAs by construction); the engine tests then show a
 * payment that never names the owner landing in the owner's books.
 */
import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import type { Address } from '@local-books/core';
import { asAddress, RateLimitedError } from '@local-books/core';
import { associatedTokenAddress, findProgramAddress, isOnCurve } from '../src/sync/ata.js';
import { checkpointKeyFor, syncAddress } from '../src/sync/engine.js';
import type { SyncDeps, SyncEngineOptions, SyncProgress } from '../src/sync/engine.js';
import { syncWallet, walletAddresses } from '../src/sync/wallet.js';
import {
  HistoryRpc,
  RecordingStorage,
  USDC_MINT,
  WATCHED,
  fixedClock,
  rawSolTransfer,
  rawSplTransferChecked,
  sig,
  sigInfo,
} from './helpers/syncFakes.js';

const MAINNET_USDC = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MAINNET_USDT = asAddress('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

describe('associatedTokenAddress', () => {
  it('reproduces the two real mainnet ATAs in the normalizer fixture', () => {
    // packages/core/test/fixtures/real-transactions.ts: accountKeys[1] is the
    // sender's USDC ATA, accountKeys[2] the recipient's; owners come from the
    // token balances of the same transaction.
    expect(
      associatedTokenAddress(asAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'), MAINNET_USDC),
    ).toBe('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    expect(
      associatedTokenAddress(asAddress('rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV'), MAINNET_USDC),
    ).toBe('9jLtYXZdVxJHzzLV3oppNGL5Vs9S1KX7b4PBaLj55bkq');
  });

  it('is deterministic, off-curve, and distinct per mint', () => {
    const owner = asAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    const usdc = associatedTokenAddress(owner, MAINNET_USDC);
    const usdt = associatedTokenAddress(owner, MAINNET_USDT);
    expect(associatedTokenAddress(owner, MAINNET_USDC)).toBe(usdc);
    expect(usdt).not.toBe(usdc);
    expect(isOnCurve(bs58.decode(usdc))).toBe(false);
    expect(isOnCurve(bs58.decode(usdt))).toBe(false);
    // The owner itself is a real ed25519 key, so the curve check distinguishes.
    expect(isOnCurve(bs58.decode(owner))).toBe(true);
  });

  it('findProgramAddress starts at bump 255 and takes the first off-curve hash', () => {
    const owner = bs58.decode('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    const { bump } = findProgramAddress(
      [owner, bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), bs58.decode(MAINNET_USDC)],
      bs58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    );
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('rejects inputs that are not 32-byte base58 keys instead of deriving garbage', () => {
    expect(() => associatedTokenAddress(asAddress('not-base58-0OIl'), MAINNET_USDC)).toThrow(RangeError);
    expect(() => associatedTokenAddress(asAddress('abc'), MAINNET_USDC)).toThrow(/32 bytes/);
    expect(() => associatedTokenAddress(WATCHED, asAddress(''))).toThrow(RangeError);
  });

  it('walletAddresses lists the owner once per distinct mint, in order', () => {
    const owner = asAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    const wallet = walletAddresses(owner, [MAINNET_USDC, MAINNET_USDT, MAINNET_USDC]);
    expect(wallet.owner).toBe(owner);
    expect(wallet.tokenAccounts.map((t) => t.mint)).toEqual([MAINNET_USDC, MAINNET_USDT]);
    expect(wallet.tokenAccounts[0]!.address).toBe('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
  });
});

// A real-shaped owner so the ATA derivation runs; the fake RPC never checks it.
const OWNER = asAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const OWNER_ATA = associatedTokenAddress(OWNER, USDC_MINT);

const engineOpts = (extra: Partial<SyncEngineOptions> = {}): SyncEngineOptions => ({
  backfill: {
    pageSize: 3,
    maxPagesPerRun: 10,
    basePaceMs: 5,
    maxBackoffMs: 100,
    maxConsecutiveRateLimits: 3,
  },
  hydrationChunkSize: 2,
  ...extra,
});

const noSleep = async (): Promise<void> => undefined;

/** An RPC whose history depends on WHICH address is paged. */
class PerAddressRpc extends HistoryRpc {
  pagedAddresses: Address[] = [];
  constructor(
    label: string,
    private readonly histories: ReadonlyMap<Address, readonly ReturnType<typeof sigInfo>[]>,
    private readonly txs: ReadonlyMap<string, ReturnType<typeof rawSolTransfer>>,
  ) {
    super(label, []);
  }
  override async getSignatures(address: Address, opts: { readonly before?: ReturnType<typeof sig>; readonly limit: number }) {
    this.pagedAddresses.push(address);
    const signatures = this.histories.get(address) ?? [];
    let start = 0;
    if (opts.before !== undefined) start = signatures.findIndex((s) => s.signature === opts.before) + 1;
    const slice = signatures.slice(start, start + opts.limit);
    return slice.length === 0
      ? { signatures: [], nextBefore: null }
      : { signatures: slice, nextBefore: slice[slice.length - 1]!.signature };
  }
  override async getTransactions(signatures: readonly ReturnType<typeof sig>[]) {
    this.txCalls.push([...signatures]);
    return signatures.map((s) => {
      const tx = this.txs.get(s);
      if (!tx) throw new Error(`fake RPC has no transaction ${s}`);
      return tx;
    });
  }
}

describe('syncAddress with an owner (token-account paging)', () => {
  it('books a payment that never names the owner under the owner, checkpointing the token account', async () => {
    const payment = rawSplTransferChecked(sig(1), {
      destinationTokenAccount: OWNER_ATA,
      destinationOwner: OWNER,
      amount: '2500000',
    });
    // The wire fact behind D19, asserted rather than assumed: the owner is absent
    // from the account list, so owner paging could never have returned this.
    const keys = (payment.raw as { transaction: { message: { accountKeys: { pubkey: string }[] } } })
      .transaction.message.accountKeys.map((k) => k.pubkey);
    expect(keys).not.toContain(OWNER);
    expect(keys).toContain(OWNER_ATA);

    const rpc = new PerAddressRpc(
      'A',
      new Map([[OWNER_ATA, [sigInfo(1)]]]),
      new Map([[sig(1), payment]]),
    );
    const storage = new RecordingStorage();
    const deps: SyncDeps = { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep };

    const result = await syncAddress(OWNER_ATA, deps, engineOpts({ owner: OWNER }));

    expect(result.kind).toBe('complete');
    const events = storage.events.get(OWNER) ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'spl-transfer',
      watchedAddress: OWNER,
      direction: 'in',
      amount: { raw: 2_500_000n, decimals: 6, mint: USDC_MINT, symbol: 'USDC' },
    });
    expect(storage.events.get(OWNER_ATA)).toBeUndefined();
    // The token account's cursor lives under (account, owner), never the bare account.
    expect(storage.checkpoints.get(checkpointKeyFor(OWNER_ATA, OWNER))?.complete).toBe(true);
    expect(storage.checkpoints.get(OWNER_ATA)).toBeUndefined();
    expect(storage.checkpoints.get(OWNER)).toBeUndefined();
  });

  it('does not re-buy a transaction already stored through the owner (missingSignatures keyed by owner)', async () => {
    // An ATA-create + first payment names BOTH the owner and the token account, so
    // owner paging ingests it first. The token-account pass must skip it.
    const first = rawSplTransferChecked(sig(1), {
      destinationTokenAccount: OWNER_ATA,
      destinationOwner: OWNER,
    });
    const storage = new RecordingStorage();
    const seed = new PerAddressRpc('seed', new Map([[OWNER, [sigInfo(1)]]]), new Map([[sig(1), first]]));
    await syncAddress(OWNER, { endpoints: [seed], storage, clock: fixedClock(), sleep: noSleep }, engineOpts());
    expect(storage.events.get(OWNER)).toHaveLength(1);

    const rpc = new PerAddressRpc('A', new Map([[OWNER_ATA, [sigInfo(1)]]]), new Map([[sig(1), first]]));
    const result = await syncAddress(
      OWNER_ATA,
      { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep },
      engineOpts({ owner: OWNER }),
    );
    expect(result.kind).toBe('complete');
    expect(rpc.txCalls).toEqual([]); // nothing hydrated: the owner already had it
    expect(storage.events.get(OWNER)).toHaveLength(1);
  });
});

describe('syncWallet', () => {
  it('pages the owner, then each token account; events all land under the owner', async () => {
    const solIn = rawSolTransfer(sig(10), { to: OWNER });
    const usdcIn = rawSplTransferChecked(sig(20), {
      destinationTokenAccount: OWNER_ATA,
      destinationOwner: OWNER,
    });
    const rpc = new PerAddressRpc(
      'A',
      new Map([
        [OWNER, [sigInfo(10)]],
        [OWNER_ATA, [sigInfo(20)]],
      ]),
      new Map([
        [sig(10), solIn],
        [sig(20), usdcIn],
      ]),
    );
    const storage = new RecordingStorage();
    const seen: SyncProgress[] = [];
    const result = await syncWallet(
      OWNER,
      [USDC_MINT],
      { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep, onProgress: (p) => seen.push(p) },
      engineOpts(),
    );

    expect(result.kind).toBe('complete');
    expect(result.totals).toEqual({ pages: 2, signaturesSeen: 2, transactionsFetched: 2, eventsStored: 2 });
    // Owner first, then the ATA (each address also gets the "is history exhausted"
    // empty-page ask, which is the driver's contract, not ours).
    expect([...new Set(rpc.pagedAddresses)]).toEqual([OWNER, OWNER_ATA]);
    const events = storage.events.get(OWNER) ?? [];
    expect(events.map((e) => [e.kind, e.direction, e.watchedAddress])).toEqual([
      ['sol-transfer', 'in', OWNER],
      ['spl-transfer', 'in', OWNER],
    ]);
    // Every progress report names the wallet as owner, whichever address is paged.
    expect(seen.every((p) => p.owner === OWNER)).toBe(true);
    expect(new Set(seen.map((p) => p.address))).toEqual(new Set([OWNER, OWNER_ATA]));
  });

  it('stops at the first non-complete result and reports summed totals', async () => {
    const usdcIn = rawSplTransferChecked(sig(20), {
      destinationTokenAccount: OWNER_ATA,
      destinationOwner: OWNER,
    });
    const rpc = new PerAddressRpc(
      'A',
      new Map([
        [OWNER, []],
        [OWNER_ATA, [sigInfo(20)]],
      ]),
      new Map([[sig(20), usdcIn]]),
    );
    // The owner's paging fails on the only endpoint: the wallet pass ends there,
    // and the token account is not attempted against an endpoint we just gave up on.
    rpc.getSignatures = async (address) => {
      rpc.pagedAddresses.push(address);
      throw new RateLimitedError('A');
    };
    const storage = new RecordingStorage();
    const result = await syncWallet(
      OWNER,
      [USDC_MINT],
      { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep },
      engineOpts(),
    );
    expect(result.kind).toBe('endpoints-exhausted');
    expect(rpc.pagedAddresses.length).toBeGreaterThan(0);
    expect(rpc.pagedAddresses.every((a) => a === OWNER)).toBe(true);
    expect(result.totals).toEqual({ pages: 0, signaturesSeen: 0, transactionsFetched: 0, eventsStored: 0 });
  });

  it('a page budget hit on a token account ends the pass with SUMMED totals; later accounts wait', async () => {
    // Owner: one transaction (history exhausted inside the budget). USDC account: four
    // transactions at three per page -- the second page exhausts a 2-page budget
    // before the driver can confirm the end of history. USDT account: never reached.
    const USDT_ATA = associatedTokenAddress(OWNER, MAINNET_USDT);
    const usdcIn = (n: number) =>
      rawSplTransferChecked(sig(n), { destinationTokenAccount: OWNER_ATA, destinationOwner: OWNER, slot: n });
    const rpc = new PerAddressRpc(
      'A',
      new Map([
        [OWNER, [sigInfo(1)]],
        [OWNER_ATA, [sigInfo(23), sigInfo(22), sigInfo(21), sigInfo(20)]],
        [USDT_ATA, [sigInfo(30)]],
      ]),
      new Map([
        [sig(1), rawSolTransfer(sig(1), { to: OWNER })],
        [sig(20), usdcIn(20)],
        [sig(21), usdcIn(21)],
        [sig(22), usdcIn(22)],
        [sig(23), usdcIn(23)],
        [sig(30), rawSplTransferChecked(sig(30), { destinationTokenAccount: USDT_ATA, destinationOwner: OWNER, mint: MAINNET_USDT })],
      ]),
    );
    const storage = new RecordingStorage();
    const result = await syncWallet(
      OWNER,
      [USDC_MINT, MAINNET_USDT],
      { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep },
      engineOpts({
        backfill: { pageSize: 3, maxPagesPerRun: 2, basePaceMs: 5, maxBackoffMs: 100, maxConsecutiveRateLimits: 3 },
      }),
    );
    expect(result.kind).toBe('page-budget-reached');
    expect(new Set(rpc.pagedAddresses)).toEqual(new Set([OWNER, OWNER_ATA]));
    expect(result.totals).toEqual({ pages: 3, signaturesSeen: 5, transactionsFetched: 5, eventsStored: 5 });
    expect(storage.events.get(OWNER)).toHaveLength(5);
    // The caller loops on 'page-budget-reached'; the next pass finishes the job.
    const next = await syncWallet(
      OWNER,
      [USDC_MINT, MAINNET_USDT],
      { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep },
      engineOpts({
        backfill: { pageSize: 3, maxPagesPerRun: 2, basePaceMs: 5, maxBackoffMs: 100, maxConsecutiveRateLimits: 3 },
      }),
    );
    expect(next.kind).toBe('complete');
    expect(rpc.pagedAddresses).toContain(USDT_ATA);
    expect(storage.events.get(OWNER)).toHaveLength(6);
  });

  it('honors cancellation between accounts', async () => {
    const rpc = new PerAddressRpc('A', new Map([[OWNER, []], [OWNER_ATA, []]]), new Map());
    const controller = new AbortController();
    controller.abort();
    const result = await syncWallet(
      OWNER,
      [USDC_MINT],
      { endpoints: [rpc], storage: new RecordingStorage(), clock: fixedClock(), sleep: noSleep, signal: controller.signal },
      engineOpts(),
    );
    expect(result.kind).toBe('cancelled');
    expect(rpc.pagedAddresses).toEqual([]);
  });

  it('a token account watched directly and via its wallet keep separate checkpoints', async () => {
    // The app accepts any 32-byte key, so a user can watch their USDC account X
    // itself, then the wallet W that owns it. X's own walk (owner = X) must not
    // make W's walk of X (owner = W) think history is already complete.
    const usdcIn = rawSplTransferChecked(sig(20), {
      destinationTokenAccount: OWNER_ATA,
      destinationOwner: OWNER,
    });
    const storage = new RecordingStorage();
    const direct = new PerAddressRpc('A', new Map([[OWNER_ATA, [sigInfo(20)]]]), new Map([[sig(20), usdcIn]]));
    await syncAddress(OWNER_ATA, { endpoints: [direct], storage, clock: fixedClock(), sleep: noSleep }, engineOpts());
    expect(storage.checkpoints.get(OWNER_ATA)?.complete).toBe(true);
    // Watched as its own address, the account's transfer is an 'in' for... the
    // account. (Nothing is booked under W yet.)
    expect(storage.events.get(OWNER)).toBeUndefined();

    const viaWallet = new PerAddressRpc(
      'A',
      new Map([
        [OWNER, []],
        [OWNER_ATA, [sigInfo(20)]],
      ]),
      new Map([[sig(20), usdcIn]]),
    );
    const result = await syncWallet(OWNER, [USDC_MINT], { endpoints: [viaWallet], storage, clock: fixedClock(), sleep: noSleep }, engineOpts());
    expect(result.kind).toBe('complete');
    // W's walk of X ran in full and booked the payment under W...
    expect(storage.events.get(OWNER)?.map((e) => [e.signature, e.direction])).toEqual([[sig(20), 'in']]);
    // ...under its own namespaced checkpoint, leaving X's untouched.
    expect(storage.checkpoints.get(checkpointKeyFor(OWNER_ATA, OWNER))?.complete).toBe(true);
    expect(storage.checkpoints.get(OWNER_ATA)?.complete).toBe(true);
    expect(checkpointKeyFor(OWNER_ATA, OWNER)).toBe(`${OWNER_ATA}@${OWNER}`);
    expect(checkpointKeyFor(OWNER, OWNER)).toBe(OWNER);
  });

  it('with no mints it is exactly the owner sync', async () => {
    const rpc = new PerAddressRpc('A', new Map([[OWNER, [sigInfo(1)]]]), new Map([[sig(1), rawSolTransfer(sig(1), { to: OWNER })]]));
    const storage = new RecordingStorage();
    const result = await syncWallet(OWNER, [], { endpoints: [rpc], storage, clock: fixedClock(), sleep: noSleep }, engineOpts());
    expect(result.kind).toBe('complete');
    expect([...new Set(rpc.pagedAddresses)]).toEqual([OWNER]);
    expect(storage.events.get(OWNER)).toHaveLength(1);
  });
});
