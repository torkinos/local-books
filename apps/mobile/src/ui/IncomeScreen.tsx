/**
 * T26: the income statement -- monthly totals per client, one grand total, one export
 * button. Deliberately dumb: every number and every line of copy on this screen is
 * computed in incomeSummary.ts where the test suite ties it to the CSV to the cent;
 * the component only lays it out.
 *
 * Month labels render as the raw 'YYYY-MM' the grouping is keyed by (UTC) -- the same
 * calendar the CSV dates use, so the screen and the export never disagree about which
 * month a payment belongs to.
 */
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { MonthlyClientTotal } from '@local-books/core';

export interface IncomeScreenProps {
  readonly monthly: readonly MonthlyClientTotal[];
  /**
   * Decimal string from the statement; rendered verbatim, never re-computed here.
   * `null` while no statement has been computed yet -- rendered as an em dash, never
   * as a definitive-looking 0.00.
   */
  readonly totalFiat: string | null;
  /** Why the total omits rows (incomeSummary.valuationNote). `null` = omits nothing. */
  readonly unvaluedNote: string | null;
  /** Internal transfers excluded (incomeSummary.internalNote). Informational. */
  readonly internalNote: string | null;
  readonly rowCount: number;
  readonly loading: boolean;
  readonly exporting: boolean;
  readonly onExport: () => void;
  /** Recompute the statement (re-attempting failed rate fetches) -- the note's "pull to refresh" must actually exist. */
  readonly onRefresh: () => void;
  readonly onBack: () => void;
}

export function IncomeScreen({
  monthly,
  totalFiat,
  unvaluedNote,
  internalNote,
  rowCount,
  loading,
  exporting,
  onExport,
  onRefresh,
  onBack,
}: IncomeScreenProps): React.JSX.Element {
  const exportDisabled = exporting || rowCount === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} testID="income-back">
          <Text style={styles.back}>‹ Ledger</Text>
        </Pressable>
        <Text style={styles.title}>Income</Text>
        <Pressable
          style={[styles.exportButton, exportDisabled && styles.exportButtonDisabled]}
          onPress={onExport}
          disabled={exportDisabled}
          testID="income-export"
        >
          <Text style={styles.exportButtonText}>{exporting ? 'Exporting…' : 'Export CSV'}</Text>
        </Pressable>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total income</Text>
        <Text style={styles.totalValue} testID="income-total">
          {totalFiat === null ? '—' : `${totalFiat} GEL`}
        </Text>
      </View>

      {loading && <Text style={styles.loading}>Valuing payments at official rates…</Text>}

      {internalNote !== null && (
        <Text style={styles.loading} testID="income-internal">
          {internalNote}
        </Text>
      )}

      {unvaluedNote !== null && (
        <View style={styles.noteBanner} testID="income-note">
          <Text style={styles.noteText}>{unvaluedNote}</Text>
        </View>
      )}

      <FlatList
        style={styles.list}
        data={monthly}
        keyExtractor={(group) => `${group.month}|${group.clientName ?? ''}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        ListEmptyComponent={
          // While the first statement is still being computed, an authoritative
          // "No income yet" would be a lie the user acts on; say nothing until the
          // numbers exist.
          loading ? null : (
            <View style={styles.empty} testID="income-empty">
              <Text style={styles.emptyTitle}>No income yet</Text>
              <Text style={styles.emptyBody}>
                Incoming stablecoin payments — matched to invoices or not — appear here
                once an address has synced. Watch an address from the ledger to start.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <View>
            {monthly[index - 1]?.month !== item.month && (
              <Text style={styles.monthHeader}>{item.month}</Text>
            )}
            <ClientRow group={item} />
          </View>
        )}
      />
    </View>
  );
}

function ClientRow({ group }: { readonly group: MonthlyClientTotal }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.client}>
          {group.clientName ?? 'No invoice — unmatched deposits'}
        </Text>
        <Text style={styles.rowDetail}>
          {group.rowCount} {group.rowCount === 1 ? 'payment' : 'payments'}
          {group.unvaluedCount > 0 ? ` · ${group.unvaluedCount} not valued` : ''}
        </Text>
      </View>
      <Text style={styles.rowTotal}>{group.totalFiat} GEL</Text>
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
  exportButton: {
    backgroundColor: '#1f4e9c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exportButtonDisabled: {
    opacity: 0.4,
  },
  exportButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d8d8e0',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  loading: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    fontSize: 12,
    opacity: 0.6,
  },
  noteBanner: {
    backgroundColor: '#fdf3e0',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  noteText: {
    color: '#7a5210',
    fontSize: 13,
  },
  list: {
    // Explicitly bounded: a ScrollView-family component must never size itself to
    // its content, or a long statement would overflow instead of scrolling.
    flex: 1,
  },
  monthHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.55,
    fontFamily: 'monospace',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
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
  rowDetail: {
    fontSize: 12,
    opacity: 0.6,
  },
  rowTotal: {
    fontSize: 15,
    fontWeight: '600',
  },
  empty: {
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: 13,
    opacity: 0.7,
    textAlign: 'center',
  },
});
