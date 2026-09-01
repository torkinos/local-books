/**
 * The double-tap latch behind CreateInvoiceScreen's submit, extracted so its
 * re-entry table tests in plain Node (no RN renderer here -- see uiHelpers.test.ts).
 *
 * Why a synchronous latch at all: setState is async, so a `submitting` boolean alone
 * lets a double-tap race through and mint TWO invoices -- each with its own fresh
 * reference key, so content addressing cannot collapse them, and no compensating op
 * exists yet to void one.
 *
 * The re-arm table (pinned in test/submitOnce.test.ts):
 *   - while in flight, further calls are ignored: they resolve immediately and the
 *     attempt does not run again;
 *   - on failure, the latch re-arms BEFORE onFailure fires, and the returned promise
 *     still RESOLVES -- the error goes to onFailure, never to the caller;
 *   - on success, the latch stays SET forever (the screen navigates away).
 */
export interface SubmitOnceHooks {
  /** Fires when an attempt actually starts, right after the latch is taken. */
  onStart(): void;
  /** Fires when the attempt failed; the latch has already re-armed. */
  onFailure(cause: unknown): void;
}

export interface SubmitOnce {
  /** The live latch, readable synchronously (the component checks it pre-validation). */
  readonly inFlight: boolean;
  submit(attempt: () => Promise<void>): Promise<void>;
}

export function createSubmitOnce(hooks: SubmitOnceHooks): SubmitOnce {
  let inFlight = false;
  return {
    get inFlight() {
      return inFlight;
    },
    async submit(attempt) {
      if (inFlight) return;
      inFlight = true;
      hooks.onStart();
      try {
        await attempt();
      } catch (cause) {
        inFlight = false;
        hooks.onFailure(cause);
      }
    },
  };
}
