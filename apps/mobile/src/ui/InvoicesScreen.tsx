/**
 * Invoice list: what is open, what is paid, what is overdue -- and, above it, the
 * reference payments automation refused to book (D21).
 *
 * Statuses come from the projection (with withOverdue applied by the App at read
 * time -- overdue is the one bit of view state that changes with no op or event, so
 * it never enters the fold). A paid row names how it was matched: line 81's audit
 * requirement extends to the UI, so a human's tap reads "matched by you" while
 * automation's reads "by reference".
 *
 * The decision list is where D14's four gates hand over: an under- or overpaid
 * invoice, a wrong token, a transaction referencing several invoices, two payments
 * claiming one invoice. "Mark paid" records match-confirmed (via
 * reference-confirmed-by-user); "Not this invoice" records match-rejected, which also
 * bars automation from ever re-proposing the pair (D4). Both are one tap and both
 * are audit-log entries, so the buttons say what they write.
 */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InvoiceView } from '@local-books/core';
import type { PendingMatch } from '../matching.js';
import { formatBlockTime, formatDueDate, formatTokenAmount, shortAddress } from './format.js';
import { pendingReasonLine } from './pendingCopy.js';

export interface InvoicesScreenProps {
  readonly invoices: readonly InvoiceView[];
  /** Reference payments that need a human decision. */
  readonly pending: readonly PendingMatch[];
  /** False with no watched address: an invoice needs somewhere to be paid. */
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  readonly onBack: () => void;
  /** Render the invoice as a PDF (with its Solana Pay QR) and open the share sheet. */
  readonly onShare: (view: InvoiceView) => void;
  readonly onConfirmMatch: (pending: PendingMatch) => void;
  readonly onRejectMatch: (pending: PendingMatch) => void;
  /** A decision is being written; every decision button disables until it lands. */
  readonly deciding: boolean;
  /** invoiceId currently being rendered/shared; its button shows progress, all disable. */
  readonly sharingInvoiceId: string | null;
  /** A failed render/share or a failed decision write. Same banner treatment as the ledger. */
  readonly errorBanner: string | null;
}

