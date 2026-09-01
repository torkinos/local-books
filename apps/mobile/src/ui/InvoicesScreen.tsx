/**
 * Invoice list: what is open, what is paid, what is overdue.
 *
 * Statuses come from the projection (with withOverdue applied by the App at read
 * time -- overdue is the one bit of view state that changes with no op or event, so
 * it never enters the fold). A paid row names how it was matched: line 81's audit
 * requirement extends to the UI.
 */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InvoiceView } from '@local-books/core';
import { formatDueDate, formatTokenAmount } from './format.js';

export interface InvoicesScreenProps {
  readonly invoices: readonly InvoiceView[];
  readonly onCreate: () => void;
  readonly onBack: () => void;
  /** Render the invoice as a PDF (with its Solana Pay QR) and open the share sheet. */
  readonly onShare: (view: InvoiceView) => void;
  /** invoiceId currently being rendered/shared; its button shows progress, all disable. */
  readonly sharingInvoiceId: string | null;
  /** A failed render/share. Same banner treatment as the ledger's books error. */
  readonly shareError: string | null;
}

export function InvoicesScreen({
  invoices,
  onCreate,
  onBack,
  onShare,
  sharingInvoiceId,
  shareError,
}: InvoicesScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} testID="invoices-back">
          <Text style={styles.back}>‹ Ledger</Text>
        </Pressable>
        <Text style={styles.title}>Invoices</Text>
        <Pressable style={styles.createButton} onPress={onCreate} testID="new-invoice-button">
          <Text style={styles.createButtonText}>+ New</Text>
        </Pressable>
      </View>

      {shareError !== null && (
        <View style={styles.errorBanner} testID="share-error">
          <Text style={styles.errorBannerText}>{shareError}</Text>
        </View>
      )}

      <FlatList
        style={styles.list}
        data={invoices}
        keyExtractor={(view) => view.invoice.invoiceId}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>
              No invoices yet. Create one, share it, and the payment matches itself
              when it lands — that is the whole loop.
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
