import { currency as makeCurrency, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  CashFlowCalendar,
  type CashFlowAccountInput,
  type CashFlowEventKind,
  type CashFlowMovementInput,
  type CashFlowResult,
} from './cash-flow-calendar.js';

const BOB = makeCurrency('BOB', 2);
const USD = makeCurrency('USD', 2);
const bob = (a: string) => Money.parse(a, BOB);
const usd = (a: string) => Money.parse(a, USD);
const text = (m: Money) => m.toFixed();

const TODAY = '2026-10-20';

const BANCO: CashFlowAccountInput = { accountId: 'banco', name: 'Banco BOB', balance: bob('4000.00') };
const EFECTIVO: CashFlowAccountInput = {
  accountId: 'efectivo',
  name: 'Efectivo BOB',
  balance: bob('500.00'),
};

let seq = 0;
function mov(
  name: string,
  date: string,
  amount: Money | null,
  over: Partial<CashFlowMovementInput> & { kind?: CashFlowEventKind } = {},
): CashFlowMovementInput {
  seq += 1;
  return {
    id: `m${String(seq).padStart(3, '0')}-${name}`,
    source: 'OCCURRENCE',
    kind: 'EXPENSE',
    date,
    accountId: 'banco',
    toAccountId: null,
    amountType: 'FIXED',
    name,
    managedBy: 'USER',
    categoryId: null,
    amount,
    toAmount: null,
    ...over,
  };
}

/** Datos base de la spec "Saldo esperado de octubre y noviembre". */
function base(): CashFlowMovementInput[] {
  return [
    mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
    mov('Internet', '2026-10-22', bob('199.00')),
    mov('Luz', '2026-10-28', bob('180.00'), { amountType: 'ESTIMATED' }),
    mov('Sueldo', '2026-10-31', bob('8000.00'), { kind: 'INCOME' }),
    mov('Alquiler', '2026-11-01', bob('2500.00')),
    mov('Pago de tarjeta · Visa Oro', '2026-11-15', bob('1120.50'), {
      kind: 'CARD_PAYMENT',
      toAccountId: 'visa',
    }),
  ];
}

const compute = (
  movements: readonly CashFlowMovementInput[],
  accounts: readonly CashFlowAccountInput[] = [BANCO, EFECTIVO],
  horizonDays = 30,
): CashFlowResult => CashFlowCalendar.compute({ today: TODAY, horizonDays, accounts, movements });

const bobBlock = (r: CashFlowResult) => r.currencies.find((c) => c.currency.code === 'BOB')!;
const balanceOn = (r: CashFlowResult, date: string, code = 'BOB') =>
  text(r.currencies.find((c) => c.currency.code === code)!.series.find((p) => p.date === date)!.balance);

