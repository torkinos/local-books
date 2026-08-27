/**
 * Per-address sync state as the UI tracks it, and its rendering into copy.
 *
 * The copy is deliberately honest about what sync is (T29, PROJECT.md line 62): it
 * says "checking", never "live", and a failure names the next step rather than
 * pretending to retry forever. Pure functions so the wording is unit-tested.
 */
import type { SyncProgress, SyncResult } from '../sync/engine.js';

export type AddressSyncState =
  | { readonly phase: 'syncing'; readonly progress?: SyncProgress }
  | { readonly phase: 'idle'; readonly lastResult?: SyncResult }
  | { readonly phase: 'failed'; readonly message: string };

/** One line under an address row. `null` means nothing worth saying (idle, synced). */
export function syncStatusLine(state: AddressSyncState | undefined): string | null {
  if (state === undefined) return null;

  if (state.phase === 'failed') return state.message;

  if (state.phase === 'idle') {
    const result = state.lastResult;
    if (result === undefined) return null;
    if (result.kind === 'endpoints-exhausted') {
      return 'Could not reach an RPC endpoint. Will retry when you reopen or refresh.';
    }
    if (result.kind === 'cancelled') return 'Sync paused. It resumes where it left off.';
    return null; // complete / budget-reached: the ledger itself is the status
  }

  const p = state.progress;
  if (p === undefined) return 'Starting sync…';

  if (p.phase === 'backoff') {
    const seconds = Math.max(1, Math.round((p.backoffMs ?? 0) / 1000));
    return `Rate limited by ${p.endpointLabel} — waiting ${seconds}s…`;
  }

  if (p.mode === 'incremental') return 'Checking for new payments…';

  // Initial backfill: show real counts, never a fake percentage -- total history
  // size is unknown until the walk completes, and an invented bar would be a lie.
  if (p.phase === 'hydrating' && p.pageHydration !== undefined) {
    return `Backfilling history — page ${p.pages}: transaction ${p.pageHydration.fetched} of ${p.pageHydration.total}…`;
  }
  return p.pages === 0
    ? 'Backfilling history…'
    : `Backfilling history — ${p.pages} ${p.pages === 1 ? 'page' : 'pages'}, ${p.transactionsFetched} transactions so far…`;
}
