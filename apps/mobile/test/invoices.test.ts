/**
 * T18 + auto-match tests.
 *
 * The T18 acceptance line -- "an invoice round-trips through the op log and appears
 * in the projection; amounts stay bigint end to end" -- is tested against REAL
 * SQLite including a close-and-reopen, because the round-trip that matters is
 * op -> serde -> disk -> serde -> projection, and bigint is exactly what naive JSON
 * would destroy. Matching policy (PROJECT.md line 81): only unambiguous reference
 * candidates auto-apply, at transaction level (core) AND at pass level (two
 * transactions claiming one invoice -- a human decides which).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address, ChainEvent, ReferenceKey, UnixSeconds } from '@local-books/core';
import {
  asAddress,
  asReferenceKey,
  asSignature,
  asUnixSeconds,
  project,
  withOverdue,
} from '@local-books/core';
import { createSqliteStorage, type SqlExecutor } from '../src/storage/sqliteStorage.js';
import { addressWatchedOp, invoiceCreatedOp, matchConfirmedOp, matchRejectedOp } from '../src/ops.js';
import type { InvoiceFields } from '../src/ops.js';
import { autoMatchOps } from '../src/matching.js';
import { validateInvoiceDraft, dueDateFromYmd, ymdAfterDays } from '../src/ui/invoiceForm.js';
import type { InvoiceToken } from '../src/tokens.js';

const { DatabaseSync: OpenDatabase } = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(name: 'node:sqlite'): { DatabaseSync: new (path: string) => DatabaseSync };
    };
  }
).process.getBuiltinModule('node:sqlite');

function makeExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql, params = []) {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: db.prepare(sql).all(...params) };
      }
      if (params.length === 0) {
        db.exec(sql);
        return { rows: [] };
      }
      db.prepare(sql).run(...params);
      return { rows: [] };
    },
  };
}

const WATCHED = asAddress('watched-address');
const AT = asUnixSeconds(1_700_000_000);
const USDC_DEVNET = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN = { mint: USDC_DEVNET, decimals: 6, symbol: 'USDC' };
const REF = asReferenceKey('Ref1111111111111111111111111111111111111111');

const fields = (overrides: Partial<InvoiceFields> = {}): InvoiceFields => ({
  clientName: 'Acme Corp',
  lineItems: [
    { description: 'Design', quantity: 3, unitAmount: 400_000_000n }, // 3 x 400 USDC
    { description: 'Hosting', quantity: 1, unitAmount: 50_500_000n }, // 50.50 USDC
  ],
  token: TOKEN,
  dueDate: asUnixSeconds(AT + 14 * 86_400),
  reference: REF,
  payTo: WATCHED,
  ...overrides,
});

const paymentEvent = (
  overrides: Omit<Partial<ChainEvent>, 'signature'> & { readonly signature?: string } = {},
): ChainEvent => {
  const { signature, ...rest } = overrides;
  return {
    kind: 'spl-transfer',
    instructionIndex: 0,
    slot: 10,
    blockTime: asUnixSeconds(AT + 3600),
    watchedAddress: WATCHED,
    counterparty: asAddress('client-wallet'),
    direction: 'in',
    amount: { raw: 1_250_500_000n, decimals: 6, mint: USDC_DEVNET, symbol: 'USDC' },
    memo: null,
    references: [REF],
    succeeded: true,
    ...rest,
    signature: asSignature(signature ?? 'pay-sig-1'),
  };
};

describe('invoiceCreatedOp', () => {
  it('computes the bigint total from line items and uses the reference as invoiceId', () => {
    const op = invoiceCreatedOp(fields(), AT);
    expect(op.total.raw).toBe(1_250_500_000n); // 1250.50 USDC, exact
    expect(op.total.mint).toBe(USDC_DEVNET);
    expect(op.invoiceId).toBe(REF);
    expect(op.reference).toBe(REF);
    expect(op.at).toBe(AT);
  });

  it('is content-addressed: same decision, same id; different decision, different id', () => {
    const a = invoiceCreatedOp(fields(), AT);
    const b = invoiceCreatedOp(fields(), AT);
    const c = invoiceCreatedOp(fields({ clientName: 'Other Client' }), AT);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});

describe('invoice round-trip through the real op log (T18 acceptance)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lb-invoice-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('survives serde + disk + restart with the exact bigint total, and appears open', async () => {
    const path = join(dir, 'books.db');
    const first = new OpenDatabase(path);
    const storage = await createSqliteStorage(makeExecutor(first));
    await storage.appendOps([
      addressWatchedOp(WATCHED, 'Income', AT),
      invoiceCreatedOp(fields(), AT),
    ]);
    first.close();

    // Restart: a different connection reads what actually hit the disk.
    const second = new OpenDatabase(path);
    const reopened = await createSqliteStorage(makeExecutor(second));
    const state = project(await reopened.readOps(), []);

    expect(state.invoices).toHaveLength(1);
    const view = state.invoices[0]!;
    expect(view.status).toBe('open');
    expect(view.invoice.total.raw).toBe(1_250_500_000n);
    expect(typeof view.invoice.total.raw).toBe('bigint');
    expect(view.invoice.lineItems[0]!.unitAmount).toBe(400_000_000n);
    second.close();
  });

  it('overdue is applied at read time, never folded in', () => {
    const ops = [addressWatchedOp(WATCHED, 'Income', AT), invoiceCreatedOp(fields(), AT)];
    const state = project(ops, []);
    expect(state.invoices[0]!.status).toBe('open');
    const later = asUnixSeconds(AT + 15 * 86_400);
    expect(withOverdue(state, later).invoices[0]!.status).toBe('overdue');
  });
});

describe('autoMatchOps', () => {
  const baseOps = [addressWatchedOp(WATCHED, 'Income', AT), invoiceCreatedOp(fields(), AT)];

  it('confirms an unambiguous reference payment, and the fold shows the invoice paid', () => {
    const event = paymentEvent();
    const state = project(baseOps, [event]);
    expect(state.unmatchedEvents).toHaveLength(1);

    const ops = autoMatchOps(state, asUnixSeconds(AT + 4000));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'match-confirmed',
      invoiceId: REF,
      signature: event.signature,
      via: 'reference',
    });

    const after = project([...baseOps, ...ops], [event]);
    expect(after.invoices[0]!.status).toBe('paid');
    expect(after.unmatchedEvents).toHaveLength(0);
    // Idempotent: nothing left to match.
    expect(autoMatchOps(after, asUnixSeconds(AT + 5000))).toHaveLength(0);
  });

  it('a duplicate hiding inside an AMBIGUOUS transaction still blocks its clean twin', () => {
    // Invoice X gets a clean single-transfer payment in tx-1 AND is claimed inside a
    // batched two-invoice settlement (tx-2, ambiguous per core, nothing auto there).
    // Two on-chain payments claim X; the ambiguity of one of them must not launder
    // the other into an auto-confirm -- the pass-level count covers ALL claims.
    const refY = asReferenceKey('RefY111111111111111111111111111111111111111');
    const invoiceY = invoiceCreatedOp(fields({ reference: refY }), asUnixSeconds(AT + 1));
    const ops = [...baseOps, invoiceY];
    const clean = paymentEvent({ signature: 'tx-1' });
    const batched1 = paymentEvent({ signature: 'tx-2', instructionIndex: 0, references: [REF, refY] });
    const batched2 = paymentEvent({ signature: 'tx-2', instructionIndex: 1, references: [REF, refY] });

    const state = project(ops, [clean, batched1, batched2]);
    expect(autoMatchOps(state, AT)).toHaveLength(0);
  });

  it('auto-applies only an EXACT amount: dust, partial, over, and wrong-token stay human calls', () => {
    // Solana Pay lets the payer edit the amount before signing; the payer must not
    // control when the books say "paid". Invoice total is 1250.50 USDC.
    const dust = paymentEvent({ amount: { raw: 1n, decimals: 6, mint: USDC_DEVNET, symbol: 'USDC' } });
    expect(autoMatchOps(project(baseOps, [dust]), AT)).toHaveLength(0);
    expect(project(baseOps, [dust]).invoices[0]!.status).toBe('open');

    const over = paymentEvent({
      amount: { raw: 2_000_000_000n, decimals: 6, mint: USDC_DEVNET, symbol: 'USDC' },
    });
    expect(autoMatchOps(project(baseOps, [over]), AT)).toHaveLength(0);

    const wrongToken = paymentEvent({
      amount: { raw: 1_250_500_000n, decimals: 9, mint: null, symbol: 'SOL' },
    });
    expect(autoMatchOps(project(baseOps, [wrongToken]), AT)).toHaveLength(0);
  });

  it('does NOT auto-apply when two transactions both carry the same invoice reference', () => {
    // The client paid twice. The chain does not say which payment settles the
    // invoice and which is the duplicate -- a human decides; both stay visible.
    const state = project(baseOps, [
      paymentEvent({ signature: 'pay-sig-1' }),
      paymentEvent({ signature: 'pay-sig-2', slot: 11 }),
    ]);
    expect(autoMatchOps(state, AT)).toHaveLength(0);
  });

  it('ignores paid invoices: a later payment with the same reference stays an unexplained deposit', () => {
    const settle = paymentEvent({ signature: 'pay-sig-1' });
    const settleOps = autoMatchOps(project(baseOps, [settle]), AT);
    const paidOps = [...baseOps, ...settleOps];

    const late = paymentEvent({ signature: 'pay-sig-3', slot: 20 });
    const state = project(paidOps, [settle, late]);
    expect(state.invoices[0]!.status).toBe('paid');
    expect(autoMatchOps(state, AT)).toHaveLength(0);
    expect(state.unmatchedEvents.map((e) => e.signature)).toEqual([late.signature]);
  });

  it('an overdue invoice paid late still auto-matches', () => {
    const event = paymentEvent();
    const state = withOverdue(project(baseOps, [event]), asUnixSeconds(AT + 20 * 86_400));
    expect(state.invoices[0]!.status).toBe('overdue');
    expect(autoMatchOps(state, AT)).toHaveLength(1);
  });

  it('never re-applies a pair a human rejected -- rejection outranks automation forever', () => {
    // Confirm -> human rejects -> event returns to unmatched, invoice reopens. The
    // machine must NOT re-confirm the same pair on the next refresh; that would
    // override a recorded human decision (D4's compensating-op semantics).
    const event = paymentEvent();
    const confirm = autoMatchOps(project(baseOps, [event]), AT);
    const reject = matchRejectedOp(REF, event.signature, event.instructionIndex, asUnixSeconds(AT + 100));

    const state = project([...baseOps, ...confirm, reject], [event]);
    expect(state.invoices[0]!.status).toBe('open'); // the reject took effect
    expect(state.unmatchedEvents).toHaveLength(1); // the deposit is visible again
    expect(autoMatchOps(state, asUnixSeconds(AT + 200))).toHaveLength(0); // and stays a human call
  });

  it('matchConfirmedOp refuses anything but an unambiguous reference candidate', () => {
    expect(() =>
      matchConfirmedOp(
        {
          invoiceId: 'x',
          signature: asSignature('s'),
          instructionIndex: 0,
          tier: 'reference',
          autoApplicable: false,
          rationale: 'ambiguous',
        },
        AT,
      ),
    ).toThrow(/human/);
  });
});

describe('validateInvoiceDraft', () => {
  const token: InvoiceToken = { label: 'USDC (devnet)', ...TOKEN };
  const draft = (over: Record<string, unknown> = {}) => ({
    clientName: 'Acme Corp',
    lineItems: [{ description: 'Design', quantityText: '3', unitPriceText: '400' }],
    token,
    dueDateText: '2026-09-14',
    payTo: WATCHED as Address | null,
    ...over,
  });

  it('accepts a complete draft and previews the exact total', () => {
    const result = validateInvoiceDraft(draft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalLabel).toBe('1200 USDC');
      expect(result.lineItems[0]!.unitAmount).toBe(400_000_000n);
    }
  });

  it('rejects fractional quantities with a pointer to unit price', () => {
    const result = validateInvoiceDraft(
      draft({ lineItems: [{ description: 'Hours', quantityText: '2.5', unitPriceText: '50' }] }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toMatch(/whole number/);
  });

  it('rejects prices with too many decimals rather than truncating', () => {
    const result = validateInvoiceDraft(
      draft({ lineItems: [{ description: 'X', quantityText: '1', unitPriceText: '1.1234567' }] }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toMatch(/6 decimal/);
  });

  it('rejects a zero total, a missing payTo, and a rolled-over date', () => {
    expect(
      validateInvoiceDraft(
        draft({ lineItems: [{ description: 'X', quantityText: '3', unitPriceText: '0' }] }),
      ).ok,
    ).toBe(false);
    expect(validateInvoiceDraft(draft({ payTo: null })).ok).toBe(false);
    expect(validateInvoiceDraft(draft({ dueDateText: '2026-02-30' })).ok).toBe(false);
  });
});

describe('due date helpers', () => {
  it('parses to LOCAL end of day so "due today" is not overdue at noon', () => {
    const due = dueDateFromYmd('2026-09-14')!;
    const date = new Date(due * 1000);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(14);
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(dueDateFromYmd('2026-02-30')).toBeNull();
    expect(dueDateFromYmd('2026-13-01')).toBeNull();
    expect(dueDateFromYmd('not-a-date')).toBeNull();
  });

  it('ymdAfterDays walks the local calendar, crossing month ends', () => {
    // 2026-08-31 local + 7 days = 2026-09-07 (constructed from a local-noon
    // timestamp so the test is timezone-independent).
    const noonAug31 = asUnixSeconds(Math.floor(new Date(2026, 7, 31, 12, 0, 0).getTime() / 1000));
    expect(ymdAfterDays(noonAug31, 7)).toBe('2026-09-07');
    expect(ymdAfterDays(noonAug31, 30)).toBe('2026-09-30');
  });
});
