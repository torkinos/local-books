/**
 * Document models (T19's core half).
 *
 * Core builds *what* a document says; the app decides how it looks. The renderer
 * behind DocPort (expo-print today, whatever the desktop surface uses later) receives
 * a RenderableDoc and owns layout entirely -- nothing here knows about HTML, fonts,
 * or page sizes, and the purity guard keeps it that way.
 *
 * Amounts are formatted here, in core, from the exact bigints -- the renderer gets
 * strings it can only print, not numbers it could be tempted to do arithmetic on.
 */
import type { RenderableDoc } from '../ports/index.js';
import type { Address, InvoiceCreatedOp, ReferenceKey, UnixSeconds } from '../types/index.js';
import { transferRequestUrl } from '../pay/index.js';
import { formatUnitsTrimmed } from '../value/index.js';

export interface InvoiceDocLine {
  readonly description: string;
  readonly quantity: number;
  /** Unit price in user units, exact decimal string (never a float). */
  readonly unitAmount: string;
  /** quantity x unitAmount, computed in bigint. */
  readonly lineTotal: string;
}

export interface InvoiceDocModel {
  readonly invoiceId: string;
  readonly clientName: string;
  readonly lines: readonly InvoiceDocLine[];
  /** Invoice total in user units, exact decimal string. */
  readonly total: string;
  /** Display symbol for the invoice token (falls back to the mint, then SOL). */
  readonly tokenSymbol: string;
  /**
   * Due date as stored on the op (local end-of-day at creation). Left as seconds so
   * the renderer formats it in the device's own calendar -- the same device that
   * picked the date -- rather than core guessing a timezone.
   */
  readonly dueDate: UnixSeconds;
  readonly payTo: Address;
  readonly reference: ReferenceKey;
  /** The Solana Pay transfer-request URL; printed under the QR as a fallback. */
  readonly payUrl: string;
}

export interface InvoiceRenderableDoc extends RenderableDoc {
  readonly kind: 'invoice';
  readonly model: InvoiceDocModel;
  readonly qrPayload: string;
}

/** A line-item sum that disagrees with the stored total -- a corrupted op, not data. */
export class InvoiceTotalMismatchError extends Error {
  constructor(invoiceId: string) {
    super(
      `Invoice ${invoiceId}: line items no longer sum to the stored total. Refusing to ` +
        `render a document whose own numbers disagree.`,
    );
    this.name = 'InvoiceTotalMismatchError';
  }
}

/**
 * Build the renderable model for one invoice.
 *
 * The QR payload and the printed total come from the same TokenAmount, so the
 * document can never ask for a different number than it displays. `label` and
 * `message` are optional wallet-display strings; the URL stays minimal when they are
 * absent (less to leak on a printed page, and byte-stable output stays byte-stable).
 */
export function invoiceDoc(
  invoice: InvoiceCreatedOp,
  opts: { readonly label?: string; readonly message?: string } = {},
): InvoiceRenderableDoc {
  const decimals = invoice.total.decimals;

  let lineSum = 0n;
  const lines = invoice.lineItems.map((item) => {
    const lineTotal = BigInt(item.quantity) * item.unitAmount;
    lineSum += lineTotal;
    return {
      description: item.description,
      quantity: item.quantity,
      unitAmount: formatUnitsTrimmed(item.unitAmount, decimals),
      lineTotal: formatUnitsTrimmed(lineTotal, decimals),
    };
  });
  if (lineSum !== invoice.total.raw) throw new InvoiceTotalMismatchError(invoice.invoiceId);

  const payUrl = transferRequestUrl({
    recipient: invoice.payTo,
    amount: invoice.total,
    reference: invoice.reference,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.message !== undefined ? { message: opts.message } : {}),
  });

  return {
    title: `Invoice — ${invoice.clientName}`,
    kind: 'invoice',
    qrPayload: payUrl,
    model: {
      invoiceId: invoice.invoiceId,
      clientName: invoice.clientName,
      lines,
      total: formatUnitsTrimmed(invoice.total.raw, decimals),
      tokenSymbol: invoice.total.symbol ?? invoice.total.mint ?? 'SOL',
      dueDate: invoice.dueDate,
      payTo: invoice.payTo,
      reference: invoice.reference,
      payUrl,
    },
  };
}
