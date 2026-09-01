/**
 * DocPort over expo-print + expo-sharing, QR generated locally (T19/T20 device half).
 *
 * Same stance as storage/opsqlite.ts: the two DocPort methods are the ONLY code that
 * touches Expo modules, and they are deliberately thin -- device-bound and untested.
 * Everything decidable (kind gating, QR generation, the whole page) lives in
 * invoicePdfHtml/invoiceHtml, where the Node test suite exercises it.
 *
 * The Expo modules are imported lazily inside those two methods, not at module scope:
 * expo-print/expo-sharing cannot even be *loaded* outside a React Native runtime
 * (their `react-native` export condition resolves to TS source), and a top-level
 * import would drag the device boundary into every test that touches this file.
 *
 * The QR is produced on-device by the `qrcode` package -- pure JS, no canvas, no
 * network -- as an SVG string inlined into the HTML. Never an external image: the
 * app is offline, and the PDF must scan wherever it ends up (S3 verified scanning
 * from a printed/shared copy). Error correction M and a 2-module quiet zone are the
 * spec-recommended defaults for a payment QR of this size.
 */
import QRCode from 'qrcode';
import type { DocPort, InvoiceDocModel, RenderableDoc } from '@local-books/core';
import { invoiceHtml } from '../doc/invoiceHtml.js';

/**
 * RenderableDoc -> complete printable HTML. Throws on anything but an invoice:
 * income-statement PDFs are explicitly on the post-grant deferred list, and a stub
 * that "just needs wiring" is how scope drifts (see ports/index.ts).
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

export function makeDocPort(): DocPort {
  return {
    async renderPdf(doc: RenderableDoc): Promise<{ readonly uri: string }> {
      const html = await invoicePdfHtml(doc);
      const Print = await import('expo-print');
      const { uri } = await Print.printToFileAsync({ html });
      return { uri };
    },

    async share(uri: string, opts?: { readonly mimeType?: string }): Promise<void> {
      const Sharing = await import('expo-sharing');
      // mimeType steers the Android intent chooser; iOS infers from the .pdf
      // extension expo-print gives the file.
      await Sharing.shareAsync(uri, { mimeType: opts?.mimeType ?? 'application/pdf' });
    },
  };
}
