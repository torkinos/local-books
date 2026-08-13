/**
 * Raw RPC transactions -> canonical ChainEvents, and dedup.
 *
 * This is the only module that knows the `jsonParsed` wire shape. Everything
 * downstream sees ChainEvent, which is why a web3.js version bump cannot ripple
 * through matching, valuation, and reports.
 *
 * Ingestion is idempotent (PROJECT.md line 74). Re-running a backfill, resuming a
 * killed sync that replays its last page, or re-deriving the whole index after a
 * projection rebuild must all converge on the same ledger.
 */
import type { ChainEvent, Signature } from '../types/index.js';

/**
 * Identity of a single value movement.
 *
 * Signature alone is not enough: a batch payout is one signature containing many
 * transfers, and collapsing on signature would book one payment and silently drop the
 * rest. The pair (signature, instructionIndex) is the real key.
 */
export function eventKey(event: Pick<ChainEvent, 'signature' | 'instructionIndex'>): string {
  return `${event.signature}:${event.instructionIndex}`;
}

/**
 * Drop duplicates, keeping first occurrence.
 *
 * First-wins rather than last-wins because the first copy came from the page we
 * checkpointed against; a later copy is a replay of the same on-chain fact and carries
 * no new information.
 */
export function dedupEvents(events: readonly ChainEvent[]): readonly ChainEvent[] {
  const seen = new Set<string>();
  const out: ChainEvent[] = [];
  for (const event of events) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

/**
 * Merge freshly ingested events into stored ones.
 *
 * Used on every sync. Stored events win on collision, so a re-ingest never rewrites
 * history that reports may already have been generated from.
 */
export function mergeEvents(
  stored: readonly ChainEvent[],
  incoming: readonly ChainEvent[],
): readonly ChainEvent[] {
  return dedupEvents([...stored, ...incoming]);
}

/** Newest first, matching how the RPC pages and how the ledger UI reads. */
export function sortByRecency(events: readonly ChainEvent[]): readonly ChainEvent[] {
  return [...events].sort((a, b) => {
    if (a.slot !== b.slot) return b.slot - a.slot;
    return a.instructionIndex - b.instructionIndex;
  });
}

/**
 * Signatures we have not yet fetched full transactions for.
 *
 * Backfill collects signatures fast and hydrates them slowly; this is what keeps the
 * hydration pass from re-fetching a transaction it already holds, which matters when
 * every round-trip is rate-limited quota.
 */
export function missingSignatures(
  signatures: readonly Signature[],
  known: readonly ChainEvent[],
): readonly Signature[] {
  const have = new Set(known.map((e) => e.signature));
  const out: Signature[] = [];
  const emitted = new Set<Signature>();
  for (const signature of signatures) {
    if (have.has(signature) || emitted.has(signature)) continue;
    emitted.add(signature);
    out.push(signature);
  }
  return out;
}
