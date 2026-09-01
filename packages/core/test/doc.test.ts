/**
 * Invoice document model (T19's core half). What matters: line totals computed in
 * bigint with fixtures a float implementation cannot survive, a document that refuses
 * to render when its own numbers disagree, and a QR payload that is literally the
 * same string as the printed pay URL -- the page can never ask for a different
 * number than it displays.
 */
import { describe, expect, it } from 'vitest';
import { invoiceDoc, InvoiceTotalMismatchError } from '../src/doc/index.js';
import { transferRequestUrl } from '../src/pay/index.js';
import { asAddress, asReferenceKey, asUnixSeconds } from '../src/types/index.js';
import type { InvoiceCreatedOp, TokenAmount } from '../src/types/index.js';

const PAY_TO = asAddress('mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX1ncyp98M9W');
const USDC = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const REF = asReferenceKey('Ref1111111111111111111111111111111111111111');

const usdc = (raw: bigint): TokenAmount => ({ raw, decimals: 6, mint: USDC, symbol: 'USDC' });

const op = (over: Partial<InvoiceCreatedOp> = {}): InvoiceCreatedOp => ({
  type: 'invoice-created',
  id: 'op-1',
  at: asUnixSeconds(1_756_000_000),
  invoiceId: 'inv-001',
  clientName: 'Acme Ltd',
  lineItems: [{ description: 'Design work', quantity: 1, unitAmount: 100_000_000n }],
  total: usdc(100_000_000n),
  dueDate: asUnixSeconds(1_756_600_000),
  reference: REF,
  payTo: PAY_TO,
  ...over,
});

describe('invoiceDoc', () => {
  it('computes line totals in bigint -- exact digits where a float diverges', () => {
    // Mirrors pay.test.ts's float-killers: Number(123456789123456789) already rounds
    // to ...784, and 3x that lands on ...370370352. The bigint product ends ...367;
    // asserting every digit means a float implementation cannot pass.
    const doc = invoiceDoc(
      op({
        lineItems: [{ description: 'Big batch', quantity: 3, unitAmount: 123_456_789_123_456_789n }],
        total: usdc(370_370_367_370_370_367n),
      }),
    );
    expect(doc.model.lines).toEqual([
      {
        description: 'Big batch',
        quantity: 3,
        unitAmount: '123456789123.456789',
        lineTotal: '370370367370.370367',
      },
    ]);
    expect(doc.model.total).toBe('370370367370.370367');
  });

  it('refuses to render when line items no longer sum to the stored total', () => {
    // Off by one smallest unit -- the corruption a rounding bug would introduce.
    const broken = op({ total: usdc(100_000_001n) });
    expect(() => invoiceDoc(broken)).toThrow(InvoiceTotalMismatchError);
    expect(() => invoiceDoc(broken)).toThrow(/inv-001/);
  });

  it('qrPayload and payUrl are byte-identical to transferRequestUrl', () => {
    // Compared literally against the pay/ builder, not against a pinned string: the
    // invariant is that the QR, the printed fallback URL, and T20's URL logic can
    // never drift apart -- one source of truth for what the wallet is asked.
    const invoice = op();
    const doc = invoiceDoc(invoice, { label: 'Local Books', message: 'Invoice inv-001' });
    const expected = transferRequestUrl({
      recipient: PAY_TO,
      amount: invoice.total,
      reference: REF,
      label: 'Local Books',
      message: 'Invoice inv-001',
    });
    expect(doc.qrPayload).toBe(expected);
    expect(doc.model.payUrl).toBe(expected);
  });

  it('label and message enter the URL only when passed', () => {
    const invoice = op();
    const bare = invoiceDoc(invoice);
    expect(bare.qrPayload).toBe(
      transferRequestUrl({ recipient: PAY_TO, amount: invoice.total, reference: REF }),
    );
    expect(bare.qrPayload).not.toContain('label=');
    expect(bare.qrPayload).not.toContain('message=');

    const labelled = invoiceDoc(invoice, { label: 'Local Books' });
    expect(labelled.qrPayload).toContain('label=Local%20Books');
    expect(labelled.qrPayload).not.toContain('message=');
  });

  it('tokenSymbol falls back symbol -> mint -> SOL', () => {
    expect(invoiceDoc(op()).model.tokenSymbol).toBe('USDC');

    const unknownMint = op({ total: { raw: 100_000_000n, decimals: 6, mint: USDC } });
    expect(invoiceDoc(unknownMint).model.tokenSymbol).toBe(USDC);

    const nativeSol = op({ total: { raw: 100_000_000n, decimals: 9, mint: null } });
    expect(invoiceDoc(nativeSol).model.tokenSymbol).toBe('SOL');
  });

  it('total is the trimmed exact string, never a padded or rounded one', () => {
    const doc = invoiceDoc(
      op({
        lineItems: [{ description: 'Design work', quantity: 1, unitAmount: 1_500_000n }],
        total: usdc(1_500_000n),
      }),
    );
    expect(doc.model.total).toBe('1.5');
    expect(doc.model.lines[0]?.lineTotal).toBe('1.5');
  });

  it('title carries the client name, and the model carries the payment identity', () => {
    const doc = invoiceDoc(op({ clientName: 'ჩემი კლიენტი' }));
    expect(doc.title).toBe('Invoice — ჩემი კლიენტი');
    expect(doc.kind).toBe('invoice');
    expect(doc.model.invoiceId).toBe('inv-001');
    expect(doc.model.payTo).toBe(PAY_TO);
    expect(doc.model.reference).toBe(REF);
    expect(doc.model.dueDate).toBe(asUnixSeconds(1_756_600_000));
  });
});
