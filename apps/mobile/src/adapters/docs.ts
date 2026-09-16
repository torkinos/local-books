/**
 * DocPort over expo-print + expo-sharing (T19/T20 device half).
 *
 * Same stance as storage/opsqlite.ts: the two DocPort methods are the ONLY code that
 * touches these Expo modules, and they are deliberately thin -- device-bound and
 * untested. Everything decidable (kind gating, QR generation, the whole page) lives
 * in doc/invoicePdfHtml + doc/invoiceHtml, where the Node test suite exercises it.
 *
 * The Expo modules are imported STATICALLY, on purpose. The first draft imported
 * them with `import()` inside the two methods so this file could be loaded under
 * vitest; on the phone that turned every "Share PDF" into a Metro bundle-splitting
 * request, and with the dev client disconnected from Metro the load failed inside
 * Expo's split-bundle loader with "cannot read property 'reload' of undefined"
 * (2026-09-15 device pass). Static imports put expo-print/expo-sharing in the main
 * bundle like every other native module; the test-time boundary is now the module
 * split above instead.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { DocPort, RenderableDoc } from '@local-books/core';
import { invoicePdfHtml } from '../doc/invoicePdfHtml.js';

export function makeDocPort(): DocPort {
  return {
    async renderPdf(doc: RenderableDoc): Promise<{ readonly uri: string }> {
      const html = await invoicePdfHtml(doc);
      const { uri } = await Print.printToFileAsync({ html });
      return { uri };
    },

    async share(uri: string, opts?: { readonly mimeType?: string }): Promise<void> {
      // mimeType steers the Android intent chooser; iOS infers from the .pdf
      // extension expo-print gives the file.
      await Sharing.shareAsync(uri, { mimeType: opts?.mimeType ?? 'application/pdf' });
    },
  };
}
