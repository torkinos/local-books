/**
 * Op construction: human decisions become append-only log entries.
 *
 * Ids are content-addressed via core's makeOpId (oplog/index.ts) so the same decision
 * arriving twice -- a double-tapped button today, replication delivering a duplicate
 * post-grant -- collapses to one row. Core does not import a hash function (D3); this
 * is where the app supplies one.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { Address, AddressWatchedOp, AddressUnwatchedOp, Op, UnixSeconds } from '@local-books/core';
import { makeOpId } from '@local-books/core';

const hashHex = (input: string): string =>
  [...sha256(new TextEncoder().encode(input))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function withOpId<T extends Omit<Op, 'id'>>(op: T): T & { readonly id: string } {
  return { ...op, id: makeOpId(op, hashHex) };
}

export function addressWatchedOp(address: Address, label: string, at: UnixSeconds): AddressWatchedOp {
  return withOpId({ type: 'address-watched', address, label, at });
}

export function addressUnwatchedOp(address: Address, at: UnixSeconds): AddressUnwatchedOp {
  return withOpId({ type: 'address-unwatched', address, at });
}
