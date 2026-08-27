/**
 * App shell: bootstraps the encrypted store, assembles ports, and orchestrates the
 * two v0.1 screens (T15) around the sync engine.
 *
 * Sync policy is PROJECT.md line 62 verbatim -- "checks when you open, and
 * periodically in the background on Android": a sync pass runs on launch, when the
 * app returns to the foreground, on pull-to-refresh, and on a slow foreground timer.
 * No real-time promise anywhere. Progress survives backgrounding because the engine
 * checkpoints every page (D8); coming back just resumes from storage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Address, ChainEvent, StoragePort, WatchedAddressView } from '@local-books/core';
import { dedupEvents, project, sortByRecency } from '@local-books/core';
import { clock, openEncryptedStorage, rpcEndpoints, KeyLostError } from './ports.js';
import { addressWatchedOp } from './ops.js';
import { syncAddress } from './sync/engine.js';
import type { SyncResult } from './sync/engine.js';
import { AddAddressScreen } from './ui/AddAddressScreen.js';
import { LedgerScreen } from './ui/LedgerScreen.js';
import type { AddressSyncState } from './ui/syncStatus.js';

/** How often the foreground timer re-checks for new payments. Not a promise. */
const FOREGROUND_POLL_MS = 30_000;
/** During a long backfill, how often the ledger list refreshes from storage. */
const REFRESH_THROTTLE_MS = 2_000;

interface Books {
  readonly watched: readonly WatchedAddressView[];
  readonly events: readonly ChainEvent[];
}

type Boot =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly storage: StoragePort }
  | { readonly status: 'failed'; readonly error: unknown };

export default function App(): React.JSX.Element {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    openEncryptedStorage().then(
      (storage) => {
        if (alive) setBoot({ status: 'ready', storage });
      },
      (error: unknown) => {
        if (alive) setBoot({ status: 'failed', error });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (boot.status === 'loading') {
    return (
      <View style={styles.center}>
        <Text style={styles.bootText}>Opening your books…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }
  if (boot.status === 'failed') {
    return <BootFailure error={boot.error} />;
  }
  return <Main storage={boot.storage} />;
}

function BootFailure({ error }: { readonly error: unknown }): React.JSX.Element {
  const keyLost = error instanceof KeyLostError;
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>{keyLost ? 'Books are locked' : 'Could not open the books'}</Text>
      <Text style={styles.errorBody}>
        {error instanceof Error ? error.message : String(error)}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

function Main({ storage }: { readonly storage: StoragePort }): React.JSX.Element {
  const [screen, setScreen] = useState<'ledger' | 'add'>('ledger');
  const [books, setBooks] = useState<Books>({ watched: [], events: [] });
  const [syncStates, setSyncStates] = useState<ReadonlyMap<Address, AddressSyncState>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const watchedRef = useRef<readonly WatchedAddressView[]>([]);
  const runningRef = useRef(new Set<Address>());
  const lastRefreshRef = useRef(0);

  const setSyncState = useCallback((address: Address, state: AddressSyncState): void => {
    setSyncStates((current) => {
      const next = new Map(current);
      next.set(address, state);
      return next;
    });
  }, []);

  /** Re-read ops + events from storage into view state. */
  const refreshBooks = useCallback(async (): Promise<void> => {
    const ops = await storage.readOps();
    const watched = project(ops, []).watchedAddresses;
    const events: ChainEvent[] = [];
    for (const view of watched) {
      // Plain loop, not push(...spread): a busy address exceeds the argument limit
      // (same reasoning as core's rebuild()).
      for (const event of await storage.getChainEvents(view.address)) events.push(event);
    }
    watchedRef.current = watched;
    lastRefreshRef.current = Date.now();
    setBooks({
      watched,
      // Failed transactions moved no money; they stay in the store as chain facts
      // but are not ledger rows (same rule as projection's unmatched list).
      events: sortByRecency(dedupEvents(events)).filter((event) => event.succeeded),
    });
  }, [storage]);

  /** One full sync for one address; loops while the driver hits its page budget. */
  const syncOne = useCallback(
    async (address: Address): Promise<void> => {
      if (runningRef.current.has(address)) return;
      runningRef.current.add(address);
      try {
        let result: SyncResult;
        do {
          result = await syncAddress(address, {
            endpoints: rpcEndpoints(),
            storage,
            clock,
            onProgress: (progress) => {
              setSyncState(address, { phase: 'syncing', progress });
              // Let rows appear DURING a long backfill, throttled so a fast
              // hydration loop does not thrash the list.
              if (Date.now() - lastRefreshRef.current > REFRESH_THROTTLE_MS) {
                lastRefreshRef.current = Date.now();
                void refreshBooks();
              }
            },
          });
          await refreshBooks();
        } while (result.kind === 'page-budget-reached');
        setSyncState(address, { phase: 'idle', lastResult: result });
      } catch (error) {
        setSyncState(address, {
          phase: 'failed',
          message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        runningRef.current.delete(address);
      }
    },
    [storage, refreshBooks, setSyncState],
  );

  const syncAll = useCallback((): void => {
    for (const view of watchedRef.current) void syncOne(view.address);
  }, [syncOne]);

  // On launch: load what storage has, then check the chain.
  useEffect(() => {
    void refreshBooks().then(syncAll);
  }, [refreshBooks, syncAll]);

  // On returning to the foreground, and on a slow timer while visible.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncAll();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') syncAll();
    }, FOREGROUND_POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [syncAll]);

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    void refreshBooks()
      .then(syncAll)
      .finally(() => setRefreshing(false));
  }, [refreshBooks, syncAll]);

  const onAddAddress = useCallback(
    async (address: Address, label: string): Promise<void> => {
      await storage.appendOps([addressWatchedOp(address, label, clock.now())]);
      await refreshBooks();
      setScreen('ledger');
      void syncOne(address);
    },
    [storage, refreshBooks, syncOne],
  );

  if (screen === 'add') {
    return (
      <View style={styles.root}>
        <AddAddressScreen
          alreadyWatched={books.watched.map((w) => w.address)}
          onSubmit={onAddAddress}
          onCancel={() => setScreen('ledger')}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LedgerScreen
        watched={books.watched}
        events={books.events}
        syncStates={syncStates}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onAddAddress={() => setScreen('add')}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fafafc',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  bootText: {
    fontSize: 15,
    opacity: 0.7,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  errorBody: {
    fontSize: 14,
    opacity: 0.8,
    textAlign: 'center',
  },
});
