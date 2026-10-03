import { currency, dec, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { NetWorthValuator, type ValuedAccount } from './net-worth-valuator.js';
import { present, type ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const USDT_BOB: ExactRate = { base: 'USDT', quote: 'BOB', value: dec('12.02') };
const rateFor = (ccy: string) => (ccy === 'USDT' ? USDT_BOB : null);

const acc = (
  accountId: string,
  type: string,
  balance: Money,
  over: Partial<ValuedAccount> = {},
): ValuedAccount => ({
  accountId,
  type,
  nature: ['CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY'].includes(type) ? 'LIABILITY' : 'ASSET',
  includeInNetWorth: true,
  balance,
  ...over,
});

/** Ejemplo canónico: Banco BOB 685.00, Caja BOB 120.50, Wallet USDT 50.000000 y Visa adeudando 400.00 BOB. */
const EXAMPLE: ValuedAccount[] = [
  acc('banco', 'BANK', Money.parse('685.00', BOB)),
  acc('caja', 'CASH', Money.parse('120.50', BOB)),
  acc('wallet', 'CRYPTO_WALLET', Money.parse('50.000000', USDT)),
  acc('visa', 'CREDIT_CARD', Money.parse('400.00', BOB)),
];
const show = (v: Parameters<typeof present>[0]) => present(v, BOB).toString();

describe('NetWorthValuator (docs/14 §4: NW = Σ conv_v(activos) − Σ conv_v(pasivos))', () => {
  it('[TC-REPORTING-NETWORTH-001] activos 1406.50, pasivos 400.00 y patrimonio 1006.50 BOB', () => {
    const nw = NetWorthValuator.value(EXAMPLE, BOB, rateFor);
    expect(show(nw.assets)).toBe('1406.50 BOB');
    expect(show(nw.liabilities)).toBe('400.00 BOB');
    expect(show(nw.netWorth)).toBe('1006.50 BOB');
    expect(nw.complete).toBe(true);
    expect(nw.convertedCurrencies).toEqual(['USDT']);
  });

  it('[TC-REPORTING-NETWORTH-002] desglose por moneda y por tipo de cuenta', () => {
    const nw = NetWorthValuator.value(EXAMPLE, BOB, rateFor);
    expect(
      nw.byCurrency.map((c) => [
        c.currency.code,
        c.assets.toFixed(),
        c.liabilities.toFixed(),
        c.net.toFixed(),
        c.converted === null ? null : present(c.converted, BOB).toFixed(),
      ]),
    ).toEqual([
      ['BOB', '805.50', '400.00', '405.50', '405.50'],
      ['USDT', '50.000000', '0.000000', '50.000000', '601.00'],
    ]);
    const byType = Object.fromEntries(
      nw.byAccountType.map((t) => [t.type, present(t.amount, BOB).toFixed()]),
    );
    expect(byType).toEqual({
      BANK: '685.00',
      CASH: '120.50',
      CRYPTO_WALLET: '601.00',
      CREDIT_CARD: '-400.00',
    });
    const sum = nw.byAccountType.reduce((a, t) => a.plus(t.amount), dec('0'));
    expect(show(sum)).toBe('1006.50 BOB');
  });

  it('[TC-REPORTING-NETWORTH-003] una cuenta excluida del patrimonio no suma', () => {
    const nw = NetWorthValuator.value(
      [...EXAMPLE, acc('oficina', 'CASH', Money.parse('1000.00', BOB), { includeInNetWorth: false })],
      BOB,
      rateFor,
    );
    expect(show(nw.netWorth)).toBe('1006.50 BOB');
  });

  it('[TC-REPORTING-NETWORTH-004] sin tasa BTC el patrimonio queda incompleto y lista el BTC no valorado', () => {
    const nw = NetWorthValuator.value(
      [...EXAMPLE, acc('btc', 'CRYPTO_WALLET', Money.parse('0.01000000', BTC))],
      BOB,
      rateFor,
    );
    expect(show(nw.netWorth)).toBe('1006.50 BOB');
    expect(nw.complete).toBe(false);
    expect(nw.unvalued.map(String)).toEqual(['0.01000000 BTC']);
    expect(nw.byCurrency.find((c) => c.currency.code === 'BTC')?.converted).toBeNull();
  });

  it('un pasivo con saldo a favor (negativo) reduce los pasivos', () => {
    const nw = NetWorthValuator.value([acc('visa', 'CREDIT_CARD', Money.parse('-10.00', BOB))], BOB, rateFor);
    expect(show(nw.netWorth)).toBe('10.00 BOB');
  });
});
