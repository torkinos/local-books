/**
 * jsonParsed transaction -> ChainEvents.
 *
 * The wire shape is what the RPC actually serves (validated against live mainnet
 * transactions in test/fixtures/real-transactions.ts), not what a web3.js typing says.
 * Everything is parsed defensively: `raw` arrives as `unknown` (see RawTransaction),
 * and a shape we do not recognise produces no events rather than a throw -- one exotic
 * transaction must not abort ingestion of a whole page.
 *
 * Three wire facts shape this module:
 *
 *   1. Parsed instructions do NOT carry their account lists -- the RPC collapses known
 *      programs into `{parsed: {info}}` and drops the keys. So Solana Pay references
 *      (extra non-signer accounts on the transfer instruction) are recovered from the
 *      transaction-level `accountKeys` instead: every non-signer, non-writable key that
 *      is not a program or a mint is a *candidate* reference. That over-approximates
 *      (an ATA-create's wallet lands in the list), which is safe: reference keys are
 *      unique random keypairs (D7), so a stray address can never equal a real invoice
 *      reference and tier-a matching cannot false-positive on it.
 *   2. A plain `transfer` gives token *accounts*, not owners, and no mint or decimals.
 *      `pre/postTokenBalances` carry `{accountIndex, mint, owner, decimals}` and are
 *      how those resolve (PROJECT.md line 69) -- `transferChecked` also names the mint
 *      itself.
 *   3. Inner (CPI) instructions live in `meta.innerInstructions`, grouped by top-level
 *      index -- and whether they are present AT ALL depends on the serving node's
 *      configuration, so two fetches of the same signature from different endpoints
 *      (a designed-in path: the backfill driver rotates endpoints on failover) can
 *      disagree about them. `instructionIndex` therefore must not depend on how many
 *      inner instructions preceded an instruction: a top-level instruction keeps its
 *      position in `message.instructions` (part of the signed transaction, identical
 *      from every endpoint), and an inner instruction gets `(parent+1)*1024 + offset`
 *      -- stable whenever inner data is served, and merely absent (never renumbered)
 *      when it is not. Solana's transaction size cap keeps top-level indices far below
 *      1024, so the ranges cannot collide.
 */
import type { RawTransaction } from '../ports/index.js';
import type { Address, ChainEvent, ReferenceKey, TokenAmount } from '../types/index.js';
import { asAddress, asReferenceKey } from '../types/index.js';
import { STABLE_MINTS } from '../value/index.js';

/** Programs that appear as non-signer, non-writable keys but are never references. */
const KNOWN_PROGRAMS = new Set<string>([
  '11111111111111111111111111111111', // system
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // spl-token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // associated token account
  'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // memo v2
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', // memo v1
]);

/** See module comment, fact 3: inner instruction `j` under parent `i` -> (i+1)*1024+j. */
export const INNER_INDEX_BASE = 1024;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Amount strings come off the wire unvalidated, and `BigInt('12.5')` THROWS -- which
 * would abort normalization of a whole page over one malformed transaction, wedging
 * sync on every retry of that page. Token amounts are unsigned integers by protocol;
 * anything else returns null and the instruction is skipped, honoring the module
 * contract that hostile shapes produce no events rather than a throw.
 */
const safeAmount = (v: string | null): bigint | null =>
  v !== null && /^\d+$/.test(v) ? BigInt(v) : null;

interface WireInstruction {
  readonly program: string | null;
  readonly programId: string | null;
  readonly type: string | null;
  readonly info: Record<string, unknown> | null;
  /** Raw memo text, for spl-memo whose `parsed` is the string itself. */
  readonly parsedString: string | null;
}

function readInstruction(v: unknown): WireInstruction | null {
  if (!isRecord(v)) return null;
  const parsed = v['parsed'];
  return {
    program: str(v['program']),
    programId: str(v['programId']),
    type: isRecord(parsed) ? str(parsed['type']) : null,
    info: isRecord(parsed) && isRecord(parsed['info']) ? (parsed['info'] as Record<string, unknown>) : null,
    parsedString: str(parsed),
  };
}

interface TokenAccountMeta {
  readonly mint: string | null;
  readonly owner: string | null;
  readonly decimals: number | null;
}

/**
 * Normalize one transaction for one watched address.
 *
 * Emits only value movements that touch the watched address. A transfer between two
 * accounts the watched address owns is an internal move, not income or an expense, and
 * is skipped -- booking it as `in` would inflate the income statement.
 */