describe('CashFlowCalendar: saldo esperado diario (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-FORECAST-003] el saldo parte del contable y aplica pendientes y ocurrencias en su fecha', () => {
    const r = compute([...base(), mov('Seguro anual', '2026-12-15', bob('900.00'))]);
    const b = bobBlock(r);
    expect(text(b.startBalance)).toBe('4500.00');
    expect(r.from).toBe('2026-10-20');
    expect(r.to).toBe('2026-11-19');
    expect(b.series).toHaveLength(31);
    expect(balanceOn(r, '2026-10-20')).toBe('4200.00');
    expect(balanceOn(r, '2026-10-22')).toBe('4001.00');
    expect(balanceOn(r, '2026-10-28')).toBe('3821.00');
    expect(balanceOn(r, '2026-10-31')).toBe('11821.00');
    expect(balanceOn(r, '2026-11-01')).toBe('9321.00');
    for (const d of ['2026-11-15', '2026-11-16', '2026-11-19']) expect(balanceOn(r, d)).toBe('8200.50');
    expect(text(b.endBalance)).toBe('8200.50');
    expect(r.events.map((e) => e.name)).not.toContain('Seguro anual');
    expect(text(b.outflowTotal)).toBe('4299.50');
  });

  it('[TC-REPORTING-FORECAST-004] una ocurrencia vencida se aplica hoy marcada con sus días de atraso', () => {
    const r = compute([...base(), mov('Netflix', '2026-10-15', bob('49.00'))]);
    expect(balanceOn(r, '2026-10-20')).toBe('4151.00');
    const netflix = r.events.find((e) => e.name === 'Netflix')!;
    expect(netflix).toMatchObject({
      date: '2026-10-20',
      originalDate: '2026-10-15',
      overdue: true,
      daysOverdue: 5,
    });
    expect(r.events.find((e) => e.name === 'Internet')).toMatchObject({ overdue: false, daysOverdue: null });
  });

  it('[TC-REPORTING-FORECAST-005] una transferencia entre cuentas líquidas no cambia el saldo ni el mínimo de la moneda y la compra con tarjeta no resta', () => {
    const plain = compute(base());
    const r = compute([
      ...base(),
      mov('Ahorro mensual', '2026-10-25', bob('500.00'), {
        kind: 'TRANSFER',
        toAccountId: 'efectivo',
      }),
      mov('Streaming', '2026-10-26', bob('69.00'), { accountId: 'visa' }),
    ]);
    expect(bobBlock(r).series.map((p) => text(p.balance))).toEqual(
      bobBlock(plain).series.map((p) => text(p.balance)),
    );
    expect(text(bobBlock(r).endBalance)).toBe('8200.50');
    expect(text(bobBlock(r).lowest.amount)).toBe(text(bobBlock(plain).lowest.amount));
    expect(text(bobBlock(r).outflowTotal)).toBe('4299.50');
    expect(r.events.map((e) => e.name)).not.toContain('Streaming');
    // La serie de cada cuenta sí refleja la transferencia, con el mismo orden dentro del día.
    const banco = r.accounts.find((a) => a.accountId === 'banco')!;
    const efectivo = r.accounts.find((a) => a.accountId === 'efectivo')!;
    expect(text(banco.endBalance)).toBe('7200.50');
    expect(text(banco.lowest.amount)).toBe('2821.00');
    expect(banco.lowest.date).toBe('2026-10-28');
    expect(text(efectivo.series.find((p) => p.date === '2026-10-25')!.balance)).toBe('1000.00');
    const sum = (date: string) =>
      banco.series
        .find((p) => p.date === date)!
        .balance.add(efectivo.series.find((p) => p.date === date)!.balance);
    for (const p of bobBlock(r).series) expect(text(sum(p.date))).toBe(text(p.balance));
  });

  it('[TC-REPORTING-FORECAST-006] el aporte a una cuenta no líquida y la cuota del préstamo restan con su origen y certeza', () => {
    const r = compute([
      ...base(),
      mov('Aporte Fondo de emergencia', '2026-10-28', bob('1500.00'), {
        kind: 'TRANSFER',
        toAccountId: 'plazo',
        managedBy: 'GOAL',
      }),
      mov('Préstamo vehicular — cuota 7', '2026-11-05', bob('1080.00'), {
        kind: 'LOAN_PAYMENT',
        toAccountId: 'prestamo',
        managedBy: 'DEBT',
      }),
    ]);
    expect(balanceOn(r, '2026-10-28')).toBe('2321.00');
    expect(text(bobBlock(r).endBalance)).toBe('5620.50');
    expect(r.events.find((e) => e.name === 'Aporte Fondo de emergencia')).toMatchObject({
      managedBy: 'GOAL',
      certainty: 'KNOWN',
    });
    expect(r.events.find((e) => e.name?.startsWith('Préstamo'))).toMatchObject({
      managedBy: 'DEBT',
      certainty: 'KNOWN',
    });
  });

  it('[TC-REPORTING-FORECAST-007] la certeza distingue conocido, estimado y esperado y los variables no suman', () => {
    const r = compute([
      mov('Gimnasio', '2026-10-25', bob('200.00'), { amountType: 'MIN_MAX' }),
      mov('Freelance', '2026-10-26', bob('1000.00'), { kind: 'INCOME', amountType: 'MIN_MAX' }),
      mov('Agua', '2026-10-27', null, { amountType: 'VARIABLE' }),
      mov('Luz', '2026-10-28', bob('180.00'), { amountType: 'ESTIMATED' }),
      mov('Internet', '2026-10-22', bob('199.00')),
    ]);
    expect(balanceOn(r, '2026-10-25')).toBe('4101.00');
    // 4500 − 199 (Internet) − 200 (Gimnasio, máximo) + 1000 (Freelance, mínimo) − 180 (Luz) = 4921.
    expect(text(bobBlock(r).endBalance)).toBe('4921.00');
    expect(bobBlock(r).withoutAmountCount).toBe(1);
    const byName = Object.fromEntries(r.events.map((e) => [e.name, e]));
    expect(byName['Internet']!.certainty).toBe('KNOWN');
    expect(byName['Luz']!.certainty).toBe('ESTIMATED');
    expect(byName['Gimnasio']!.certainty).toBe('ESTIMATED');
    expect(byName['Freelance']!.certainty).toBe('EXPECTED');
    expect(byName['Agua']!.amount).toBeNull();
  });

  it('[TC-REPORTING-FORECAST-008] el mismo día los egresos van antes que los ingresos y el mínimo toma la primera fecha', () => {
    const accounts = [{ accountId: 'banco', name: 'Banco BOB', balance: bob('2000.00') }, EFECTIVO];
    const movements = [
      mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
      mov('Internet', '2026-10-22', bob('199.00')),
      mov('Luz', '2026-10-28', bob('180.00')),
      mov('Alquiler', '2026-11-01', bob('2500.00')),
      mov('Sueldo', '2026-11-01', bob('8000.00'), { kind: 'INCOME' }),
      mov('Pago de tarjeta · Visa Oro', '2026-11-15', bob('1120.50'), {
        kind: 'CARD_PAYMENT',
        toAccountId: 'visa',
      }),
    ];
    const r = compute(movements, accounts);
    const b = bobBlock(r);
    expect(text(b.lowest.amount)).toBe('-679.00');
    expect(b.lowest.date).toBe('2026-11-01');
    expect(balanceOn(r, '2026-11-01')).toBe('7321.00');
    expect(text(b.endBalance)).toBe('6200.50');
    // El orden de los eventos del día también es egresos primero.
    const day = r.events.filter((e) => e.date === '2026-11-01').map((e) => e.name);
    expect(day).toEqual(['Alquiler', 'Sueldo']);
  });

  it('[TC-REPORTING-FORECAST-008] el mínimo alcanzado varios días se informa con su primera fecha', () => {
    const r = compute(base());
    expect(text(bobBlock(r).lowest.amount)).toBe('3821.00');
    expect(bobBlock(r).lowest.date).toBe('2026-10-28');
  });

  it('[TC-REPORTING-FORECAST-012] el peor caso sin ingresos esperados se informa aparte', () => {
    const r = compute(base());
    const w = bobBlock(r).withoutExpectedIncome;
    expect(text(w.lowest.amount)).toBe('200.50');
    expect(w.lowest.date).toBe('2026-11-15');
    expect(text(w.endBalance)).toBe('200.50');
    expect(text(bobBlock(r).endBalance)).toBe('8200.50');
  });

  it('[TC-REPORTING-FORECAST-010] otra moneda líquida tiene su propia serie y su propio mínimo', () => {
    const r = compute(
      [...base(), mov('Spotify', '2026-10-25', usd('5.99'), { accountId: 'caja-usd' })],
      [BANCO, EFECTIVO, { accountId: 'caja-usd', name: 'Caja USD', balance: usd('100.00') }],
    );
    const u = r.currencies.find((c) => c.currency.code === 'USD')!;
    expect(text(u.lowest.amount)).toBe('94.01');
    expect(u.lowest.date).toBe('2026-10-25');
    expect(r.currencies.map((c) => c.currency.code)).toEqual(['BOB', 'USD']);
  });

  it('[TC-REPORTING-FORECAST-005] una conversión entre líquidas de otra moneda resta en el origen y suma en el destino', () => {
    const r = compute(
      [
        mov('Compra de dólares', '2026-10-24', bob('696.00'), {
          kind: 'CONVERSION',
          toAccountId: 'caja-usd',
          toAmount: usd('100.00'),
        }),
      ],
      [BANCO, { accountId: 'caja-usd', name: 'Caja USD', balance: usd('0.00') }],
    );
    expect(text(bobBlock(r).endBalance)).toBe('3304.00');
    expect(r.currencies.find((c) => c.currency.code === 'USD')!.endBalance.toFixed()).toBe('100.00');
  });

  it('[TC-REPORTING-FORECAST-011] la serie del plan resta el gasto planificado por día sin cambiar la serie principal', () => {
    const planned = new Map([
      ['BOB', new Map(Array.from({ length: 12 }, (_, i) => [`2026-10-${20 + i}`, makeDec('50')] as const))],
    ]);
    const r = CashFlowCalendar.compute({
      today: TODAY,
      horizonDays: 30,
      accounts: [BANCO, EFECTIVO],
      movements: base(),
      plannedByDay: planned,
    });
    const b = bobBlock(r);
    expect(text(b.planned!.lowest.amount)).toBe('3221.00');
    expect(b.planned!.lowest.date).toBe('2026-10-31');
    expect(text(b.lowest.amount)).toBe('3821.00');
    expect(text(b.endBalance)).toBe('8200.50');
  });
});

function makeDec(v: string) {
  return Money.parse(v, BOB).toDecimal();
}
