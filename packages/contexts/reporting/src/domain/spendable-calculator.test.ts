import fc from 'fast-check';
import { currency, dec, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  SpendableCalculator,
  type SpendableAccount,
  type SpendableCommittedItem,
  type SpendableInput,
  type SpendablePlanned,
  type SpendableReservation,
} from './spendable-calculator.js';
import type { ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const OCT = { from: '2026-10-01', to: '2026-10-31' };

const account = (accountId: string, name: string, balance: Money): SpendableAccount => ({
  accountId,
  name,
  balance,
});
const reservation = (accountId: string, reserved: Money): SpendableReservation => ({ accountId, reserved });

function item(over: Partial<SpendableCommittedItem> & Pick<SpendableCommittedItem, 'id' | 'name'>) {
  const base: SpendableCommittedItem = {
    source: 'OCCURRENCE',
    definitionId: `def-${over.id}`,
    kind: 'EXPENSE',
    date: '2026-10-22',
    accountId: 'banco',
    toAccountId: null,
    sourceLiquid: true,
    targetLiquid: null,
    managedBy: null,
    amount: null,
    overdueFromPrevious: false,
    ...over,
  };
  return base;
}

/** Datos base del change: 15800.00 BOB líquidos, 5000.00 reservados, 3179.00 comprometidos, 600.00 de aportes, 1500.00 de reserva. */
const baseCommitted = (): SpendableCommittedItem[] => [
  item({ id: 'internet', name: 'Internet', amount: bob('199.00'), date: '2026-10-22' }),
  item({ id: 'luz', name: 'Luz', amount: bob('180.00'), date: '2026-10-28' }),
  item({
    id: 'tarjeta',
    name: 'Pago Tarjeta X',
    kind: 'TRANSFER',
    toAccountId: 'tarjeta-x',
    targetLiquid: false,
    amount: bob('2500.00'),
    date: '2026-10-25',
  }),
  item({
    id: 'cena',
    name: 'Cena',
    source: 'PENDING',
    definitionId: null,
    amount: bob('300.00'),
    date: '2026-10-18',
  }),
];
const baseInput = (over: Partial<SpendableInput> = {}): SpendableInput => ({
  period: OCT,
  liquidAccounts: [
    account('banco', 'Banco BOB', bob('12000.00')),
    account('efectivo', 'Efectivo BOB', bob('800.00')),
    account('ahorro', 'Ahorro BOB', bob('3000.00')),
  ],
  reservations: [reservation('ahorro', bob('3000.00')), reservation('banco', bob('2000.00'))],
  committed: baseCommitted(),
  planned: [{ goalId: 'g1', goalName: 'Fondo de emergencia', pending: bob('600.00') }],
  minimumReserve: bob('1500.00'),
  ...over,
});
const only = (input: SpendableInput) => {
  const r = SpendableCalculator.calculate(input);
  expect(r.byCurrency).toHaveLength(1);
  return r.byCurrency[0]!;
};
const text = (m: Money | null) => (m ? `${m.toFixed()} ${m.currency.code}` : null);

describe('SpendableCalculator: términos del disponible', () => {
  it('[TC-REPORTING-SPENDABLE-001] resta reservas de metas, comprometido, aportes planificados y reserva mínima: 5521.00 BOB', () => {
    const t = only(baseInput());
    expect(text(t.liquid)).toBe('15800.00 BOB');
    expect(text(t.reservedForGoals)).toBe('5000.00 BOB');
    expect(text(t.committed)).toBe('3179.00 BOB');
    expect(text(t.plannedGoalContributions)).toBe('600.00 BOB');
    expect(text(t.minimumReserve)).toBe('1500.00 BOB');
    expect(text(t.spendable)).toBe('5521.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-001] el ingreso esperado "Sueldo" no suma (las ocurrencias de ingreso no restan ni suman)', () => {
    const withIncome = baseInput({
      committed: [
        ...baseCommitted(),
        item({ id: 'sueldo', name: 'Sueldo', kind: 'INCOME', amount: bob('8000.00'), date: '2026-10-30' }),
      ],
    });
    expect(text(only(withIncome).spendable)).toBe('5521.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-001] sin reserva mínima: 7021.00 BOB y sin el término de reserva mínima', () => {
    const t = only(baseInput({ minimumReserve: null }));
    expect(t.minimumReserve).toBeNull();
    expect(text(t.spendable)).toBe('7021.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-002] el comprometido solo suma lo pagado desde cuentas líquidas: 3179.00 BOB, sin Netflix, y cuenta 1 pago sin monto', () => {
    const r = SpendableCalculator.calculate(
      baseInput({
        committed: [
          ...baseCommitted(),
          item({
            id: 'netflix',
            name: 'Netflix',
            amount: bob('49.00'),
            accountId: 'tarjeta-x',
            sourceLiquid: false,
          }),
          item({ id: 'agua', name: 'Agua', amount: null }),
        ],
      }),
    );
    expect(text(r.byCurrency[0]!.committed)).toBe('3179.00 BOB');
    expect(r.committedItems.map((i) => i.name)).not.toContain('Netflix');
    expect(r.committedItems.map((i) => i.name)).toEqual(['Cena', 'Internet', 'Pago Tarjeta X', 'Luz']);
    expect(r.withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-SPENDABLE-002] una cuota de préstamo desde una cuenta líquida resta aunque no declare destino', () => {
    const t = only(
      baseInput({
        committed: [item({ id: 'cuota', name: 'Préstamo', kind: 'LOAN_PAYMENT', amount: bob('700.00') })],
      }),
    );
    expect(text(t.committed)).toBe('700.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-003] el aporte programado administrado por una meta no cuenta como comprometido sino como aporte planificado: 4621.00 BOB', () => {
    const t = only(
      baseInput({
        committed: [
          ...baseCommitted(),
          item({
            id: 'aporte',
            name: 'Aporte Fondo de emergencia',
            kind: 'TRANSFER',
            toAccountId: 'plazo',
            targetLiquid: false,
            managedBy: 'GOAL',
            amount: bob('1500.00'),
            date: '2026-10-28',
          }),
        ],
        planned: [{ goalId: 'g1', goalName: 'Fondo de emergencia', pending: bob('1500.00') }],
      }),
    );
    expect(text(t.committed)).toBe('3179.00 BOB');
    expect(text(t.plannedGoalContributions)).toBe('1500.00 BOB');
    expect(text(t.spendable)).toBe('4621.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-004] un vencido de un periodo anterior resta (3299.00 BOB comprometidos; 5401.00 BOB) y una transferencia entre líquidas no suma', () => {
    const t = only(
      baseInput({
        committed: [
          ...baseCommitted(),
          item({
            id: 'seguro',
            name: 'Seguro',
            amount: bob('120.00'),
            date: '2026-09-28',
            overdueFromPrevious: true,
          }),
          item({
            id: 'ahorro-mensual',
            name: 'Ahorro mensual',
            kind: 'TRANSFER',
            toAccountId: 'efectivo',
            targetLiquid: true,
            amount: bob('500.00'),
            date: '2026-10-25',
          }),
        ],
      }),
    );
    expect(text(t.committed)).toBe('3299.00 BOB');
    expect(text(t.spendable)).toBe('5401.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-004] una transacción pendiente con fecha anterior al periodo también resta (no está en el saldo)', () => {
    const t = only(
      baseInput({
        committed: [
          item({
            id: 'p',
            name: 'Pendiente viejo',
            source: 'PENDING',
            amount: bob('50.00'),
            date: '2026-09-10',
          }),
        ],
      }),
    );
    expect(text(t.committed)).toBe('50.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-005] una cuenta sobre-asignada descuenta como máximo su saldo (1500.00) y el disponible es 0.00 BOB', () => {
    const r = SpendableCalculator.calculate({
      period: OCT,
      liquidAccounts: [account('banco', 'Banco BOB', bob('1500.00'))],
      reservations: [reservation('banco', bob('2000.00')), reservation('inversion', bob('4000.00'))],
      committed: [],
      planned: [],
      minimumReserve: null,
    });
    expect(text(r.byCurrency[0]!.reservedForGoals)).toBe('1500.00 BOB');
    expect(text(r.byCurrency[0]!.spendable)).toBe('0.00 BOB');
    expect(r.reservedByAccount).toHaveLength(1);
    expect(text(r.reservedByAccount[0]!.reserved)).toBe('2000.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-005] una cuenta líquida con saldo negativo o cero aporta 0.00 al término reservado', () => {
    const t = only({
      period: OCT,
      liquidAccounts: [account('banco', 'Banco BOB', bob('-100.00')), account('caja', 'Caja', bob('0.00'))],
      reservations: [reservation('banco', bob('500.00')), reservation('caja', bob('300.00'))],
      committed: [],
      planned: [],
      minimumReserve: null,
    });
    expect(text(t.reservedForGoals)).toBe('0.00 BOB');
    expect(text(t.spendable)).toBe('-100.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-009] solo suman los aportes planificados pendientes positivos: 600.00 BOB', () => {
    const planned: SpendablePlanned[] = [
      { goalId: 'g1', goalName: 'Fondo de emergencia', pending: bob('600.00') },
      { goalId: 'g2', goalName: 'Auto', pending: bob('0.00') },
    ];
    expect(text(only(baseInput({ planned })).plannedGoalContributions)).toBe('600.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-011] con periodo del 25 al 24 solo restan los vencimientos hasta el 2026-10-24: 499.00 BOB y 8201.00 BOB', () => {
    const t = only(
      baseInput({
        period: { from: '2026-09-25', to: '2026-10-24' },
        committed: [
          item({ id: 'internet', name: 'Internet', amount: bob('199.00'), date: '2026-10-22' }),
          item({
            id: 'tarjeta',
            name: 'Pago Tarjeta X',
            kind: 'TRANSFER',
            toAccountId: 'tarjeta-x',
            targetLiquid: false,
            amount: bob('2500.00'),
            date: '2026-10-25',
          }),
          item({ id: 'luz', name: 'Luz', amount: bob('180.00'), date: '2026-10-28' }),
          item({ id: 'cena', name: 'Cena', source: 'PENDING', amount: bob('300.00'), date: '2026-10-18' }),
        ],
      }),
    );
    expect(text(t.committed)).toBe('499.00 BOB');
    expect(text(t.spendable)).toBe('8201.00 BOB');
  });
});

describe('SpendableCalculator: por moneda y consolidado', () => {
  const rate = (value: string): ExactRate => ({ base: 'USD', quote: 'BOB', value: dec(value) });
  const usdRates = (code: string) => (code === 'USD' ? rate('12.00') : null);
  const withUsd = () =>
    SpendableCalculator.calculate(
      baseInput({
        liquidAccounts: [...baseInput().liquidAccounts, account('caja-usd', 'Caja USD', usd('50.00'))],
        committed: [
          ...baseCommitted(),
          item({ id: 'spotify', name: 'Spotify', accountId: 'caja-usd', amount: usd('5.99') }),
        ],
      }),
    );

  it('[TC-REPORTING-SPENDABLE-006] BOB y USD por moneda (5521.00 BOB y 44.01 USD) y consolidado 6049.12 BOB con la tasa 12.00', () => {
    const r = withUsd();
    expect(r.byCurrency.map((t) => text(t.spendable))).toEqual(['5521.00 BOB', '44.01 USD']);
    const c = SpendableCalculator.consolidate(r.byCurrency, BOB, usdRates);
    expect(text(SpendableCalculator.present(c.total, BOB))).toBe('6049.12 BOB');
    expect(c.complete).toBe(true);
    expect(c.status).toBe('OK');
  });

  it('[TC-REPORTING-SPENDABLE-006] sin tasa vigente: consolidado 5521.00 BOB incompleto con 44.01 USD sin convertir (nunca 1:1)', () => {
    const c = SpendableCalculator.consolidate(withUsd().byCurrency, BOB, () => null);
    expect(text(SpendableCalculator.present(c.total, BOB))).toBe('5521.00 BOB');
    expect(c.complete).toBe(false);
    expect(c.unconverted.map(text)).toEqual(['44.01 USD']);
  });

  it('[TC-REPORTING-SPENDABLE-007] −200.00 BOB y 100.00 USD: consolidado 1000.00 BOB, faltante de 200.00 BOB y estado OK', () => {
    const r = SpendableCalculator.calculate({
      period: OCT,
      liquidAccounts: [
        account('banco', 'Banco BOB', bob('2000.00')),
        account('usd', 'Caja USD', usd('100.00')),
      ],
      reservations: [],
      committed: [item({ id: 'a', name: 'Alquiler', amount: bob('2200.00') })],
      planned: [],
      minimumReserve: null,
    });
    expect(r.byCurrency.map((t) => text(t.spendable))).toEqual(['-200.00 BOB', '100.00 USD']);
    const c = SpendableCalculator.consolidate(r.byCurrency, BOB, usdRates);
    expect(text(SpendableCalculator.present(c.total, BOB))).toBe('1000.00 BOB');
    expect(c.shortfalls.map(text)).toEqual(['200.00 BOB']);
    expect(c.status).toBe('OK');
  });

  it('[TC-REPORTING-SPENDABLE-008] −600.00 BOB (2000.00 líquidos y 2600.00 comprometidos) es WARNING y conserva el signo y el desglose', () => {
    const r = SpendableCalculator.calculate({
      period: OCT,
      liquidAccounts: [account('banco', 'Banco BOB', bob('2000.00'))],
      reservations: [],
      committed: [item({ id: 'a', name: 'Alquiler', amount: bob('2600.00') })],
      planned: [],
      minimumReserve: null,
    });
    const t = r.byCurrency[0]!;
    expect(text(t.liquid)).toBe('2000.00 BOB');
    expect(text(t.committed)).toBe('2600.00 BOB');
    expect(text(t.spendable)).toBe('-600.00 BOB');
    const c = SpendableCalculator.consolidate(r.byCurrency, BOB, () => null);
    expect(text(SpendableCalculator.present(c.total, BOB))).toBe('-600.00 BOB');
    expect(c.status).toBe('WARNING');
    expect(c.shortfalls).toEqual([]);
  });

  it('[TC-REPORTING-SPENDABLE-006] la reserva mínima en otra moneda se resta en su moneda y se consolida con la tasa', () => {
    const r = SpendableCalculator.calculate(baseInput({ minimumReserve: usd('100.00') }));
    expect(r.byCurrency.map((t) => text(t.spendable))).toEqual(['7021.00 BOB', '-100.00 USD']);
    const c = SpendableCalculator.consolidate(r.byCurrency, BOB, usdRates);
    expect(text(SpendableCalculator.present(c.total, BOB))).toBe('5821.00 BOB');
  });
});

describe('SpendableCalculator: propiedades', () => {
  const RUNS = Number(process.env['PF_PBT_RUNS'] ?? 100);
  const CCYS: readonly Currency[] = [BOB, USD];
  const units = fc.bigInt({ min: 0n, max: 10n ** 9n });

  const scenario = fc.record({
    accounts: fc.array(
      fc.record({ ccy: fc.nat({ max: 1 }), balance: fc.bigInt({ min: -(10n ** 8n), max: 10n ** 9n }) }),
      { minLength: 1, maxLength: 5 },
    ),
    reserved: fc.array(units, { maxLength: 5 }),
    committed: fc.array(
      fc.record({
        ccy: fc.nat({ max: 1 }),
        amount: fc.option(units, { nil: null }),
        sourceLiquid: fc.boolean(),
        managed: fc.boolean(),
        kind: fc.constantFrom('EXPENSE', 'TRANSFER', 'CARD_PAYMENT', 'LOAN_PAYMENT'),
        targetLiquid: fc.boolean(),
        late: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    planned: fc.array(fc.record({ ccy: fc.nat({ max: 1 }), pending: units }), { maxLength: 4 }),
    reserve: fc.option(fc.record({ ccy: fc.nat({ max: 1 }), amount: units }), { nil: null }),
  });

  const inputOf = (s: {
    accounts: { ccy: number; balance: bigint }[];
    reserved: bigint[];
    committed: {
      ccy: number;
      amount: bigint | null;
      sourceLiquid: boolean;
      managed: boolean;
      kind: string;
      targetLiquid: boolean;
      late: boolean;
    }[];
    planned: { ccy: number; pending: bigint }[];
    reserve: { ccy: number; amount: bigint } | null;
  }): SpendableInput => {
    const money = (n: bigint, i: number) => Money.ofMinorUnits(n, CCYS[i] as Currency);
    const liquidAccounts = s.accounts.map((a, i) => account(`a${i}`, `Cuenta ${i}`, money(a.balance, a.ccy)));
    return {
      period: OCT,
      liquidAccounts,
      reservations: s.reserved.map((r, i) => {
        const acc = liquidAccounts[i % liquidAccounts.length] as SpendableAccount;
        return reservation(acc.accountId, Money.ofMinorUnits(r, acc.balance.currency));
      }),
      committed: s.committed.map((c, i) =>
        item({
          id: `c${i}`,
          name: `Compromiso ${i}`,
          kind: c.kind,
          sourceLiquid: c.sourceLiquid,
          targetLiquid: c.targetLiquid,
          managedBy: c.managed ? 'GOAL' : null,
          amount: c.amount === null ? null : money(c.amount, c.ccy),
          date: c.late ? '2026-11-02' : '2026-10-20',
        }),
      ),
      planned: s.planned.map((p, i) => ({
        goalId: `g${i}`,
        goalName: `Meta ${i}`,
        pending: money(p.pending, p.ccy),
      })),
      minimumReserve: s.reserve ? money(s.reserve.amount, s.reserve.ccy) : null,
    };
  };

  it(
    '[TC-REPORTING-SPENDABLE-001] el disponible por moneda es exactamente el líquido menos la suma de los términos',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(scenario, (s) => {
          const r = SpendableCalculator.calculate(inputOf(s));
          for (const t of r.byCurrency) {
            let expected = t.liquid
              .subtract(t.reservedForGoals)
              .subtract(t.committed)
              .subtract(t.plannedGoalContributions);
            if (t.minimumReserve) expected = expected.subtract(t.minimumReserve);
            expect(t.spendable.equals(expected)).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  it(
    '[TC-REPORTING-SPENDABLE-005] lo reservado que resta nunca supera el saldo positivo de la cuenta ni lo reservado',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(scenario, (s) => {
          const r = SpendableCalculator.calculate(inputOf(s));
          for (const line of r.reservedByAccount) {
            expect(line.counted.compare(line.reserved) <= 0).toBe(true);
            expect(line.counted.isNegative()).toBe(false);
            if (line.balance.isPositive()) expect(line.counted.compare(line.balance) <= 0).toBe(true);
            else expect(line.counted.isZero()).toBe(true);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );

  it(
    '[TC-REPORTING-SPENDABLE-006] el consolidado de una moneda sin tasa nunca se convierte 1:1: excluye su monto y queda incompleto',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(scenario, (s) => {
          const r = SpendableCalculator.calculate(inputOf(s));
          const c = SpendableCalculator.consolidate(r.byCurrency, BOB, () => null);
          const bobOnly = r.byCurrency.find((t) => t.currency.code === 'BOB');
          expect(c.total.eq(bobOnly ? bobOnly.spendable.toDecimal() : dec('0'))).toBe(true);
          const usdTerms = r.byCurrency.find((t) => t.currency.code === 'USD');
          expect(c.complete).toBe(!usdTerms || usdTerms.spendable.isZero());
        }),
        { numRuns: RUNS },
      );
    },
  );

  it(
    '[TC-REPORTING-SPENDABLE-002] ningún ítem de cuentas no líquidas, de metas o posterior al periodo entra al comprometido',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(scenario, (s) => {
          const r = SpendableCalculator.calculate(inputOf(s));
          for (const i of r.committedItems) {
            expect(i.sourceLiquid).toBe(true);
            expect(i.managedBy).not.toBe('GOAL');
            expect(i.date <= OCT.to).toBe(true);
            expect(i.amount).not.toBeNull();
            if (i.kind === 'TRANSFER' || i.kind === 'CARD_PAYMENT') expect(i.targetLiquid).toBe(false);
          }
        }),
        { numRuns: RUNS },
      );
    },
  );
});
