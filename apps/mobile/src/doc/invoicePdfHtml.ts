/**
 * RenderableDoc -> complete printable HTML, QR included (T19/T20).
 *
 * Pure: no Expo, no native modules, so the Node test suite exercises the whole
 * page (test/invoiceHtml.test.ts). The DocPort adapter (adapters/docs.ts) hands the
 * result to expo-print and nothing else.
 *
 * The QR is produced on-device by the `qrcode` package -- pure JS, no canvas, no
 * network -- as an SVG string inlined into the HTML. Never an external image: the
 * app is offline, and the PDF must scan wherever it ends up (S3 verifies scanning
 * from a printed/shared copy). Error correction M and a 2-module quiet zone are the
 * spec-recommended defaults for a payment QR of this size.
 */
import QRCode from 'qrcode';
import type { InvoiceDocModel, RenderableDoc } from '@local-books/core';
import { invoiceHtml } from './invoiceHtml.js';

/**
 * Throws on anything but an invoice: income-statement PDFs are explicitly on the
 * post-grant deferred list, and a stub that "just needs wiring" is how scope drifts
 * (see ports/index.ts).
 */
export async function invoicePdfHtml(doc: RenderableDoc): Promise<string> {
  if (doc.kind !== 'invoice') {
    throw new Error(
      `Only invoices render as PDFs in v0.1 (got '${doc.kind}'). ` +
        `Income-statement documents are on the post-grant list; reports export as CSV.`,
    );
  }
  if (doc.qrPayload === undefined || doc.qrPayload === '') {
    throw new Error(
      `Invoice document '${doc.title}' has no QR payload. Refusing to render an ` +
        `invoice with no way to pay it -- this is a bug in the caller, not a layout choice.`,
    );
  }
  const qrSvg = await QRCode.toString(doc.qrPayload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
  });
  // The kind check above is the discriminant: a RenderableDoc of kind 'invoice' is
  // an InvoiceRenderableDoc, whose model core typed for us.
  return invoiceHtml(doc.model as InvoiceDocModel, qrSvg);
}
