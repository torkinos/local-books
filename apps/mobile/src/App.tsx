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
import type {
  Address,
  ChainEvent,
  InvoiceView,
  Op,
  StoragePort,
  WatchedAddressView,
} from '@local-books/core';
import { dedupEvents, invoiceDoc, project, sortByRecency, withOverdue } from '@local-books/core';
import {
  clock,
  docs,
  openEncryptedStorage,
  openRatePort,
  referenceKeys,
  rpcEndpoints,
  KeyLostError,
} from './ports.js';
import { addressWatchedOp, invoiceCreatedOp } from './ops.js';
import { autoMatchOps } from './matching.js';
import { shareTextFile } from './adapters/files.js';
import { syncAddress } from './sync/engine.js';
import type { SyncResult } from './sync/engine.js';
import { valueEvents, FIAT } from './valuation.js';
import { AddAddressScreen } from './ui/AddAddressScreen.js';
import type { CreateInvoiceSubmission } from './ui/CreateInvoiceScreen.js';
import { CreateInvoiceScreen } from './ui/CreateInvoiceScreen.js';
import { IncomeScreen } from './ui/IncomeScreen.js';
import type { IncomeSummary } from './ui/incomeSummary.js';
import { csvFilename, incomeSummary, internalNote, valuationNote } from './ui/incomeSummary.js';
import { InvoicesScreen } from './ui/InvoicesScreen.js';
import { LedgerScreen } from './ui/LedgerScreen.js';
import type { AddressSyncState } from './ui/syncStatus.js';

/** How often the foreground timer re-checks for new payments. Not a promise. */
const FOREGROUND_POLL_MS = 30_000;
/** During a long backfill, how often the ledger list refreshes from storage. */
const REFRESH_THROTTLE_MS = 2_000;

