import type { PeriodLabel } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  VariableLiquidOutflowBuilder,
  type LiquidAccountInput,
  type LiquidFlowInput,
  type LiquidResolvedInput,
} from './variable-liquid-outflow.js';

const ACCOUNTS: LiquidAccountInput[] = [
  { accountId: 'efectivo', currency: 'BOB', scale: 2 },
  { accountId: 'banco-bob', currency: 'BOB', scale: 2 },
  { accountId: 'banco-usd', currency: 'USD', scale: 2 },
];

const flow = (
  accountId: string,
  amount: string,
  currency = 'BOB',
  over: Partial<LiquidFlowInput> = {},
): LiquidFlowInput => ({
  businessDate: '2026-10-10',
  accountId,
  amount: { amount, currency },
  loanComponent: false,
  ...over,
});

const resolved = (
  accountId: string | null,
  amount: string,
  over: Partial<LiquidResolvedInput> = {},
): LiquidResolvedInput => ({
  kind: 'EXPENSE',
  managedBy: 'USER',
  transactionDate: '2026-10-05',
  accountId,
  amount: { amount, currency: 'BOB' },
  ...over,
});

const build = (flows: LiquidFlowInput[], res: LiquidResolvedInput[] = []) =>
  VariableLiquidOutflowBuilder.build({ accounts: ACCOUNTS, flows, resolved: res, startDay: 1 });

const valueOf = (out: ReturnType<typeof build>, currencyCode: string, period: string): string | undefined =>
  out.byCurrency
    .get(currencyCode)
    ?.periods.get(period as PeriodLabel)
    ?.value.toFixed(2);

describe('VariableLiquidOutflowBuilder', () => {
  it('[TC-FORECAST-CASHFLOW-001] 3900.00 de gasto desde cuentas líquidas menos 2748.00 de recurrentes resueltos dejan 1152.00', () => {
    const out = build(
      [flow('efectivo', '1400.00'), flow('banco-bob', '2500.00')],
      [resolved('banco-bob', '2500.00'), resolved('efectivo', '199.00'), resolved('efectivo', '49.00')],
    );
    expect(valueOf(out, 'BOB', '2026-10')).toBe('1152.00');
  });

  it('[TC-FORECAST-CASHFLOW-002] las compras cargadas a la tarjeta (cuenta no líquida) no entran', () => {
    const out = build(
      [flow('efectivo', '1400.00'), flow('banco-bob', '2500.00'), flow('visa-oro', '600.00')],
      [resolved('banco-bob', '2500.00'), resolved('efectivo', '248.00')],
    );
    expect(valueOf(out, 'BOB', '2026-10')).toBe('1152.00');
  });

  it('[TC-FORECAST-CASHFLOW-003] el gasto en dólares queda en dólares, sin convertir', () => {
    const out = build([flow('banco-usd', '120.00', 'USD'), flow('efectivo', '300.00')]);
    expect(valueOf(out, 'USD', '2026-10')).toBe('120.00');
    expect(valueOf(out, 'BOB', '2026-10')).toBe('300.00');
    expect(out.byCurrency.get('USD')?.scale).toBe(2);
  });

  it('[TC-FORECAST-CASHFLOW-001] una ocurrencia pagada desde una cuenta no líquida o sin cuenta no resta', () => {
    const out = build(
      [flow('efectivo', '1000.00')],
      [resolved('visa-oro', '400.00'), resolved(null, '100.00'), resolved('efectivo', '250.00')],
    );
    expect(valueOf(out, 'BOB', '2026-10')).toBe('750.00');
  });

  it('[TC-FORECAST-CASHFLOW-001] los componentes de préstamo pagados desde cuentas líquidas se restan una vez', () => {
    const out = build([
      flow('efectivo', '1000.00'),
      flow('banco-bob', '180.00', 'BOB', { loanComponent: true }),
    ]);
    expect(valueOf(out, 'BOB', '2026-10')).toBe('1000.00');
  });

  it('[TC-FORECAST-CASHFLOW-001] los pagos de meta y de tarjeta no son gasto y no se restan; los ingresos tampoco', () => {
    const out = build(
      [flow('efectivo', '900.00')],
      [
        resolved('efectivo', '100.00', { managedBy: 'GOAL' }),
        resolved('efectivo', '100.00', { kind: 'CARD_PAYMENT' }),
        resolved('efectivo', '100.00', { kind: 'INCOME' }),
      ],
    );
    expect(valueOf(out, 'BOB', '2026-10')).toBe('900.00');
  });

  it('[TC-FORECAST-CASHFLOW-001] un resultado negativo se lleva a cero y se cuenta', () => {
    const out = build([flow('efectivo', '100.00')], [resolved('efectivo', '250.00')]);
    expect(valueOf(out, 'BOB', '2026-10')).toBe('0.00');
    expect(out.clampedCount).toBe(1);
  });

  it('[TC-FORECAST-CASHFLOW-001] agrupa por periodo financiero con el día de inicio del workspace', () => {
    const out = VariableLiquidOutflowBuilder.build({
      accounts: ACCOUNTS,
      flows: [flow('efectivo', '10.00', 'BOB', { businessDate: '2026-10-04' }), flow('efectivo', '20.00')],
      resolved: [],
      startDay: 5,
    });
    expect(valueOf(out, 'BOB', '2026-09')).toBe('10.00');
    expect(valueOf(out, 'BOB', '2026-10')).toBe('20.00');
  });

  it('[TC-FORECAST-CASHFLOW-001] sin cuentas líquidas no hay series', () => {
    const out = VariableLiquidOutflowBuilder.build({
      accounts: [],
      flows: [flow('efectivo', '10.00')],
      resolved: [],
      startDay: 1,
    });
    expect(out.byCurrency.size).toBe(0);
  });
});
