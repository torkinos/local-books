/**
 * Solana Pay transfer-request URLs (T20's pure half). What matters: exact decimal
 * amounts straight from the bigint, spec-shaped fields, byte-stable output (the QR
 * payload and S2/S3's fixtures both depend on the string not wobbling).
 */
import { describe, expect, it } from 'vitest';
import { transferRequestUrl } from '../src/pay/index.js';
import { formatUnitsTrimmed } from '../src/value/index.js';
import { asAddress, asReferenceKey } from '../src/types/index.js';
import type { TokenAmount } from '../src/types/index.js';

const RECIPIENT = asAddress('mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX1ncyp98M9W');
const USDC = asAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const REF = asReferenceKey('Ref1111111111111111111111111111111111111111');

const usdc = (raw: bigint): TokenAmount => ({ raw, decimals: 6, mint: USDC, symbol: 'USDC' });

describe('transferRequestUrl', () => {
  it('builds a spec-shaped SPL transfer request', () => {
    const url = transferRequestUrl({
      recipient: RECIPIENT,
      amount: usdc(1_250_500_000n),
      reference: REF,
      label: 'Local Books',
      message: 'Invoice for design work',
    });
    expect(url).toBe(
      `solana:${RECIPIENT}?amount=1250.5&spl-token=${USDC}&reference=${REF}` +
        '&label=Local%20Books&message=Invoice%20for%20design%20work',
    );
  });

  it('native SOL omits spl-token, and the amount is exact in user units', () => {
    const url = transferRequestUrl({
      recipient: RECIPIENT,
      amount: { raw: 50_000_000n, decimals: 9, mint: null, symbol: 'SOL' },
      reference: REF,
    });
    expect(url).toBe(`solana:${RECIPIENT}?amount=0.05&reference=${REF}`);
    expect(url).not.toContain('spl-token');
  });

  it('never emits exponent notation or float drift, even at extremes', () => {
    // These fixtures are chosen to KILL a float implementation, not merely to look
    // extreme (mutation-verified): a double renders the first as ...123.45679, the
    // second as 90000000000 flat, and the third as 1e-9.
    expect(formatUnitsTrimmed(123_456_789_123_456_789n, 6)).toBe('123456789123.456789');
    expect(formatUnitsTrimmed(90_000_000_000_000_001n, 6)).toBe('90000000000.000001');
    expect(
      transferRequestUrl({
        recipient: RECIPIENT,
        amount: { raw: 1n, decimals: 9, mint: null, symbol: 'SOL' },
        reference: REF,
      }),
    ).toContain('amount=0.000000001&');
    expect(transferRequestUrl({ recipient: RECIPIENT, amount: usdc(90_000_000_000_000_000n), reference: REF }))
      .toContain('amount=90000000000&');
    expect(transferRequestUrl({ recipient: RECIPIENT, amount: usdc(1n), reference: REF })).toContain(
      'amount=0.000001&',
    );
    expect(transferRequestUrl({ recipient: RECIPIENT, amount: usdc(1n), reference: REF })).not.toMatch(/e[+-]?\d/i);
  });

  it('whole amounts trim to a price tag: 1.000000 -> 1', () => {
    expect(transferRequestUrl({ recipient: RECIPIENT, amount: usdc(1_000_000n), reference: REF })).toContain(
      'amount=1&',
    );
  });

  it('URL-encodes display fields, including the on-chain memo', () => {
    const url = transferRequestUrl({
      recipient: RECIPIENT,
      amount: usdc(1_000_000n),
      reference: REF,
      label: 'ჩემი წიგნები', // Georgian: the beachhead market's alphabet must survive
      memo: 'a&b=c #5',
    });
    expect(url).toContain('label=%E1%83%A9');
    expect(url).toContain('memo=a%26b%3Dc%20%235');
    // The raw separators never leak into the query structure.
    expect(url.split('&').every((part) => !part.includes(' '))).toBe(true);
  });

  it('is byte-stable: the full six-field URL is pinned verbatim', () => {
    // Not a same-call-twice tautology: QR payloads and the S2/S3 fixtures depend on
    // this exact string across versions, memo position included -- a reordering
    // refactor must fail here.
    const url = transferRequestUrl({
      recipient: RECIPIENT,
      amount: usdc(5_000_000n),
      reference: REF,
      label: 'x',
      message: 'y',
      memo: 'z',
    });
    expect(url).toBe(
      `solana:${RECIPIENT}?amount=5&spl-token=${USDC}&reference=${REF}&label=x&message=y&memo=z`,
    );

    const sol = transferRequestUrl({
      recipient: RECIPIENT,
      amount: { raw: 1_000_000_000n, decimals: 9, mint: null, symbol: 'SOL' },
      reference: REF,
      label: 'x',
      memo: 'z',
    });
    expect(sol).toBe(`solana:${RECIPIENT}?amount=1&reference=${REF}&label=x&memo=z`);
  });
});

describe('formatUnitsTrimmed', () => {
  it('trims fraction zeros only, never significant digits', () => {
    expect(formatUnitsTrimmed(1_000_000n, 6)).toBe('1');
    expect(formatUnitsTrimmed(1_500_000n, 6)).toBe('1.5');
    expect(formatUnitsTrimmed(1_234_567n, 6)).toBe('1.234567');
    expect(formatUnitsTrimmed(0n, 6)).toBe('0');
    expect(formatUnitsTrimmed(10n, 0)).toBe('10');
    expect(formatUnitsTrimmed(-1_500_000n, 6)).toBe('-1.5');
  });
});
