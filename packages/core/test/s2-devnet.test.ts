/**
 * S2 (spikes/02-reference-detection.md), pinned: four real devnet transactions from
 * the 2026-09-15 device run, exactly as getTransaction served them.
 *
 * What they prove, against the real normalizer and matcher:
 *   - a Solana Pay QR payment carries the invoice reference and matches (tier a);
 *   - only the FIRST payment into a wallet names the wallet (its ATA-create does);
 *     every later payment names the token account alone -- the wire fact behind D19
 *     (3 of the 4 payments in this run were invisible to owner-only paging);
 *   - a direct transfer without the QR carries no reference and cannot match --
 *     the tier-b gap, sized at 1 of 3 payments in this run.
 */
import { describe, expect, it } from 'vitest';
import { amountAgreement, matchByReference } from '../src/match/index.js';
import { normalizeTransactions } from '../src/normalize/index.js';
import type { RawTransaction } from '../src/ports/index.js';
import type { InvoiceCreatedOp } from '../src/types/index.js';
import { asAddress, asReferenceKey, asSignature, asUnixSeconds } from '../src/types/index.js';
import {
  S2_A2_QR_PAYMENT,
  S2_A_FIRST_QR_PAYMENT_ATA_CREATE,
  S2_B_SECOND_QR_PAYMENT,
  S2_C_DIRECT_TRANSFER,
} from './fixtures/s2/index.js';

const WATCHED = asAddress('EFhBHyksYoBLSQSa71N1wMZ7cNyP2x68XtFr1uaMRjEy');
const PAYER = asAddress('CuxRzb13MUpQyk8riEGgJwE16jXRDFuYptQN67P3dkmY');
/** WATCHED's associated token account for devnet USDC, as the chain created it. */
const WATCHED_USDC_ACCOUNT = '9Qo8ErTa2nHujJwM1GppBoCb2v6tGvzcH1UMcuYaYBgk';
const USDC_DEVNET = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

type Fixture = {
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: number;
  readonly raw: unknown;
};

const tx = (fixture: Fixture): RawTransaction => ({
  signature: asSignature(fixture.signature),
  slot: fixture.slot,
  blockTime: asUnixSeconds(fixture.blockTime),
  raw: fixture.raw,
});

const accountKeys = (fixture: Fixture): readonly string[] =>
  (fixture.raw as { transaction: { message: { accountKeys: readonly { pubkey: string }[] } } })
    .transaction.message.accountKeys.map((k) => k.pubkey);

const invoice = (reference: string, raw: bigint): InvoiceCreatedOp => ({
  type: 'invoice-created',
  id: `inv-${reference}`,
  at: asUnixSeconds(1_789_460_000),
  invoiceId: reference,
  clientName: 'Acme',
  lineItems: [{ description: 'Design', quantity: 1, unitAmount: raw }],
  total: { raw, decimals: 6, mint: USDC_DEVNET, symbol: 'USDC' },
  dueDate: asUnixSeconds(1_790_000_000),
  reference: asReferenceKey(reference),
  payTo: WATCHED,
});

const REF_A = 'E1NcgdMEVzBLbuPvdNarARrCsdhn4gcF5HD9ViYUoBq9';
const REF_A2 = '2vhyWoqeYsEoDyuFBBWx3fEyn1b8NGeryrwbMmW55tSR';
const REF_B = 'HopAmorzvr66NvpUmWcb3ShBxTMiFcDkjSr1s4b9V3U6';

describe('S2 devnet run: QR payments match by reference', () => {
  it.each([
    ['first payment (creates the token account)', S2_A_FIRST_QR_PAYMENT_ATA_CREATE, REF_A, 1_000_000n],
    ['second QR payment', S2_A2_QR_PAYMENT, REF_A2, 1_000_000n],
    ['third QR payment', S2_B_SECOND_QR_PAYMENT, REF_B, 2_000_000n],
  ])('%s: one incoming USDC event carrying the reference, auto-applicable', (_name, fixture, reference, raw) => {
    const events = normalizeTransactions([tx(fixture)], WATCHED);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({
      kind: 'spl-transfer',
      direction: 'in',
      watchedAddress: WATCHED,
      counterparty: PAYER,
      succeeded: true,
      amount: { raw, decimals: 6, mint: USDC_DEVNET, symbol: 'USDC' },
    });
    expect(event.references).toContain(reference);

    const candidates = matchByReference(events, [invoice(reference, raw)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ invoiceId: reference, tier: 'reference', autoApplicable: true });
    expect(amountAgreement(event, invoice(reference, raw))).toBe('exact');
  });
});

describe('S2 devnet run: the wire fact behind D19', () => {
  it('only the ATA-creating first payment names the wallet; later ones name the token account alone', () => {
    expect(accountKeys(S2_A_FIRST_QR_PAYMENT_ATA_CREATE)).toContain(WATCHED);
    for (const fixture of [S2_A2_QR_PAYMENT, S2_B_SECOND_QR_PAYMENT, S2_C_DIRECT_TRANSFER]) {
      expect(accountKeys(fixture)).not.toContain(WATCHED);
      expect(accountKeys(fixture)).toContain(WATCHED_USDC_ACCOUNT);
    }
  });

  it('normalizing under the wallet still books them to the wallet (token-balance owner resolves it)', () => {
    for (const fixture of [S2_A2_QR_PAYMENT, S2_B_SECOND_QR_PAYMENT, S2_C_DIRECT_TRANSFER]) {
      const [event] = normalizeTransactions([tx(fixture)], WATCHED);
      expect(event?.watchedAddress).toBe(WATCHED);
      expect(event?.direction).toBe('in');
    }
  });
});

describe('S2 devnet run: a direct transfer is the tier-b gap', () => {
  it('books the deposit but carries no reference, so nothing can match it', () => {
    const events = normalizeTransactions([tx(S2_C_DIRECT_TRANSFER)], WATCHED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      direction: 'in',
      counterparty: PAYER,
      amount: { raw: 3_000_000n, decimals: 6, mint: USDC_DEVNET },
      references: [],
    });
    const openInvoices = [invoice(REF_A, 1_000_000n), invoice(REF_B, 2_000_000n), invoice('3usdc-invoice-ref', 3_000_000n)];
    expect(matchByReference(events, openInvoices)).toEqual([]);
  });
});