interface Books {
  readonly watched: readonly WatchedAddressView[];
  readonly events: readonly ChainEvent[];
  readonly invoices: readonly InvoiceView[];
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
  const [screen, setScreen] = useState<
    'ledger' | 'add' | 'invoices' | 'create-invoice' | 'income'
  >('ledger');
  const [books, setBooks] = useState<Books>({ watched: [], events: [], invoices: [] });
  const [syncStates, setSyncStates] = useState<ReadonlyMap<Address, AddressSyncState>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  // A failed refresh must not present as empty books: the ledger renders this as a
  // banner (StorageCorruptionError's message names the bad table+row on purpose).
  const [booksError, setBooksError] = useState<string | null>(null);
  // Income statement (T26): rebuilt on entering the screen and on its pull-to-refresh.
  // `note` explains omitted rows; `incomeError` is a whole-statement failure and takes
  // precedence in the same banner slot.
  const [income, setIncome] = useState<{
    readonly summary: IncomeSummary;
    readonly note: string | null;
    readonly internal: string | null;
  } | null>(null);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sharingInvoiceId, setSharingInvoiceId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const watchedRef = useRef<readonly WatchedAddressView[]>([]);
  const runningRef = useRef(new Set<Address>());
  const lastRefreshRef = useRef(0);
  const refreshQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Latest-wins token for loadIncome: passes overlap (re-enter the screen while a
  // prior pass awaits NBG), and a slower STALE pass must never overwrite a fresher
  // statement -- same class of race refreshBooks serializes against.
  const incomeRunRef = useRef(0);
  // Synchronous latches for the two share flows. State alone is not a latch here:
  // setState is async, so a double-tap races through before the re-render commits --
  // the exact bug submitOnce.ts exists for (T18's double-invoice race).
  const exportLatchRef = useRef(false);
  const shareLatchRef = useRef(false);

  const setSyncState = useCallback((address: Address, state: AddressSyncState): void => {
    setSyncStates((current) => {
      const next = new Map(current);
      next.set(address, state);
      return next;
    });
  }, []);

  /**
   * Re-read ops + events from storage into view state, auto-matching on the way.
   *
   * Tier-a matching runs here so a payment matches the moment it lands, whichever
   * path loaded it (sync progress, pull-to-refresh, invoice creation against an
   * already-ingested deposit). autoMatchOps only ever emits ops whose application
   * removes their own candidates, so one extra fold settles it -- no loop.
   *
   * Serialized: two overlapping refreshes (sync progress + pull-to-refresh) would
   * both read ops before either appends its matches and record the same decision
   * twice. Duplicates are harmless to the projection (same invoice+event key), but
   * an audit log that says one confirmation happened twice is still a worse log.
   */
  const refreshBooks = useCallback((): Promise<void> => {
    const run = refreshQueueRef.current.then(() => refreshBooksInner(), () => refreshBooksInner());
    refreshQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;

    async function refreshBooksInner(): Promise<void> {
      const ops = await storage.readOps();
      const watched = project(ops, []).watchedAddresses;
      const events: ChainEvent[] = [];
      for (const view of watched) {
        // Plain loop, not push(...spread): a busy address exceeds the argument limit
        // (same reasoning as core's rebuild()).
        for (const event of await storage.getChainEvents(view.address)) events.push(event);
      }

      let allOps: readonly Op[] = ops;
      let projection = project(allOps, events);
      const matches = autoMatchOps(projection, clock.now());
      if (matches.length > 0) {
        await storage.appendOps(matches);
        allOps = [...ops, ...matches];
        projection = project(allOps, events);
      }

      watchedRef.current = watched;
      lastRefreshRef.current = Date.now();
      setBooksError(null);
      setBooks({
        watched,
        // Failed transactions moved no money; they stay in the store as chain facts
        // but are not ledger rows (same rule as projection's unmatched list).
        events: sortByRecency(dedupEvents(events)).filter((event) => event.succeeded),
        invoices: withOverdue(projection, clock.now()).invoices,
      });
    }
  }, [storage]);

  const surfaceBooksError = useCallback((error: unknown): void => {
    setBooksError(error instanceof Error ? error.message : String(error));
  }, []);

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
                // Best-effort mid-sync repaint; a persistent storage failure still
                // surfaces through the awaited refresh in this loop's catch.
                void refreshBooks().catch(() => undefined);
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
    void refreshBooks().then(syncAll).catch(surfaceBooksError);
  }, [refreshBooks, syncAll, surfaceBooksError]);

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
      .catch(surfaceBooksError)
      .finally(() => setRefreshing(false));
  }, [refreshBooks, syncAll, surfaceBooksError]);

  const onAddAddress = useCallback(
    async (address: Address, label: string): Promise<void> => {
      await storage.appendOps([addressWatchedOp(address, label, clock.now())]);
      await refreshBooks();
      setScreen('ledger');
      void syncOne(address);
    },
    [storage, refreshBooks, syncOne],
  );

  const onCreateInvoice = useCallback(
    async (submission: CreateInvoiceSubmission): Promise<void> => {
      // The reference key is minted HERE, at creation, one per invoice (D7): random,
      // unlinkable, and already the invoice's identity by the time anything renders.
      const reference = await referenceKeys.generate();
      await storage.appendOps([invoiceCreatedOp({ ...submission, reference }, clock.now())]);
      await refreshBooks();
      setScreen('invoices');
    },
    [storage, refreshBooks],
  );

  /**
   * Rebuild the income statement (T26): re-read the books, value what can be valued
   * at official rates, and derive screen + CSV from ONE statement (incomeSummary).
   *
   * Events are loaded for the same address set core's rebuild() uses — every
   * address-watched target ever, plus every invoice payTo — not just the currently
   * watched list: income booked to a since-unwatched address must not vanish from
   * the statement (see projection's address-unwatched rationale).
   */
  const loadIncome = useCallback(async (): Promise<void> => {
    const run = ++incomeRunRef.current;
    setIncomeLoading(true);
    try {
      const ops = await storage.readOps();
      const addresses = new Set<Address>();
      for (const op of ops) {
        if (op.type === 'address-watched') addresses.add(op.address);
        if (op.type === 'invoice-created') addresses.add(op.payTo);
      }
      const events: ChainEvent[] = [];
      for (const address of addresses) {
        // Plain loop, not push(...spread): same argument-limit reasoning as rebuild().
        for (const event of await storage.getChainEvents(address)) events.push(event);
      }
      const rates = await openRatePort();
      // Internal moves (counterparty is one of the user's own addresses) are excluded
      // from the statement below, so don't spend rate fetches on them -- and don't
      // let their fetch failures count against rows the report will never show.
      const valuationTargets = events.filter(
        (event) => event.counterparty === null || !addresses.has(event.counterparty),
      );
      const { valuations, failures, firstError } = await valueEvents(valuationTargets, rates, FIAT);
      const summary = incomeSummary(project(ops, events), events, valuations, clock.now(), addresses);
      if (incomeRunRef.current !== run) return; // a fresher pass owns the screen now
      setIncome({
        summary,
        note: valuationNote(summary.statement.unvaluedCount, failures, firstError),
        internal: internalNote(summary.statement.internalCount),
      });
      setIncomeError(null);
    } catch (error) {
      // A whole-statement failure (storage, or the rate cache DB refusing to open) —
      // per-row rate failures never land here, valueEvents absorbs those. Whatever
      // statement was last shown stays up rather than flashing to empty books.
      if (incomeRunRef.current !== run) return;
      setIncomeError(
        `Could not build the income statement: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (incomeRunRef.current === run) setIncomeLoading(false);
    }
  }, [storage]);

  const onOpenIncome = useCallback((): void => {
    setScreen('income');
    void loadIncome();
  }, [loadIncome]);

  const onExportCsv = useCallback((): void => {
    const current = income;
    if (current === null || exportLatchRef.current) return;
    exportLatchRef.current = true;
    setExporting(true);
    setExportError(null);
    void shareTextFile(csvFilename(clock.now()), current.summary.csv, 'text/csv')
      .catch((error: unknown) => {
        // Its own state, NOT incomeError: a failed export says nothing about the
        // statement on screen, and it must not hide the unvalued-rows note past
        // the next successful export.
        setExportError(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        exportLatchRef.current = false;
        setExporting(false);
      });
  }, [income]);

  /** Render one invoice to PDF (QR included) and hand it to the native share sheet. */
  const onShareInvoice = useCallback((view: InvoiceView): void => {
    if (shareLatchRef.current) return;
    shareLatchRef.current = true;
    setSharingInvoiceId(view.invoice.invoiceId);
    setShareError(null);
    void (async () => {
      const { uri } = await docs.renderPdf(invoiceDoc(view.invoice));
      await docs.share(uri, { mimeType: 'application/pdf' });
    })()
      .catch((error: unknown) => {
        setShareError(
          `Could not share the invoice PDF: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        shareLatchRef.current = false;
        setSharingInvoiceId(null);
      });
  }, []);

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

  if (screen === 'invoices') {
    return (
      <View style={styles.root}>
        <InvoicesScreen
          invoices={books.invoices}
          onCreate={() => setScreen('create-invoice')}
          onBack={() => setScreen('ledger')}
          onShare={onShareInvoice}
          sharingInvoiceId={sharingInvoiceId}
          shareError={shareError}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'income') {
    return (
      <View style={styles.root}>
        <IncomeScreen
          monthly={income?.summary.monthly ?? []}
          totalFiat={income?.summary.statement.totalFiat ?? null}
          unvaluedNote={exportError ?? incomeError ?? income?.note ?? null}
          internalNote={income?.internal ?? null}
          rowCount={income?.summary.statement.rows.length ?? 0}
          loading={incomeLoading}
          exporting={exporting}
          onExport={onExportCsv}
          onRefresh={() => void loadIncome()}
          onBack={() => setScreen('ledger')}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'create-invoice') {
    return (
      <View style={styles.root}>
        <CreateInvoiceScreen
          watched={books.watched}
          now={clock.now()}
          onSubmit={onCreateInvoice}
          onCancel={() => setScreen('invoices')}
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
        errorBanner={booksError}
        onRefresh={onRefresh}
        onAddAddress={() => setScreen('add')}
        onOpenInvoices={() => setScreen('invoices')}
        onOpenIncome={onOpenIncome}
        openInvoiceCount={books.invoices.filter((v) => v.status !== 'paid').length}
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
