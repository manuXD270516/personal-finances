import { currency, dec, type ExactRate, type PeriodLabel } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { KnownFutureCalculator, type InstallmentInput, type OccurrenceInput } from './known-future.js';

const BOB = currency('BOB', 2);
const DEC = '2026-12' as PeriodLabel;

const occ = (over: Partial<OccurrenceInput> & Pick<OccurrenceInput, 'label'>): OccurrenceInput => ({
  date: '2026-12-05',
  definitionId: `def-${over.label}`,
  occurrenceId: `occ-${over.label}`,
  projected: false,
  kind: 'EXPENSE',
  amountType: 'FIXED',
  amount: { amount: '100.00', currency: 'BOB' },
  minAmount: null,
  maxAmount: null,
  categoryId: null,
  managedBy: 'USER',
  ...over,
});

const compute = (
  occurrences: readonly OccurrenceInput[],
  installments: readonly InstallmentInput[] = [],
  rateFor: (code: string) => ExactRate | null = () => null,
) =>
  KnownFutureCalculator.compute({
    occurrences,
    installments,
    target: BOB,
    startDay: 1,
    firstPeriod: '2026-11' as PeriodLabel,
    lastPeriod: '2027-10' as PeriodLabel,
    rateFor,
  });

const fx = (d: { toFixed(places: number): string }): string => d.toFixed(2);

describe('KnownFutureCalculator', () => {
  it('[TC-FORECAST-EXPENSE-001] los conocidos de diciembre suman 2748.00 y quedan listados por fecha', () => {
    const items = compute([
      occ({ label: 'Alquiler', date: '2026-12-01', amount: { amount: '2500.00', currency: 'BOB' } }),
      occ({ label: 'Internet', date: '2026-12-10', amount: { amount: '199.00', currency: 'BOB' } }),
      occ({
        label: 'Netflix',
        date: '2026-12-15',
        managedBy: 'SUBSCRIPTION',
        amount: { amount: '49.00', currency: 'BOB' },
      }),
    ]);
    const totals = KnownFutureCalculator.totals(items, DEC, () => true);
    expect(fx(totals.amount)).toBe('2748.00');
    expect(totals.itemCount).toBe(3);
    expect(items.map((i) => i.label)).toEqual(['Alquiler', 'Internet', 'Netflix']);
  });

  it('[TC-FORECAST-EXPENSE-005] 9.99 USD con la tasa de hoy 6.96 se convierte a 69.53 BOB y conserva el original', () => {
    const rate: ExactRate = { base: 'USD', quote: 'BOB', value: dec('6.96') };
    const items = compute(
      [occ({ label: 'Spotify', amount: { amount: '9.99', currency: 'USD' } })],
      [],
      (code) => (code === 'USD' ? rate : null),
    );
    expect(items[0]).toMatchObject({
      amount: '69.53',
      originalAmount: { amount: '9.99', currency: 'USD' },
      withoutAmount: false,
    });
  });

  it('[TC-FORECAST-EXPENSE-005] sin tasa el ítem se lista sin convertir y no se suma (nunca 1:1)', () => {
    const items = compute([occ({ label: 'Spotify', amount: { amount: '9.99', currency: 'USD' } })]);
    expect(items[0]).toMatchObject({ amount: null, originalAmount: { amount: '9.99', currency: 'USD' } });
    expect(fx(KnownFutureCalculator.totals(items, DEC, () => true).amount)).toBe('0.00');
  });

  it('[TC-FORECAST-EXPENSE-006] una factura VARIABLE se lista sin monto y se cuenta', () => {
    const items = compute([occ({ label: 'Luz', amountType: 'VARIABLE', amount: null })]);
    expect(items[0]).toMatchObject({ amount: null, originalAmount: null, withoutAmount: true });
    const totals = KnownFutureCalculator.totals(items, DEC, () => true);
    expect(totals.withoutAmountCount).toBe(1);
    expect(fx(totals.amount)).toBe('0.00');
  });

  it('[TC-FORECAST-EXPENSE-007] la cuota de 2026-12 aporta interés y seguro (435.35) sin el capital', () => {
    const items = compute(
      [],
      [
        {
          loanId: 'loan-1',
          label: 'Auto — cuota 5',
          dueDate: '2026-12-15',
          currency: 'BOB',
          principal: '1064.65',
          interest: '420.35',
          charges: '0.00',
          insurance: '15.00',
          taxes: '0.00',
        },
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'LOAN_INTEREST',
      amount: '435.35',
      source: { context: 'DEBT', id: 'loan-1' },
      categoryId: null,
    });
  });

  it('[TC-FORECAST-EXPENSE-004] MIN_MAX cuenta el máximo en gastos y el mínimo en ingresos', () => {
    const items = compute([
      occ({
        label: 'Gas',
        amountType: 'MIN_MAX',
        amount: null,
        minAmount: { amount: '80.00', currency: 'BOB' },
        maxAmount: { amount: '120.00', currency: 'BOB' },
      }),
      occ({
        label: 'Extras',
        kind: 'INCOME',
        amountType: 'MIN_MAX',
        amount: null,
        minAmount: { amount: '300.00', currency: 'BOB' },
        maxAmount: { amount: '900.00', currency: 'BOB' },
      }),
    ]);
    expect(items.find((i) => i.label === 'Gas')?.amount).toBe('120.00');
    expect(items.find((i) => i.label === 'Extras')?.amount).toBe('300.00');
  });

  it('[TC-FORECAST-EXPENSE-004] no cuentan pagos de tarjeta, transferencias, metas ni capital; fuera del horizonte tampoco', () => {
    const items = compute([
      occ({ label: 'Pago tarjeta', kind: 'CARD_PAYMENT' }),
      occ({ label: 'Ahorro', kind: 'TRANSFER' }),
      occ({ label: 'Meta viaje', kind: 'EXPENSE', managedBy: 'GOAL' }),
      occ({ label: 'Cuota', kind: 'LOAN_PAYMENT', managedBy: 'DEBT' }),
      occ({ label: 'Antiguo', date: '2026-10-05' }),
      occ({ label: 'Lejano', date: '2027-12-05' }),
      occ({ label: 'Seguro anual', date: '2027-03-15', amount: { amount: '900.00', currency: 'BOB' } }),
    ]);
    expect(items.map((i) => i.label)).toEqual(['Seguro anual']);
    expect(items[0]?.period).toBe('2027-03');
  });
});
