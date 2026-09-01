/**
 * valueEvents policy tests: which rows get a rate lookup at all, and how a failed
 * lookup degrades. The contract under test is "one unreachable rate leaves one
 * unvalued row" -- never an exception out of valueEvents, never an empty statement.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChainEvent,
  FiatCode,
  RateQuote,
  RatePort,
  Signature,
  TokenAmount,
  UnixSeconds,
} from '@local-books/core';
import { asAddress, asSignature, asUnixSeconds, eventKey } from '@local-books/core';
import { FIAT, valueEvents } from '../src/valuation.js';

const USDC_MINT = asAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const T = (n: number): UnixSeconds => asUnixSeconds(n);
const sig = (n: number): Signature => asSignature(`sig-${String(n).padStart(4, '0')}`);

const usdc = (whole: string): TokenAmount => {
  const [w = '0', f = ''] = whole.split('.');
  return {
    raw: BigInt(`${w}${f.padEnd(6, '0').slice(0, 6)}`),
    decimals: 6,
    mint: USDC_MINT,
    symbol: 'USDC',
  };
};

function chainEvent(overrides: Partial<ChainEvent> = {}): ChainEvent {
  return {
    kind: 'spl-transfer',
    signature: sig(1),
    instructionIndex: 0,
    slot: 1,
    blockTime: T(1_768_435_200), // 2026-01-15 UTC
    watchedAddress: asAddress('watched-address'),
    counterparty: asAddress('client-address'),
    direction: 'in',
    amount: usdc('100'),
    memo: null,
    references: [],
    succeeded: true,
    ...overrides,
  } as ChainEvent;
}

/** Records every (fiat, date) lookup; throws for dates listed in `failDates`. */
class RecordingRates implements RatePort {
  readonly calls: Array<{ fiat: FiatCode; date: UnixSeconds }> = [];

  constructor(private readonly failDates: ReadonlySet<number> = new Set()) {}

  async getUsdRate(fiat: FiatCode, date: UnixSeconds): Promise<RateQuote> {
    this.calls.push({ fiat, date });
    if (this.failDates.has(date)) throw new Error(`NBG rate for ${date} unreachable`);
    return {
      rate: '2.7000',
      source: 'nbg.gov.ge/official-rates',
      rateDate: date,
      fetchedAt: T(1_800_000_000),
    };
  }
}

describe('valueEvents', () => {
  it('attempts only rows that can appear as valued income; skips are not failures', async () => {
    const sol: TokenAmount = { raw: 1_000_000_000n, decimals: 9, mint: null, symbol: 'SOL' };
    const events = [
      chainEvent({ signature: sig(1) }), // the one qualifying row
      chainEvent({ signature: sig(2), direction: 'out' }),
      chainEvent({ signature: sig(3), succeeded: false }),
      chainEvent({ signature: sig(4), blockTime: null }),
      chainEvent({ signature: sig(5), amount: sol }), // non-stable: never attempted
    ];
    const rates = new RecordingRates();

    const result = await valueEvents(events, rates, FIAT);

    expect(rates.calls).toHaveLength(1);
    expect(result.valuations.size).toBe(1);
    expect(result.valuations.has(eventKey(events[0]!))).toBe(true);
    expect(result.failures).toBe(0);
    expect(result.firstError).toBeNull();
  });

  it('keys valuations by eventKey and passes rate provenance through intact', async () => {
    const event = chainEvent({ signature: sig(7), instructionIndex: 3 });
    const rates = new RecordingRates();

    const result = await valueEvents([event], rates, FIAT);

    // The lookup used the event's own receipt date and the requested fiat.
    expect(rates.calls).toEqual([{ fiat: FIAT, date: event.blockTime }]);

    const valuation = result.valuations.get(eventKey(event));
    expect(valuation).toEqual({
      fiat: FIAT,
      rate: '2.7000',
      fiatAmount: '270.00', // 100 USDC at 2.7000, exact
      source: 'nbg.gov.ge/official-rates',
      rateDate: event.blockTime,
      fetchedAt: T(1_800_000_000),
    });
  });

  it('a failed lookup is counted and remembered while the other rows still get valued', async () => {
    const badDate = 1_770_681_600; // 2026-02-10
    const events = [
      chainEvent({ signature: sig(1), blockTime: T(1_768_435_200) }),
      chainEvent({ signature: sig(2), blockTime: T(badDate) }),
      chainEvent({ signature: sig(3), blockTime: T(1_768_435_200), amount: usdc('50') }),
    ];
    const rates = new RecordingRates(new Set([badDate]));

    const result = await valueEvents(events, rates, FIAT);

    expect(result.failures).toBe(1);
    expect(result.firstError).toBe(`NBG rate for ${badDate} unreachable`);
    expect(result.valuations.size).toBe(2);
    expect(result.valuations.has(eventKey(events[0]!))).toBe(true);
    expect(result.valuations.has(eventKey(events[1]!))).toBe(false);
    expect(result.valuations.has(eventKey(events[2]!))).toBe(true);
  });

  it('empty input yields an empty result, not an error', async () => {
    const rates = new RecordingRates();
    const result = await valueEvents([], rates, FIAT);

    expect(result.valuations.size).toBe(0);
    expect(result.failures).toBe(0);
    expect(result.firstError).toBeNull();
    expect(rates.calls).toHaveLength(0);
  });
});
