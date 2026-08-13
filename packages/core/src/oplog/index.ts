/**
 * The op log: append-only record of human decisions (PROJECT.md line 90).
 *
 * This is the source of truth and the only thing that genuinely needs backing up.
 * Chain data is deliberately absent -- it is re-derivable from RPC, so mirroring it
 * here would bloat the log without adding information, and would make the post-grant
 * replication story (line 92) far more expensive than it needs to be.
 *
 * Ops are never mutated or deleted. A mistake is corrected by appending a compensating
 * op (`match-rejected` undoes `match-confirmed`), so the history of what the user
 * decided, and when, survives intact -- which is the whole point for an audit trail.
 */
import type { Op, UnixSeconds } from '../types/index.js';

/**
 * Ordering for a fold.
 *
 * By timestamp, tie-broken by id so the result is total and stable. Stability matters
 * more than it looks: two devices folding the same ops must reach the same state once
 * replication exists, and a fold whose output depends on insertion order cannot do
 * that.
 */
export function sortOps(ops: readonly Op[]): readonly Op[] {
  return [...ops].sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id)));
}

/** Drop ops sharing an id. Replay and future replication both deliver duplicates. */
export function dedupOps(ops: readonly Op[]): readonly Op[] {
  const seen = new Set<string>();
  const out: Op[] = [];
  for (const op of ops) {
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    out.push(op);
  }
  return out;
}

/**
 * Content-addressed op id.
 *
 * Derived from the op's own content so that the same decision made twice -- a replayed
 * op, or the same op arriving over two replication paths later -- collapses to one
 * entry. Callers pass a hasher; core does not import a crypto library (see ports).
 */
export function makeOpId(
  op: Omit<Op, 'id'>,
  hash: (input: string) => string,
): string {
  return hash(stableStringify(op));
}

/**
 * Deterministic JSON with sorted keys and bigint support.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical ops built
 * by different code paths would otherwise hash differently and defeat content
 * addressing. bigint is handled explicitly because `JSON.stringify` throws on it, and
 * every money field in this codebase is a bigint.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? `"${value.toString()}n"` : JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Ops at or before `at`. Backs "what did the books say when I filed?" */
export function opsAsOf(ops: readonly Op[], at: UnixSeconds): readonly Op[] {
  return sortOps(ops).filter((op) => op.at <= at);
}
