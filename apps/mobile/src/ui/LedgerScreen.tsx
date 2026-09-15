/**
 * T15, screen two: the ledger -- every value movement on the watched addresses,
 * newest first, with live backfill progress per address.
 *
 * Rendering rules worth stating:
 *   - Only succeeded events are listed. A failed transaction moved no money; showing
 *     it as a row would invite booking income that never arrived (see projection).
 *   - Amounts render through core's formatUnits (bigint-exact); no floats.
 *   - Progress is counts, never a percentage -- history size is unknown until the
 *     walk completes (ui/syncStatus.ts).
 */
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { Address, ChainEvent, WatchedAddressView } from '@local-books/core';
import { eventIdentity } from '@local-books/core';
import { formatBlockTime, formatTokenAmount, shortAddress } from './format.js';
import type { AddressSyncState } from './syncStatus.js';
import { syncStatusLine } from './syncStatus.js';

export interface LedgerScreenProps {
  /** Shown as a tag in the header when not mainnet, so a devnet build is unmistakable. */
  readonly network: 'devnet' | 'mainnet';
  readonly watched: readonly WatchedAddressView[];
  /** Deduped, newest first, succeeded only -- the App prepares this. */
  readonly events: readonly ChainEvent[];
  readonly syncStates: ReadonlyMap<Address, AddressSyncState>;
  readonly refreshing: boolean;
  /** A failed books load. Rendered as a banner; empty books with no banner = truth. */
  readonly errorBanner: string | null;
  readonly onRefresh: () => void;
  readonly onAddAddress: () => void;
  /** Stop watching (the App confirms first, then records address-unwatched). */
  readonly onUnwatch: (address: Address) => void;
  readonly onOpenInvoices: () => void;
  readonly onOpenIncome: () => void;
  /** Open + overdue count, shown on the invoices button. */
  readonly openInvoiceCount: number;
}

export function LedgerScreen({
  network,
  watched,
  events,
  syncStates,
  refreshing,
  errorBanner,
  onRefresh,
  onAddAddress,
  onUnwatch,
  onOpenInvoices,
  onOpenIncome,
  openInvoiceCount,
}: LedgerScreenProps): React.JSX.Element {
  const labelFor = new Map<Address, string>(watched.map((w) => [w.address, w.label]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Local Books</Text>
          {network !== 'mainnet' && (
            <View style={styles.networkTag} testID="network-tag">
              <Text style={styles.networkTagText}>{network}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerButtons}>
          <Pressable style={styles.invoicesButton} onPress={onOpenIncome} testID="income-button">
            <Text style={styles.invoicesButtonText}>Income</Text>
          </Pressable>
          <Pressable style={styles.invoicesButton} onPress={onOpenInvoices} testID="invoices-button">
            <Text style={styles.invoicesButtonText}>
              Invoices{openInvoiceCount > 0 ? ` (${openInvoiceCount})` : ''}
            </Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={onAddAddress} testID="add-address-button">
            <Text style={styles.addButtonText}>+ Watch</Text>
          </Pressable>
        </View>
      </View>

      {errorBanner !== null && (
        <View style={styles.errorBanner} testID="books-error">
          <Text style={styles.errorBannerText}>Could not read the books: {errorBanner}</Text>
        </View>
      )}

      {watched.map((w) => {
        const status = syncStatusLine(syncStates.get(w.address));
        return (
          <View key={w.address} style={styles.addressRow}>
            <View style={styles.addressBody}>
              <Text style={styles.addressLabel}>{w.label}</Text>
              <Text style={styles.addressValue}>{shortAddress(w.address)}</Text>
              {status !== null && (
                <Text style={styles.syncStatus} testID={`sync-status-${w.address}`}>
                  {status}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => onUnwatch(w.address)}
              hitSlop={8}
              testID={`unwatch-${w.address}`}
            >
              <Text style={styles.unwatch}>Remove</Text>
            </Pressable>
          </View>
        );
      })}

      {watched.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No addresses yet</Text>
          <Text style={styles.emptyBody}>
            Watch an address to pull in its payment history. Everything stays on this
            device.
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={events}
          keyExtractor={(event) => eventIdentity(event)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>
                No transactions found yet. New payments show up when the app checks —
                on open, and when you pull to refresh.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <EventRow event={item} watchedLabel={labelFor.get(item.watchedAddress)} />
          )}
        />
      )}
    </View>
  );
}

function EventRow({
  event,
  watchedLabel,
}: {
  readonly event: ChainEvent;
  readonly watchedLabel: string | undefined;
}): React.JSX.Element {
  const incoming = event.direction === 'in';
  return (
    <View style={styles.row}>
      <View style={[styles.directionBadge, incoming ? styles.badgeIn : styles.badgeOut]}>
        <Text style={styles.directionGlyph}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.amount}>
          {incoming ? '+' : '−'}
          {formatTokenAmount(event.amount)}
        </Text>
        <Text style={styles.counterparty}>
          {incoming ? 'from ' : 'to '}
          {event.counterparty !== null ? shortAddress(event.counterparty) : 'unknown'}
          {watchedLabel !== undefined ? ` · ${watchedLabel}` : ''}
        </Text>
        {event.memo !== null && <Text style={styles.memo}>{event.memo}</Text>}
      </View>
      <Text style={styles.date}>{formatBlockTime(event.blockTime)}</Text>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  networkTag: {
    backgroundColor: '#fff7e6',
    borderColor: '#e8d5a8',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  networkTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a5a00',
    textTransform: 'uppercase',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  invoicesButton: {
    borderWidth: 1,
    borderColor: '#1f4e9c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  invoicesButtonText: {
    color: '#1f4e9c',
    fontWeight: '600',
    fontSize: 13,
  },
  addButton: {
    backgroundColor: '#1f4e9c',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d8d8e0',
  },
  addressBody: {
    flex: 1,
  },
  unwatch: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b3261e',
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  addressValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    opacity: 0.6,
  },
  syncStatus: {
    fontSize: 12,
    color: '#1f4e9c',
    marginTop: 2,
  },
  list: {
    // Explicitly bounded: a ScrollView-family component must never size itself to
    // its content, or a long ledger would overflow instead of scrolling.
    flex: 1,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e2ea',
    gap: 12,
  },
  directionBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIn: {
    backgroundColor: '#e3f2e6',
  },
  badgeOut: {
    backgroundColor: '#f4e6e3',
  },
  directionGlyph: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
  },
  counterparty: {
    fontSize: 12,
    opacity: 0.65,
    fontFamily: 'monospace',
  },
  memo: {
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.6,
  },
  date: {
    fontSize: 11,
    opacity: 0.55,
    maxWidth: 90,
    textAlign: 'right',
  },
});
