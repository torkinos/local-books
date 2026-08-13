/**
 * Valuation: income in local fiat at receipt date (PROJECT.md lines 83-86).
 *
 * Two legs, and only one of them is interesting:
 *   - token -> USD: stablecoins are treated 1:1 (line 85).
 *   - USD -> local: the official daily rate, which is what a filing actually uses.
 *     For the beachhead that is the National Bank of Georgia's published rate.
 *
 * Every valuation records source, rate, and date because the output has to survive an
 * accountant asking "where did this number come from?" years later (line 86). The types
 * make that mandatory rather than encouraged -- there is no way to build a Valuation
 * without a source.
 *
 * All arithmetic is integer-based. Decimal strings in, decimal strings out, bigint in
 * the middle. Floats are never used on money: 0.1 + 0.2 is a rounding error, and a
 * rounding error in a turnover report is a wrong tax filing.
 */
import type { RatePort } from '../ports/index.js';
import type { FiatCode, TokenAmount, UnixSeconds, Valuation } from '../types/index.js';

/** Mints treated as 1.00 USD. Anything absent needs a real price (deferred to v2). */
export const STABLE_MINTS: ReadonlyMap<string, string> = new Map([
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'],
]);

export function isStable(amount: TokenAmount): boolean {
  return amount.mint !== null && STABLE_MINTS.has(amount.mint);
}

/**
 * Value a received amount in local fiat.
 *
 * Throws on non-stable mints rather than guessing. v0.1 scope is stablecoin income
 * (line 38); a SOL payment must fail loudly and be handled by the user rather than be
 * booked at a rate we invented.
 */
export async function valueAtReceipt(
  amount: TokenAmount,
  receivedAt: UnixSeconds,
  fiat: FiatCode,
  rates: RatePort,
): Promise<Valuation> {
  if (!isStable(amount)) {
    throw new UnsupportedValuationError(
      `No price source for mint ${amount.mint ?? 'native SOL'}. v0.1 values stablecoin income only.`,
    );
  }

  const quote = await rates.getUsdRate(fiat, receivedAt);
  const usd = formatUnits(amount.raw, amount.decimals);

  return {
    fiat,
    rate: quote.rate,
    fiatAmount: multiplyDecimals(usd, quote.rate, 2),
    source: quote.source,
    rateDate: quote.rateDate,
    fetchedAt: quote.fetchedAt,
  };
}

export class UnsupportedValuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedValuationError';
  }
}

/** Smallest-unit bigint -> decimal string. `1234567n` at 6 decimals -> `"1.234567"`. */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? '' : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Decimal string -> smallest-unit bigint. Throws rather than truncating silently. */
export function parseUnits(value: string, decimals: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Not a decimal number: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new RangeError(`${value} has more than ${decimals} decimal places`);
  }
  const scaled = `${whole}${fraction.padEnd(decimals, '0')}`;
  return BigInt(sign === '-' ? `-${scaled}` : scaled);
}

/**
 * Multiply two decimal strings, rounding half-up to `resultDecimals`.
 *
 * Half-up because that is what accountants and tax authorities expect; banker's
 * rounding would produce numbers that disagree with the client's own books.
 */
export function multiplyDecimals(a: string, b: string, resultDecimals: number): string {
  const SCALE = 12; // Ample headroom for FX rates, which run to ~4-6 places.
  const scaledA = parseUnits(a, SCALE);
  const scaledB = parseUnits(b, SCALE);
  const product = scaledA * scaledB; // now at 2 * SCALE

  const dropDigits = BigInt(2 * SCALE - resultDecimals);
  const divisor = 10n ** dropDigits;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return formatUnits(negative ? -rounded : rounded, resultDecimals);
}