export function normalizeTransaction(tx: RawTransaction, watchedAddress: Address): readonly ChainEvent[] {
  const raw = tx.raw;
  if (!isRecord(raw)) return [];
  const transaction = isRecord(raw['transaction']) ? raw['transaction'] : null;
  const message = transaction && isRecord(transaction['message']) ? transaction['message'] : null;
  if (!message) return [];
  const meta = isRecord(raw['meta']) ? raw['meta'] : null;
  const succeeded = (meta?.['err'] ?? null) === null;

  // -- account keys ---------------------------------------------------------
  const accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }> = [];
  if (Array.isArray(message['accountKeys'])) {
    for (const k of message['accountKeys']) {
      if (!isRecord(k)) continue;
      const pubkey = str(k['pubkey']);
      if (pubkey) accountKeys.push({ pubkey, signer: k['signer'] === true, writable: k['writable'] === true });
    }
  }

  // -- token account metadata from pre/post balances ------------------------
  // Post wins over pre so a freshly created ATA (absent pre) still resolves; pre fills
  // in accounts that were emptied and closed in this very transaction.
  const tokenAccounts = new Map<string, TokenAccountMeta>();
  const mints = new Set<string>();
  for (const side of ['preTokenBalances', 'postTokenBalances'] as const) {
    const balances = meta?.[side];
    if (!Array.isArray(balances)) continue;
    for (const b of balances) {
      if (!isRecord(b)) continue;
      const index = typeof b['accountIndex'] === 'number' ? b['accountIndex'] : null;
      const pubkey = index !== null ? accountKeys[index]?.pubkey : undefined;
      if (!pubkey) continue;
      const ui = isRecord(b['uiTokenAmount']) ? b['uiTokenAmount'] : null;
      const mint = str(b['mint']);
      if (mint) mints.add(mint);
      tokenAccounts.set(pubkey, {
        mint,
        owner: str(b['owner']),
        decimals: ui && typeof ui['decimals'] === 'number' ? ui['decimals'] : null,
      });
    }
  }

  // -- flatten instructions in execution order, with endpoint-stable indices --
  // (module comment, fact 3: top-level keeps its message position; inner gets
  // (parent+1)*1024 + offset, so missing inner data can never renumber anything.)
  const flattened: Array<{ readonly ix: WireInstruction; readonly index: number }> = [];
  const topLevel = Array.isArray(message['instructions']) ? message['instructions'] : [];
  const innerGroups = new Map<number, unknown[]>();
  const inner = meta?.['innerInstructions'];
  if (Array.isArray(inner)) {
    for (const group of inner) {
      if (!isRecord(group) || typeof group['index'] !== 'number') continue;
      if (Array.isArray(group['instructions'])) innerGroups.set(group['index'], group['instructions']);
    }
  }
  for (let i = 0; i < topLevel.length; i += 1) {
    const ix = readInstruction(topLevel[i]);
    if (ix) flattened.push({ ix, index: i });
    const innerList = innerGroups.get(i) ?? [];
    for (let j = 0; j < innerList.length; j += 1) {
      const parsed = readInstruction(innerList[j]);
      if (parsed) flattened.push({ ix: parsed, index: (i + 1) * INNER_INDEX_BASE + j });
    }
  }

  // -- memo (transaction-level; applies to every event in the transaction) --
  const memoTexts = flattened
    .filter(({ ix }) => ix.program === 'spl-memo' && ix.parsedString !== null)
    .map(({ ix }) => ix.parsedString as string);
  const memo = memoTexts.length > 0 ? memoTexts.join('\n') : null;

  // -- candidate Solana Pay references (see module comment, fact 1) ---------
  const programIds = new Set(
    flattened.map(({ ix }) => ix.programId).filter((id): id is string => id !== null),
  );
  const references: ReferenceKey[] = accountKeys
    .filter(
      (k) =>
        !k.signer &&
        !k.writable &&
        !KNOWN_PROGRAMS.has(k.pubkey) &&
        !programIds.has(k.pubkey) &&
        !mints.has(k.pubkey) &&
        k.pubkey !== watchedAddress,
    )
    .map((k) => asReferenceKey(k.pubkey));

  // -- extract value movements ----------------------------------------------
  const events: ChainEvent[] = [];
  const push = (
    instructionIndex: number,
    direction: 'in' | 'out',
    counterparty: string | null,
    amount: TokenAmount,
  ): void => {
    events.push({
      kind: amount.mint === null ? 'sol-transfer' : 'spl-transfer',
      signature: tx.signature,
      instructionIndex,
      slot: tx.slot,
      blockTime: tx.blockTime,
      watchedAddress,
      counterparty: counterparty === null ? null : asAddress(counterparty),
      direction,
      amount,
      memo,
      references,
      succeeded,
    });
  };

  for (const { ix, index } of flattened) {
    const info = ix.info;
    if (!info) continue;

    if (ix.program === 'system' && (ix.type === 'transfer' || ix.type === 'transferWithSeed')) {
      const source = str(info['source']);
      const destination = str(info['destination']);
      // `lamports` is a JSON number. u64 above 2^53 would already have lost precision
      // in transit; that is ~9.2M SOL in one instruction, beyond v0.1's concern. A
      // non-integer (malformed or precision-lost) value would make BigInt() throw and
      // abort the page -- skip the instruction instead.
      const rawLamports = info['lamports'];
      const lamports =
        typeof rawLamports === 'number' && Number.isSafeInteger(rawLamports) && rawLamports >= 0
          ? BigInt(rawLamports)
          : null;
      if (source === null || destination === null || lamports === null) continue;
      if (source === watchedAddress && destination === watchedAddress) continue; // internal move
      if (source !== watchedAddress && destination !== watchedAddress) continue;
      const direction = destination === watchedAddress ? 'in' : 'out';
      push(index, direction, direction === 'in' ? source : destination, {
        raw: lamports,
        decimals: 9,
        mint: null,
        symbol: 'SOL',
      });
      continue;
    }

    // Token-2022 `transferCheckedWithFee` (transfer-fee extension) is deliberately NOT
    // handled: the recipient nets tokenAmount minus feeAmount, and booking the gross
    // as income would overstate turnover. Token-2022 edge cases are deferred
    // (PROJECT.md line 126) -- when they land, this is the branch to extend, with
    // net-of-fee semantics decided explicitly rather than implied.
    if (ix.program === 'spl-token' && (ix.type === 'transfer' || ix.type === 'transferChecked')) {
      const source = str(info['source']);
      const destination = str(info['destination']);
      if (source === null || destination === null) continue;

      const authority = str(info['authority']) ?? str(info['multisigAuthority']);
      const sourceMeta = tokenAccounts.get(source);
      const destMeta = tokenAccounts.get(destination);
      // The authority signs for the source account, so it stands in for a missing
      // source-side balance entry; the destination has no such fallback.
      const sourceOwner = sourceMeta?.owner ?? authority;
      const destOwner = destMeta?.owner ?? null;

      const watchedSends = sourceOwner === watchedAddress || source === watchedAddress;
      const watchedReceives = destOwner === watchedAddress || destination === watchedAddress;
      if (watchedSends && watchedReceives) continue; // internal move between own accounts
      if (!watchedSends && !watchedReceives) continue;

      const checkedAmount = isRecord(info['tokenAmount']) ? info['tokenAmount'] : null;
      const amount = safeAmount(
        ix.type === 'transferChecked' ? str(checkedAmount?.['amount']) : str(info['amount']),
      );
      const decimals =
        (checkedAmount && typeof checkedAmount['decimals'] === 'number'
          ? checkedAmount['decimals']
          : null) ??
        sourceMeta?.decimals ??
        destMeta?.decimals ??
        null;
      const mint = str(info['mint']) ?? sourceMeta?.mint ?? destMeta?.mint ?? null;
      // Without a mint the amount cannot be valued or displayed honestly, and without
      // decimals it cannot be rendered. Both resolve from token balances whenever the
      // transfer changed a balance, so in practice this skips nothing real.
      if (amount === null || decimals === null || mint === null) continue;

      const direction = watchedReceives ? 'in' : 'out';
      const counterparty = direction === 'in' ? (sourceOwner ?? source) : (destOwner ?? destination);
      push(index, direction, counterparty, {
        raw: amount,
        decimals,
        mint: asAddress(mint),
        ...(STABLE_MINTS.has(mint) ? { symbol: STABLE_MINTS.get(mint) as string } : {}),
      });
    }
  }

  return events;
}

/**
 * Normalize a batch. Emits in input order; dedup stays with `mergeEvents` in the
 * ingestion pipeline, which already collapses on (signature, instructionIndex).
 */
export function normalizeTransactions(
  txs: readonly RawTransaction[],
  watchedAddress: Address,
): readonly ChainEvent[] {
  const out: ChainEvent[] = [];
  for (const tx of txs) out.push(...normalizeTransaction(tx, watchedAddress));
  return out;
}
