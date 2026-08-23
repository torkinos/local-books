/**
 * Valuation tests (T24). The half-up cases are the ones float arithmetic gets wrong:
 * 2.675 * 100 in IEEE 754 is 267.49999…, so a float implementation rounds to 2.67 and
 * the books disagree with the accountant's calculator by a cent.
 */
import { describe, expect, it } from 'vitest';
import type { RatePort, RateQuote } from '../src/ports/index.js';
import { asAddress, asFiatCode } from '../src/types/index.js';
import type { FiatCode, TokenAmount, UnixSeconds } from '../src/types/index.js';
import {
  formatUnits,
  multiplyDecimals,
  parseUnits,
  UnsupportedValuationError,
  valueAtReceipt,
} from '../src/value/index.js';
import { usdc, T } from './fixtures/fakes.js';

const GEL = asFiatCode('GEL');

class FakeRates implements RatePort {
  requests: Array<{ fiat: FiatCode; date: UnixSeconds }> = [];
  constructor(private readonly quote: RateQuote) {}
  async getUsdRate(fiat: FiatCode, date: UnixSeconds): Promise<RateQuote> {
    this.requests.push({ fiat, date });
    return this.quote;
  }
}

const nbgQuote: RateQuote = {
  rate: '2.7150',
  source: 'nbg.gov.ge/official-rates',
  rateDate: T(1_760_000_000),
  fetchedAt: T(1_760_005_000),
};

describe('multiplyDecimals: half-up at 2 dp', () => {
  it.each([
    ['2.675', '1', '2.68'],
    ['1.005', '1', '1.01'],
    ['1.004', '1', '1.00'],
    ['0.005', '1', '0.01'],
    ['0.004999', '1', '0.00'],
    ['100', '2.7150', '271.50'],
    ['0.5', '2.7150', '1.36'], // 1.3575 rounds up
    ['123.456789', '2.715', '335.19'], // 335.185182135 exactly, from integer math
  ])('%s x %s -> %s', (a, b, expected) => {
    expect(multiplyDecimals(a, b, 2)).toBe(expected);
  });

  it('rounds a negative half away from zero, mirroring the positive case', () => {
    expect(multiplyDecimals('-2.675', '1', 2)).toBe('-2.68');
  });
});

describe('formatUnits / parseUnits', () => {
  it('round-trips smallest units through decimal strings', () => {
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(1_234_567n, 6)).toBe('1.234567');
    expect(formatUnits(-1_234_567n, 6)).toBe('-1.234567');
    expect(parseUnits('1.234567', 6)).toBe(1_234_567n);
    expect(parseUnits(formatUnits(987_654_321n, 9), 9)).toBe(987_654_321n);
  });

  it('parseUnits throws on excess precision instead of truncating silently', () => {
    expect(() => parseUnits('1.2345678', 6)).toThrow(RangeError);
    expect(() => parseUnits('not-a-number', 6)).toThrow(RangeError);
  });
});

describe('valueAtReceipt', () => {
  it('values stablecoin income at the receipt-date rate with full provenance', async () => {
    const rates = new FakeRates(nbgQuote);
    const valuation = await valueAtReceipt(usdc('100'), T(1_760_000_100), GEL, rates);

    expect(valuation.fiatAmount).toBe('271.50');
    expect(valuation.rate).toBe('2.7150');
    // Provenance is mandatory (PROJECT.md line 86): source, rate date, fetch time all
    // arrive from the quote, none invented here.
    expect(valuation.source).toBe('nbg.gov.ge/official-rates');
    expect(valuation.rateDate).toBe(nbgQuote.rateDate);
    expect(valuation.fetchedAt).toBe(nbgQuote.fetchedAt);
    expect(valuation.fiat).toBe(GEL);
    // The receipt date -- not "now" -- is what the adapter was asked for.
    expect(rates.requests).toEqual([{ fiat: GEL, date: T(1_760_000_100) }]);
  });

  it('throws loudly on a non-stable mint instead of inventing a rate', async () => {
    const sol: TokenAmount = { raw: 1_000_000_000n, decimals: 9, mint: null, symbol: 'SOL' };
    const rates = new FakeRates(nbgQuote);
    await expect(valueAtReceipt(sol, T(1), GEL, rates)).rejects.toThrow(UnsupportedValuationError);
    // And it never consulted the rate source for something it refuses to value.
    expect(rates.requests).toEqual([]);
  });

  it('rejects an unknown SPL mint, not just native SOL', async () => {
    const unknownMint: TokenAmount = {
      ...usdc('5'),
      mint: asAddress('Bonk111111111111111111111111111111111111111'),
    };
    await expect(valueAtReceipt(unknownMint, T(1), GEL, new FakeRates(nbgQuote))).rejects.toThrow(
      UnsupportedValuationError,
    );
  });
});
