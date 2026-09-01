/**
 * Invoice HTML for expo-print (T19's render half).
 *
 * Core owns the numbers (InvoiceDocModel arrives with amounts already formatted from
 * exact bigints); this module owns nothing but layout. Pure string -> string so the
 * whole page is testable in Node without a PDF engine anywhere in the process.
 *
 * Two rules the tests enforce:
 *   - Every model string is escaped. Client names and descriptions are free text,
 *     and the invoice id happens to be base58 *today* -- the renderer must not bet
 *     the page's integrity on that staying true.
 *   - The QR SVG is embedded verbatim. It is generated locally from the pay URL
 *     (adapters/docs.ts), never from user text, and escaping it would break it.
 *
 * No external resources of any kind: the app is offline-first, and the produced PDF
 * gets printed and shared (S3 scans a *shared* PDF) -- a page that phones home for a
 * font or an image would render blank boxes exactly when it matters. Everything is
 * system fonts and inline SVG.
 *
 * The due date goes through the SAME formatDueDate the screens use, in device-local
 * time on purpose: the model's dueDate is UnixSeconds chosen as local end-of-day on
 * this very device, so the PDF and the invoice list can never show different days.
 */
import type { InvoiceDocModel } from '@local-books/core';
import { formatDueDate } from '../ui/format.js';

/** The five characters that let text become markup. Applied to every model string. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Print-safe CSS. A4 with generous margins; table rows keep themselves whole across
 * page breaks; long base58 strings (addresses, references, the pay URL) wrap instead
 * of clipping -- T19's acceptance is "no clipped content", and a URL that loses its
 * tail is a payment that cannot be made.
 */
const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  body {
    margin: 0;
    font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a22;
  }
  h1 { font-size: 20pt; margin: 0 0 2mm; }
  .meta { margin: 0 0 1mm; font-size: 10pt; color: #55555f; }
  .client { font-size: 13pt; font-weight: 600; margin: 6mm 0 1mm; }
  .mono { font-family: ui-monospace, Menlo, 'Courier New', monospace; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; margin: 8mm 0 6mm; }
  tr { page-break-inside: avoid; }
  th, td { padding: 2.5mm 2mm; text-align: left; border-bottom: 0.3mm solid #d8d8e0; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.03em; color: #55555f; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.desc { word-break: break-word; }
  tfoot td { border-bottom: none; border-top: 0.5mm solid #1a1a22; font-weight: 700; }
  .pay { page-break-inside: avoid; margin-top: 8mm; }
  .pay h2 { font-size: 12pt; margin: 0 0 3mm; }
  .qr { width: 52mm; margin: 0 0 3mm; }
  .qr svg { width: 52mm; height: 52mm; display: block; }
  .hint { font-size: 10pt; color: #55555f; margin: 0 0 2mm; }
  .url { font-size: 8pt; margin: 0 0 4mm; }
  .chain { font-size: 8pt; color: #55555f; margin: 0 0 1mm; }
`;

/** Complete printable document for one invoice. `qrSvg` is trusted local output. */
export function invoiceHtml(model: InvoiceDocModel, qrSvg: string): string {
  const symbol = escapeHtml(model.tokenSymbol);

  const rows = model.lines
    .map(
      (line) => `
      <tr>
        <td class="desc">${escapeHtml(line.description)}</td>
        <td class="num">${escapeHtml(String(line.quantity))}</td>
        <td class="num">${escapeHtml(line.unitAmount)}</td>
        <td class="num">${escapeHtml(line.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${STYLE}</style>
</head>
<body>
  <h1>Invoice</h1>
  <p class="meta">Invoice <span class="mono">${escapeHtml(model.invoiceId)}</span></p>
  <p class="meta">Due ${escapeHtml(formatDueDate(model.dueDate))}</p>
  <p class="client">${escapeHtml(model.clientName)}</p>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit price (${symbol})</th>
        <th class="num">Amount (${symbol})</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">Total due</td>
        <td class="num">${escapeHtml(model.total)} ${symbol}</td>
      </tr>
    </tfoot>
  </table>

  <section class="pay">
    <h2>How to pay</h2>
    <div class="qr">${qrSvg}</div>
    <p class="hint">Scan with a Solana wallet — the amount and payment reference fill in for you.</p>
    <p class="hint">No camera? Open this link in a wallet instead:</p>
    <p class="url mono">${escapeHtml(model.payUrl)}</p>
    <p class="chain">Pay to: <span class="mono">${escapeHtml(model.payTo)}</span></p>
    <p class="chain">Payment reference: <span class="mono">${escapeHtml(model.reference)}</span></p>
  </section>
</body>
</html>`;
}
