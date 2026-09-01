/**
 * The double-tap latch (submitOnce.ts), pinned exactly as CreateInvoiceScreen uses
 * it. The invariant that matters: a double-tap must never run the attempt twice --
 * two invoices would mint with two fresh reference keys, content addressing could
 * not collapse them, and no compensating op exists yet to void one. The re-arm
 * asymmetry is deliberate and mirrors the screen: failure re-arms (the user fixes
 * and retries), success never does (the screen navigates away).
 */
import { describe, expect, it } from 'vitest';
import { createSubmitOnce, type SubmitOnceHooks } from '../src/ui/submitOnce.js';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(hooks: Partial<SubmitOnceHooks> = {}) {
  const events: string[] = [];
  let attempts = 0;
  let gate = deferred();
  const guard = createSubmitOnce({
    onStart: () => {
      events.push('start');
      hooks.onStart?.();
    },
    onFailure: (cause) => {
      events.push(`failure:${cause instanceof Error ? cause.message : String(cause)}`);
      hooks.onFailure?.(cause);
    },
  });
  return {
    guard,
    events,
    get attempts() {
      return attempts;
    },
    get gate() {
      return gate;
    },
    submit: () =>
      guard.submit(() => {
        attempts += 1;
        events.push('attempt');
        gate = deferred();
        return gate.promise;
      }),
  };
}

describe('createSubmitOnce', () => {
  it('ignores a second call during flight: the attempt runs ONCE', async () => {
    const h = harness();
    const first = h.submit();
    const second = h.submit(); // the double-tap, landing before any state settles

    await second; // resolves immediately -- ignored, not queued
    expect(h.attempts).toBe(1);
    expect(h.events).toEqual(['start', 'attempt']); // onStart once, no second start

    h.gate.resolve();
    await first;
    expect(h.attempts).toBe(1);
  });

  it('success leaves the latch SET forever -- the screen navigates away, later taps stay dead', async () => {
    const h = harness();
    const first = h.submit();
    h.gate.resolve();
    await first;

    expect(h.guard.inFlight).toBe(true); // never re-arms on success
    await h.submit();
    expect(h.attempts).toBe(1);
    expect(h.events).toEqual(['start', 'attempt']); // and no failure hook ever fired
  });

  it('failure re-arms BEFORE onFailure fires, delivers the cause, and the promise RESOLVES', async () => {
    let inFlightDuringFailure: boolean | undefined;
    const seen: unknown[] = [];
    const guard = createSubmitOnce({
      onStart: () => {},
      onFailure: (cause) => {
        seen.push(cause);
        inFlightDuringFailure = guard.inFlight;
      },
    });

    const boom = new Error('rpc down');
    // Never rejects: the error is routed to onFailure (the screen's error banner),
    // exactly like the component's try/catch -- an unhandled rejection from a tap
    // handler would crash where the old code showed a message.
    await expect(guard.submit(() => Promise.reject(boom))).resolves.toBeUndefined();
    expect(seen).toEqual([boom]); // the original cause, not a rewrap
    expect(inFlightDuringFailure).toBe(false); // re-armed before the hook observed it
    expect(guard.inFlight).toBe(false);
  });

  it('after a failure the next call actually runs again (retry path)', async () => {
    const h = harness();
    const first = h.submit();
    h.gate.reject(new Error('nope'));
    await first;
    expect(h.events).toEqual(['start', 'attempt', 'failure:nope']);

    const retry = h.submit();
    expect(h.attempts).toBe(2);
    expect(h.events).toEqual(['start', 'attempt', 'failure:nope', 'start', 'attempt']);
    h.gate.resolve();
    await retry;
    expect(h.guard.inFlight).toBe(true); // and the successful retry latches for good
  });

  it('onStart fires after the latch is taken and before the attempt begins', async () => {
    // Mirrors the component ordering: submittingRef.current = true, THEN
    // setErrors([]) / setSubmitting(true), THEN await onSubmit(...).
    const events: string[] = [];
    const guard = createSubmitOnce({
      onStart: () => events.push(`start(inFlight=${guard.inFlight})`),
      onFailure: () => {},
    });
    await guard.submit(async () => {
      events.push('attempt');
    });
    expect(events).toEqual(['start(inFlight=true)', 'attempt']);
  });
});