export function InvoicesScreen({
  invoices,
  pending,
  canCreate,
  onCreate,
  onBack,
  onShare,
  onConfirmMatch,
  onRejectMatch,
  deciding,
  sharingInvoiceId,
  errorBanner,
}: InvoicesScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} testID="invoices-back">
          <Text style={styles.back}>‹ Ledger</Text>
        </Pressable>
        <Text style={styles.title}>Invoices</Text>
        <Pressable
          style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
          onPress={onCreate}
          disabled={!canCreate}
          testID="new-invoice-button"
        >
          <Text style={styles.createButtonText}>+ New</Text>
        </Pressable>
      </View>

      {errorBanner !== null && (
        <View style={styles.errorBanner} testID="share-error">
          <Text style={styles.errorBannerText}>{errorBanner}</Text>
        </View>
      )}

      <FlatList
        style={styles.list}
        data={invoices}
        keyExtractor={(view) => view.invoice.invoiceId}
        ListHeaderComponent={
          pending.length > 0 ? (
            <View style={styles.pendingSection} testID="pending-matches">
              <Text style={styles.pendingTitle}>Needs your decision</Text>
              {pending.map((item) => (
                <PendingRow
                  key={pendingKey(item)}
                  pending={item}
                  disabled={deciding}
                  onConfirm={onConfirmMatch}
                  onReject={onRejectMatch}
                />
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>
              {canCreate
                ? 'No invoices yet. Create one, share it, and the payment matches itself the ' +
                  'next time the app checks — that is the whole loop.'
                : 'Watch an address first — an invoice needs somewhere to be paid. Go back to ' +
                  'the ledger and tap + Watch.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <InvoiceRow
            view={item}
            onShare={onShare}
            sharing={sharingInvoiceId === item.invoice.invoiceId}
            shareDisabled={sharingInvoiceId !== null}
          />
        )}
      />
    </View>
  );
}

function pendingKey(item: PendingMatch): string {
  const { invoiceId, signature, instructionIndex } = item.candidate;
  return `${invoiceId}|${signature}:${instructionIndex}`;
}

function PendingRow({
  pending,
  disabled,
  onConfirm,
  onReject,
}: {
  readonly pending: PendingMatch;
  readonly disabled: boolean;
  readonly onConfirm: (pending: PendingMatch) => void;
  readonly onReject: (pending: PendingMatch) => void;
}): React.JSX.Element {
  const { invoice, event } = pending;
  const key = pendingKey(pending);
  return (
    <View style={styles.pendingRow} testID={`pending-${key}`}>
      <Text style={styles.client}>
        {invoice.clientName} · {formatTokenAmount(invoice.total)} invoice
      </Text>
      <Text style={styles.pendingReason}>{pendingReasonLine(pending)}</Text>
      <Text style={styles.pendingMeta}>
        {formatBlockTime(event.blockTime)} · from{' '}
        {event.counterparty !== null ? shortAddress(event.counterparty) : 'unknown'}
      </Text>
      <View style={styles.pendingButtons}>
        <Pressable
          style={[styles.decisionButton, styles.decisionSecondary, disabled && styles.disabled]}
          onPress={() => onReject(pending)}
          disabled={disabled}
          testID={`reject-${key}`}
        >
          <Text style={styles.decisionSecondaryText}>Not this invoice</Text>
        </Pressable>
        <Pressable
          style={[styles.decisionButton, styles.decisionPrimary, disabled && styles.disabled]}
          onPress={() => onConfirm(pending)}
          disabled={disabled}
          testID={`confirm-${key}`}
        >
          <Text style={styles.decisionPrimaryText}>Mark paid</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InvoiceRow({
  view,
  onShare,
  sharing,
  shareDisabled,
}: {
  readonly view: InvoiceView;
  readonly onShare: (view: InvoiceView) => void;
  readonly sharing: boolean;
  readonly shareDisabled: boolean;
}): React.JSX.Element {
  const { invoice, status, payments } = view;
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.client}>{invoice.clientName}</Text>
        <Text style={styles.amount}>{formatTokenAmount(invoice.total)}</Text>
        <Text style={styles.due}>
          Due {formatDueDate(invoice.dueDate)}
          {status === 'paid' && payments.length > 0
            ? ` · matched by ${payments[0]!.via === 'reference' ? 'reference' : 'you'}`
            : ''}
        </Text>
      </View>
      <Pressable
        style={[styles.shareButton, shareDisabled && styles.shareButtonDisabled]}
        onPress={() => onShare(view)}
        disabled={shareDisabled}
        testID={`share-invoice-${invoice.invoiceId}`}
      >
        <Text style={styles.shareButtonText}>{sharing ? 'Rendering…' : 'Share PDF'}</Text>
      </Pressable>
      <View style={[styles.badge, badgeStyle[status]]}>
        <Text style={[styles.badgeText, badgeTextStyle[status]]}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 56,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  back: {
    color: '#1f4e9c',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  createButton: {
    backgroundColor: '#1f4e9c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  empty: {
    padding: 32,
    alignItems: 'center',
  },
  emptyBody: {
    fontSize: 13,
    opacity: 0.7,
    textAlign: 'center',
  },
  pendingSection: {
    backgroundColor: '#fff7e6',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8d5a8',
    paddingVertical: 8,
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a5a00',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  pendingRow: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 4,
  },
  pendingReason: {
    fontSize: 13,
  },
  pendingMeta: {
    fontSize: 12,
    opacity: 0.65,
    fontFamily: 'monospace',
  },
  pendingButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  decisionButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  decisionPrimary: {
    backgroundColor: '#1f4e9c',
  },
  decisionPrimaryText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  decisionSecondary: {
    borderWidth: 1,
    borderColor: '#c8c8d0',
  },
  decisionSecondaryText: {
    fontWeight: '600',
    fontSize: 13,
  },
  disabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e2ea',
    gap: 12,
  },
  rowBody: {
    flex: 1,
  },
  client: {
    fontSize: 15,
    fontWeight: '600',
  },
  amount: {
    fontSize: 14,
  },
  due: {
    fontSize: 12,
    opacity: 0.6,
  },
  shareButton: {
    borderWidth: 1,
    borderColor: '#1f4e9c',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  shareButtonDisabled: {
    opacity: 0.4,
  },
  shareButtonText: {
    color: '#1f4e9c',
    fontWeight: '600',
    fontSize: 12,
  },
  errorBanner: {
    backgroundColor: '#f8e6e3',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: '#b3261e',
    fontSize: 13,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

const badgeStyle = StyleSheet.create({
  open: { backgroundColor: '#e8eef8' },
  paid: { backgroundColor: '#e3f2e6' },
  overdue: { backgroundColor: '#f8e6e3' },
});

const badgeTextStyle = StyleSheet.create({
  open: { color: '#1f4e9c' },
  paid: { color: '#1d6b2f' },
  overdue: { color: '#b3261e' },
});
