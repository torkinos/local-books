/**
 * D19 money backstop: two INCOMING rows that share an eventKey are the same money
 * seen from two watched addresses (a wallet and its own token account), and the
 * statement must sum it once. The add screen refuses token-account addresses; this
 * is the guarantee underneath it.
 */
import { describe, expect, it } from 'vitest';
import { buildIncomeStatement, toCsv } from '../src/report/index.js';
import type { IncomeRow } from '../src/report/index.js';
import { asAddress, asFiatCode, asUnixSeconds } from '../src/types/index.js';
import type { Valuation } from '../src/types/index.js';
import { chainEvent, sig, usdc, T } from './fixtures/fakes.js';

const GEL = asFiatCode('GEL');
const WALLET = asAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const TOKEN_ACCOUNT = asAddress('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const JAN_15 = asUnixSeconds(1_768_435_200);
const PERIOD_START = asUnixSeconds(1_767_225_600);
const PERIOD_END = asUnixSeconds(1_772_323_200);

const valuation = (fiatAmount: string): Valuation => ({
  fiat: GEL,
  rate: '2.7150',
  fiatAmount,
  source: 'nbg.gov.ge/official-rates',
  rateDate: T(1_768_400_000),
  fetchedAt: T(1_768_400_100),
});

const row = (event: IncomeRow['event'], fiat: string): IncomeRow => ({
  event,
  valuation: valuation(fiat),
  invoiceId: null,
  clientName: null,
  category: null,
});

describe('buildIncomeStatement counts one movement once across watched addresses', () => {
  it('a payment stored under the wallet AND its token account is summed once', () => {
    const viaWallet = chainEvent({ signature: sig(1), blockTime: JAN_15, amount: usdc('100'), watchedAddress: WALLET });
    const viaTokenAccount = chainEvent({
      signature: sig(1),
      blockTime: JAN_15,
      amount: usdc('100'),
      watchedAddress: TOKEN_ACCOUNT,
    });
    const statement = buildIncomeStatement(
      [row(viaWallet, '271.50'), row(viaTokenAccount, '271.50')],
      GEL,
      PERIOD_START,
      PERIOD_END,
    );
    expect(statement.rows).toHaveLength(1);
    expect(statement.totalFiat).toBe('271.50');
    expect(statement.unvaluedCount).toBe(0);
    // The CSV is built from the same rows, so it carries the payment once too.
    expect(toCsv(statement).trim().split('\n')).toHaveLength(2);
  });

  it('two different movements in one transaction are still two rows (different instruction index)', () => {
    const first = chainEvent({ signature: sig(2), instructionIndex: 0, blockTime: JAN_15, amount: usdc('10') });
    const second = chainEvent({ signature: sig(2), instructionIndex: 1, blockTime: JAN_15, amount: usdc('20') });
    const statement = buildIncomeStatement([row(first, '27.15'), row(second, '54.30')], GEL, PERIOD_START, PERIOD_END);
    expect(statement.rows).toHaveLength(2);
    expect(statement.totalFiat).toBe('81.45');
  });

  it('the in and out legs of a transfer between two watched wallets are not collapsed', () => {
    // D10: both sides of an internal move stay in the ledger; the out leg is not
    // income and the in leg is excluded as internal when the counterparty is own.
    const inLeg = chainEvent({ signature: sig(3), blockTime: JAN_15, amount: usdc('5'), direction: 'in', watchedAddress: WALLET, counterparty: TOKEN_ACCOUNT });
    const outLeg = chainEvent({ signature: sig(3), blockTime: JAN_15, amount: usdc('5'), direction: 'out', watchedAddress: TOKEN_ACCOUNT, counterparty: WALLET });
    const statement = buildIncomeStatement([row(inLeg, '13.58'), row(outLeg, '13.58')], GEL, PERIOD_START, PERIOD_END, {
      ownAddresses: new Set([WALLET, TOKEN_ACCOUNT]),
    });
    expect(statement.rows).toHaveLength(0);
    expect(statement.internalCount).toBe(1);
  });
});
