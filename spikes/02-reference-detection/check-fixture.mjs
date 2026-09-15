/**
 * S2: run the REAL normalizer + tier-a matcher over a dumped fixture and say what
 * the app would have seen.
 *
 * Usage:
 *   node spikes/02-reference-detection/check-fixture.mjs <fixture.json> [more.json ...] \
 *     --owner <WATCHED_WALLET> [--reference <INVOICE_REFERENCE>] \
 *     [--expect-amount <RAW_UNITS>] [--mint <MINT>]
 *
 * For each fixture it reports:
 *   1. paging visibility -- does the transaction's account list name the OWNER
 *      (owner paging finds it) and/or the owner's ATA for --mint (token-account
 *      paging finds it; D19)? A payment visible ONLY via the ATA is exactly the
 *      case that was invisible before D19.
 *   2. the ChainEvents core normalizes under the owner;
 *   3. with --reference: tier-a candidates, whether automation would apply one,
 *      and the amount agreement against --expect-amount (defaults to the event's
 *      own amount, i.e. 'exact').
 *
 * Build core first (see core-dist.mjs). Defaults: --mint is Circle's devnet USDC.
 */
import { readFileSync } from 'node:fs';
import { Point } from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import {
  amountAgreement,
  asAddress,
  asReferenceKey,
  asSignature,
  asUnixSeconds,
  matchByReference,
  normalizeTransactions,
} from './core-dist.mjs';

const files = [];
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    args[a.slice(2)] = process.argv[i + 1];
    i += 1;
  } else {
    files.push(a);
  }
}
if (files.length === 0 || !args.owner) {
  console.error('usage: check-fixture.mjs <fixture.json>... --owner <wallet> [--reference <key>] [--expect-amount <raw>] [--mint <mint>]');
  process.exit(1);
}
const owner = args.owner;
const mint = args.mint ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// --- ATA derivation, mirroring apps/mobile/src/sync/ata.ts (kept inline so the
// spike script has no build step beyond core's) ----------------------------------
const TOKEN_PROGRAM = bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = bs58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const onCurve = (bytes) => {
  try {
    Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
};
function associatedTokenAddress(ownerB58, mintB58) {
  const seeds = [bs58.decode(ownerB58), TOKEN_PROGRAM, bs58.decode(mintB58)];
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concat([...seeds, Uint8Array.of(bump), ATA_PROGRAM, PDA_MARKER]));
    if (!onCurve(hash)) return bs58.encode(hash);
  }
  throw new Error('no bump');
}
const ata = associatedTokenAddress(owner, mint);
console.log(`owner ${owner}\nATA(${mint.slice(0, 4)}…) ${ata}\n`);

const fmt = (amount) => {
  const s = amount.raw.toString().padStart(amount.decimals + 1, '0');
  const whole = s.slice(0, s.length - amount.decimals);
  const frac = s.slice(s.length - amount.decimals).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} ${amount.symbol ?? amount.mint ?? 'SOL'}`;
};

let exit = 0;
for (const file of files) {
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const tx = {
    signature: asSignature(fixture.signature),
    slot: fixture.slot,
    blockTime: fixture.blockTime === null ? null : asUnixSeconds(fixture.blockTime),
    raw: fixture.raw,
  };
  const keys = (fixture.raw?.transaction?.message?.accountKeys ?? []).map((k) => k.pubkey);
  const viaOwner = keys.includes(owner);
  const viaAta = keys.includes(ata);

  console.log(`== ${file}`);
  console.log(`   signature ${fixture.signature}`);
  console.log(`   status    ${fixture.raw?.meta?.err == null ? 'succeeded' : 'FAILED on chain'}`);
  console.log(`   visible via owner paging:         ${viaOwner ? 'yes' : 'NO'}`);
  console.log(`   visible via token-account paging: ${viaAta ? 'yes' : 'no'}${!viaOwner && viaAta ? '   <- the D19 case' : ''}`);
  if (!viaOwner && !viaAta) {
    console.log('   !! neither: the app would never fetch this transaction (a non-ATA token account? a different mint?)');
    exit = 2;
  }

  const events = normalizeTransactions([tx], asAddress(owner));
  if (events.length === 0) {
    console.log('   events: none normalized under the owner (not a value movement touching it)');
  }
  for (const e of events) {
    console.log(
      `   event ix=${e.instructionIndex} ${e.direction} ${fmt(e.amount)} ` +
        `${e.direction === 'in' ? 'from' : 'to'} ${e.counterparty ?? '?'} ` +
        `refs=[${e.references.map((r) => r.slice(0, 6)).join(', ')}]${e.memo ? ` memo="${e.memo}"` : ''}`,
    );
  }

  if (args.reference) {
    const first = events.find((e) => e.direction === 'in');
    const expectRaw = args['expect-amount'] !== undefined ? BigInt(args['expect-amount']) : first?.amount.raw ?? 0n;
    // The synthetic invoice asks for the same TOKEN the payment moved (a SOL event has
    // mint === null, and `??` must not turn that into the USDC mint), so that with no
    // --expect-amount the agreement reads 'exact' and the verdict is the app's.
    const invoice = {
      id: 'x',
      at: asUnixSeconds(0),
      type: 'invoice-created',
      invoiceId: args.reference,
      clientName: 'S2',
      lineItems: [],
      total: {
        raw: expectRaw,
        decimals: first !== undefined ? first.amount.decimals : 6,
        mint: first !== undefined ? first.amount.mint : asAddress(mint),
        symbol: first?.amount.symbol,
      },
      dueDate: asUnixSeconds(0),
      reference: asReferenceKey(args.reference),
      payTo: asAddress(owner),
    };
    const candidates = matchByReference(events, [invoice]);
    if (candidates.length === 0) {
      console.log(`   tier a: NOT DETECTED (no event carries reference ${args.reference.slice(0, 6)}…)`);
    }
    for (const c of candidates) {
      const event = events.find((e) => e.signature === c.signature && e.instructionIndex === c.instructionIndex);
      const agreement = event ? amountAgreement(event, invoice) : '?';
      console.log(
        `   tier a: DETECTED ix=${c.instructionIndex} autoApplicable=${c.autoApplicable} amount=${agreement}` +
          ` -> ${c.autoApplicable && agreement === 'exact' ? 'auto-match' : 'needs your decision (D21)'}`,
      );
    }
  }
  console.log('');
}
process.exit(exit);
