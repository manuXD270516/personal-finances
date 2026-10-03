import fc from 'fast-check';
import { currency, dec, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { NetWorthValuator, type ValuedAccount } from './net-worth-valuator.js';
import type { ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const RATES: Record<string, ExactRate> = {
  USDT: { base: 'USDT', quote: 'BOB', value: dec('6.95') },
  USD: { base: 'USD', quote: 'BOB', value: dec('6.96') },
};
const rateFor = (ccy: string) => RATES[ccy] ?? null;
const NUM_RUNS = Number(process.env['PF_PBT_RUNS'] ?? 100);

const CCYS: readonly Currency[] = [BOB, USD, USDT];
const TYPES = ['BANK', 'CASH', 'CRYPTO_WALLET', 'SAVINGS', 'CREDIT_CARD', 'LOAN'] as const;

/** Cuentas incluidas en el patrimonio con saldos aleatorios (pasivos: positivo = adeudado). */
const accounts = fc
  .array(
    fc.record({
      ccy: fc.nat({ max: CCYS.length - 1 }),
      type: fc.constantFrom(...TYPES),
      units: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
    }),
    { minLength: 2, maxLength: 10 },
  )
  .map((rows) =>
    rows.map((r, i): ValuedAccount => ({
      accountId: `a${i}`,
      type: r.type,
      nature: r.type === 'CREDIT_CARD' || r.type === 'LOAN' ? 'LIABILITY' : 'ASSET',
      includeInNetWorth: true,
      balance: Money.ofMinorUnits(r.units, CCYS[r.ccy] as Currency),
    })),
  );

/**
 * Transferencia sin fee entre dos cuentas de la MISMA moneda: el origen baja `x` en su efectivo; un pasivo destino
 * (pago de tarjeta) ve bajar su deuda `x`. En saldo presentado: activo −x/+x, pasivo +x/−x (docs/09 §6.4).
 */
function transfer(list: ValuedAccount[], from: number, to: number, units: bigint): ValuedAccount[] {
  const src = list[from] as ValuedAccount;
  const dst = list[to] as ValuedAccount;
  const amount = Money.ofMinorUnits(units, src.balance.currency);
  const out = (a: ValuedAccount) =>
    a.nature === 'ASSET' ? a.balance.subtract(amount) : a.balance.add(amount);
  const into = (a: ValuedAccount) =>
    a.nature === 'ASSET' ? a.balance.add(amount) : a.balance.subtract(amount);
  return list.map((a, i) =>
    i === from ? { ...a, balance: out(src) } : i === to ? { ...a, balance: into(dst) } : a,
  );
}

const nw = (list: readonly ValuedAccount[]) => NetWorthValuator.value(list, BOB, rateFor).netWorth;

describe('Propiedades del patrimonio neto (INV-009, INV-031, INV-010)', () => {
  it('[TC-REPORTING-NETWORTH-005] ∀ transferencia sin fee entre cuentas incluidas de la misma moneda: ΔNW = 0', () => {
    fc.assert(
      fc.property(accounts, fc.nat(), fc.nat(), fc.bigInt({ min: 1n, max: 10n ** 10n }), (list, i, j, x) => {
        const from = i % list.length;
        const ccy = (list[from] as ValuedAccount).balance.currency.code;
        const candidates = list
          .map((a, k) => ({ a, k }))
          .filter(({ a, k }) => k !== from && a.balance.currency.code === ccy);
        fc.pre(candidates.length > 0);
        const to = (candidates[j % candidates.length] as { k: number }).k;
        expect(nw(transfer(list, from, to, x)).eq(nw(list))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('[TC-REPORTING-NETWORTH-005] pago de tarjeta de 400.00 BOB desde Banco BOB no cambia el patrimonio (1006.50)', () => {
    const list: ValuedAccount[] = [
      {
        accountId: 'banco',
        type: 'BANK',
        nature: 'ASSET',
        includeInNetWorth: true,
        balance: Money.parse('685.00', BOB),
      },
      {
        accountId: 'caja',
        type: 'CASH',
        nature: 'ASSET',
        includeInNetWorth: true,
        balance: Money.parse('120.50', BOB),
      },
      {
        accountId: 'wallet',
        type: 'CRYPTO_WALLET',
        nature: 'ASSET',
        includeInNetWorth: true,
        balance: Money.parse('50.000000', USDT),
      },
      {
        accountId: 'visa',
        type: 'CREDIT_CARD',
        nature: 'LIABILITY',
        includeInNetWorth: true,
        balance: Money.parse('400.00', BOB),
      },
    ];
    const at1202 = (l: ValuedAccount[]) =>
      NetWorthValuator.value(l, BOB, () => ({ base: 'USDT', quote: 'BOB', value: dec('12.02') })).netWorth;
    expect(at1202(list).toFixed(2)).toBe('1006.50');
    expect(at1202(transfer(list, 0, 3, 40000n)).toFixed(2)).toBe('1006.50');
  });

  it('[TC-REPORTING-NETWORTH-005] conversión canónica 100.000000 USDT → 685.00 BOB (fee 5.00, cotizada 6.90) a 6.95: ΔNW = −10.00', () => {
    const before: ValuedAccount[] = [
      {
        accountId: 'usdt',
        type: 'CRYPTO_WALLET',
        nature: 'ASSET',
        includeInNetWorth: true,
        balance: Money.parse('100.000000', USDT),
      },
      {
        accountId: 'bob',
        type: 'BANK',
        nature: 'ASSET',
        includeInNetWorth: true,
        balance: Money.parse('0.00', BOB),
      },
    ];
    const after: ValuedAccount[] = [
      { ...(before[0] as ValuedAccount), balance: Money.parse('0.000000', USDT) },
      { ...(before[1] as ValuedAccount), balance: Money.parse('685.00', BOB) },
    ];
    expect(nw(after).minus(nw(before)).toFixed(2)).toBe('-10.00');
  });

  it('[TC-REPORTING-NETWORTH-005] ∀ conversión USDT→BOB: ΔNW = −(fees + spread) valorados a la tasa de valoración', () => {
    fc.assert(
      fc.property(
        accounts,
        fc.bigInt({ min: 1n, max: 10n ** 12n }), // origen en unidades de USDT
        fc.bigInt({ min: 600n, max: 800n }), // cotizada × 100 (6.00 … 8.00)
        fc.bigInt({ min: 0n, max: 100_000n }), // fee en unidades de BOB
        (base, srcUnits, quotedCents, feeUnits) => {
          const list: ValuedAccount[] = [
            ...base,
            {
              accountId: 'usdt',
              type: 'CRYPTO_WALLET',
              nature: 'ASSET',
              includeInNetWorth: true,
              balance: Money.ofMinorUnits(srcUnits, USDT),
            },
            {
              accountId: 'bob',
              type: 'BANK',
              nature: 'ASSET',
              includeInNetWorth: true,
              balance: Money.zero(BOB),
            },
          ];
          const source = Money.ofMinorUnits(srcUnits, USDT);
          const gross = source.amount.times(dec(quotedCents.toString()).div(100));
          const grossTarget = Money.roundToScale(gross, BOB);
          const fee = Money.ofMinorUnits(feeUnits, BOB);
          const net = grossTarget.subtract(fee);
          const after = list.map((a) =>
            a.accountId === 'usdt'
              ? { ...a, balance: Money.zero(USDT) }
              : a.accountId === 'bob'
                ? { ...a, balance: net }
                : a,
          );
          const spread = source.amount.times('6.95').minus(grossTarget.amount);
          const expected = fee.amount.plus(spread).neg();
          expect(nw(after).minus(nw(list)).eq(expected)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
