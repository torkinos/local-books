/**
 * T19/T20 render half, tested where Node can see it: models built by the REAL
 * core invoiceDoc (not hand-faked), pushed through the same invoiceHtml/
 * invoicePdfHtml the device uses. Only printToFileAsync/shareAsync stay untested
 * -- they are the device boundary, same stance as storage/opsqlite.ts.
 */
import { describe, expect, it } from 'vitest';
import type { InvoiceCreatedOp, RenderableDoc, TokenAmount } from '@local-books/core';
import { asAddress, asReferenceKey, asUnixSeconds, invoiceDoc } from '@local-books/core';
import { invoiceHtml } from '../src/doc/invoiceHtml.js';
import { invoicePdfHtml } from '../src/adapters/docs.js';
import { formatDueDate } from '../src/ui/format.js';

const PAY_TO = asAddress('mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX1ncyp98M9W');
const USDC = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const REF = asReferenceKey('Ref1111111111111111111111111111111111111111');

const usdc = (raw: bigint): TokenAmount => ({ raw, decimals: 6, mint: USDC, symbol: 'USDC' });

const op = (over: Partial<InvoiceCreatedOp> = {}): InvoiceCreatedOp => ({
  type: 'invoice-created',
  id: 'op-1',
  at: asUnixSeconds(1_756_000_000),
  invoiceId: 'inv-8fKtQ3vZm1',
  clientName: 'Acme Ltd',
  lineItems: [
    { description: 'Website redesign', quantity: 2, unitAmount: 1_250_500_000n },
    { description: 'Hosting', quantity: 1, unitAmount: 1n },
  ],
  total: usdc(2_501_000_001n),
  dueDate: asUnixSeconds(1_758_000_000),
  reference: REF,
  payTo: PAY_TO,
  ...over,
});

/** Distinctive enough that an accidental double-embed or escape cannot hide. */
const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="qr-sentinel"/></svg>';

describe('invoiceHtml', () => {
  it('escapes hostile free text and keeps non-Latin text intact', () => {
    const doc = invoiceDoc(
      op({
        clientName: '<script>alert(1)</script>',
        lineItems: [
          { description: 'Fee & "charges" <b>', quantity: 1, unitAmount: 1_000_000n },
          { description: 'ჩემი წიგნები', quantity: 1, unitAmount: 1_000_000n },
        ],
        total: usdc(2_000_000n),
      }),
    );
    const html = invoiceHtml(doc.model, QR_SVG);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Fee &amp; &quot;charges&quot; &lt;b&gt;');
    // The beachhead market's alphabet must survive escaping untouched.
    expect(html).toContain('ჩემი წიგნები');
  });

  it('embeds the QR svg exactly once, verbatim', () => {
    // Verbatim matters: the svg is full of quotes, and an over-eager escape pass
    // would leave a QR that renders as text instead of squares.
    const html = invoiceHtml(invoiceDoc(op()).model, QR_SVG);
    expect(html.split(QR_SVG)).toHaveLength(2);
  });

  it('prints every line amount and the total as the exact strings core produced', () => {
    const html = invoiceHtml(invoiceDoc(op()).model, QR_SVG);
    expect(html).toContain('>1250.5<'); // unit price
    expect(html).toContain('>2501<'); // line total, trimmed whole number
    expect(html).toContain('>0.000001<'); // one smallest unit, never 1e-6
    expect(html).toContain('2501.000001 USDC'); // total row with the symbol
  });

  it('never leaks undefined, NaN, or a stringified object into the page', () => {
    const html = invoiceHtml(invoiceDoc(op()).model, QR_SVG);
    for (const poison of ['undefined', 'NaN', '[object']) {
      expect(html).not.toContain(poison);
    }
  });

  it('prints the pay URL (escaped) and the reference as the wallet-less fallback', () => {
    const model = invoiceDoc(op()).model;
    const html = invoiceHtml(model, QR_SVG);
    // The URL joins params with '&', so its in-page form differs only by &amp;.
    expect(html).toContain(model.payUrl.replace(/&/g, '&amp;'));
    expect(html).toContain(model.reference);
    expect(html).toContain(model.payTo);
  });

  it('renders the due date with the same helper the screens use', () => {
    const model = invoiceDoc(op()).model;
    const html = invoiceHtml(model, QR_SVG);
    expect(html).toContain(`Due ${formatDueDate(model.dueDate)}`);
  });
});

describe('invoicePdfHtml', () => {
  it('rejects a non-invoice document with a clear error', async () => {
    const statement: RenderableDoc = { title: 'Income 2026', kind: 'income-statement', model: {} };
    await expect(invoicePdfHtml(statement)).rejects.toThrow(/Only invoices/);
  });

  it('rejects an invoice document that lost its QR payload', async () => {
    const doc = invoiceDoc(op());
    const stripped: RenderableDoc = { title: doc.title, kind: 'invoice', model: doc.model };
    await expect(invoicePdfHtml(stripped)).rejects.toThrow(/QR payload/);
  });

  it('generates a real inline svg QR (qrcode runs under plain Node)', async () => {
    const html = await invoicePdfHtml(invoiceDoc(op()));
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('round-trips a payload with URL-special characters into the page', async () => {
    const doc = invoiceDoc(op(), { label: 'ჩემი წიგნები', message: 'Invoice #1 & thanks' });
    // The payload itself is percent-encoded by core...
    expect(doc.qrPayload).toContain('label=%E1%83%A9');
    expect(doc.qrPayload).toContain('message=Invoice%20%231%20%26%20thanks');
    // ...and the printed fallback is that same string, differing only by &amp;.
    const html = await invoicePdfHtml(doc);
    expect(html).toContain(doc.model.payUrl.replace(/&/g, '&amp;'));
    expect(html).toContain('<svg');
  });
});

describe('invoiceHtml — every model string is escaped, not just the friendly ones', () => {
  it('no model field can smuggle raw markup into the document', () => {
    // The renderer must not assume core sanitized anything: hostile markup goes in
    // EVERY string field, each with a unique marker, and none may survive raw.
    const hostile = (marker: string): string => `<i onload=x>${marker}</i>&"'`;
    const model = {
      invoiceId: hostile('F-ID'),
      clientName: hostile('F-CLIENT'),
      lines: [
        {
          description: hostile('F-DESC'),
          quantity: 1,
          unitAmount: hostile('F-UNIT'),
          lineTotal: hostile('F-LINE'),
        },
      ],
      total: hostile('F-TOTAL'),
      tokenSymbol: hostile('F-SYMBOL'),
      dueDate: asUnixSeconds(1_758_000_000),
      payTo: asAddress(hostile('F-PAYTO')),
      reference: asReferenceKey(hostile('F-REF')),
      payUrl: hostile('F-URL'),
    };

    const html = invoiceHtml(model, QR_SVG);
    const body = html.replace(QR_SVG, ''); // the QR is the one trusted embed

    // Escaped text may legally contain the WORD onload; what must never appear is
    // an actual tag open — '<i' raw is the smuggle, '&lt;i onload…' is safe text.
    expect(body).not.toContain('<i');
    for (const marker of [
      'F-ID',
      'F-CLIENT',
      'F-DESC',
      'F-UNIT',
      'F-LINE',
      'F-TOTAL',
      'F-SYMBOL',
      'F-PAYTO',
      'F-REF',
      'F-URL',
    ]) {
      expect(body).toContain(`&lt;i onload=x&gt;${marker}&lt;/i&gt;&amp;`);
    }
  });
});
