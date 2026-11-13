import { PARALLEL_RATE } from '../dashboard/fixtures';
import type {
  CashFlowCalendar,
  CashFlowCurrency,
  CashFlowDay,
  CashFlowEvent,
  CashFlowHomeBlock,
  Money,
  PredictedCashFlow,
  ResolvedRate,
} from './types';

/**
 * Calendario de octubre de 2026 con las cifras de los TC de reporting/cash-flow-calendar (calculadas a mano en
 * design.md/tasks.md 1.3): Banco BOB 4000.00 y Efectivo BOB 500.00; "Cena" 300.00 atrasada (se aplica hoy: 4200.00),
 * "Internet" 199.00 (4001.00), "Luz" 180.00 (3821.00), "Sueldo" +8000.00 (11821.00), "Alquiler" 2500.00 (9321.00) y
 * "Pago de tarjeta" 1120.50 (8200.50); "Caja USD" 100.00 con "Spotify" 5.99 USD (94.01) y la tasa USD/BOB 12.00.
 */
export const TODAY = '2026-10-20';
export const bob = (amount: string): Money => ({ amount, currency: 'BOB' });
export const usd = (amount: string): Money => ({ amount, currency: 'USD' });

const dayAfter = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Serie diaria con puntos de cambio `[saldo más bajo, saldo al cierre]`; el resto de los días arrastra el saldo. */
export function dailySeries(
  start: string,
  days: number,
  currency: string,
  initial: string,
  changes: Readonly<Record<string, readonly [low: string, balance: string]>>,
): CashFlowDay[] {
  let balance = initial;
  return Array.from({ length: days + 1 }, (_, i) => {
    const date = dayAfter(start, i);
    const change = changes[date];
    const low = change ? change[0] : balance;
    balance = change ? change[1] : balance;
    return { date, balance: { amount: balance, currency }, low: { amount: low, currency } };
  });
}

export const BOB_SERIES = dailySeries(TODAY, 30, 'BOB', '4500.00', {
  '2026-10-20': ['4200.00', '4200.00'],
  '2026-10-22': ['4001.00', '4001.00'],
  '2026-10-28': ['3821.00', '3821.00'],
  '2026-10-31': ['3821.00', '11821.00'],
  '2026-11-01': ['9321.00', '9321.00'],
  '2026-11-15': ['8200.50', '8200.50'],
});

export const USD_SERIES = dailySeries(TODAY, 30, 'USD', '100.00', {
  '2026-10-25': ['94.01', '94.01'],
});

export const BOB_CURRENCY: CashFlowCurrency = {
  currency: 'BOB',
  threshold: { amount: bob('1500.00'), source: 'MINIMUM_RESERVE' },
  startBalance: bob('4500.00'),
  endBalance: bob('8200.50'),
  lowest: { amount: bob('3821.00'), date: '2026-10-28' },
  risk: 'NONE',
  firstShortfallDate: null,
  shortfallAmount: null,
  belowZero: false,
  outflowTotal: bob('4299.50'),
  inflowTotal: bob('8000.00'),
  withoutAmountCount: 0,
  series: BOB_SERIES,
  planned: {
    lowest: { amount: bob('3221.00'), date: '2026-10-28' },
    endBalance: bob('7600.50'),
    series: BOB_SERIES.map((d) => ({ date: d.date, balance: d.balance })),
  },
  withoutExpectedIncome: {
    lowest: { amount: bob('3821.00'), date: '2026-10-28' },
    endBalance: bob('200.50'),
  },
};

export const USD_CURRENCY: CashFlowCurrency = {
  currency: 'USD',
  threshold: { amount: usd('0.00'), source: 'ZERO' },
  startBalance: usd('100.00'),
  endBalance: usd('94.01'),
  lowest: { amount: usd('94.01'), date: '2026-10-25' },
  risk: 'NONE',
  firstShortfallDate: null,
  shortfallAmount: null,
  belowZero: false,
  outflowTotal: usd('5.99'),
  inflowTotal: usd('0.00'),
  withoutAmountCount: 0,
  series: USD_SERIES,
  planned: null,
  withoutExpectedIncome: {
    lowest: { amount: usd('94.01'), date: '2026-10-25' },
    endBalance: usd('94.01'),
  },
};

export const BANCO_ID = '0190a000-0000-7000-8000-00000000a001';
export const EFECTIVO_ID = '0190a000-0000-7000-8000-00000000a002';
export const CAJA_USD_ID = '0190a000-0000-7000-8000-00000000a003';

const event = (id: string, over: Partial<CashFlowEvent>): CashFlowEvent => ({
  id,
  date: TODAY,
  originalDate: TODAY,
  source: 'OCCURRENCE',
  kind: 'EXPENSE',
  certainty: 'KNOWN',
  amountType: 'FIXED',
  name: null,
  accountId: BANCO_ID,
  toAccountId: null,
  amount: null,
  toAmount: null,
  overdue: false,
  daysOverdue: null,
  managedBy: 'USER',
  sourceRef: { context: 'COMMITMENTS', id },
  ...over,
});

export const EVENTS: readonly CashFlowEvent[] = [
  event('cena', {
    source: 'PENDING',
    name: 'Cena',
    date: '2026-10-20',
    originalDate: '2026-10-18',
    overdue: true,
    daysOverdue: 2,
    amount: bob('300.00'),
    amountType: null,
    managedBy: null,
    sourceRef: { context: 'TRANSACTIONS', id: 'cena' },
  }),
  event('internet', {
    name: 'Internet',
    date: '2026-10-22',
    originalDate: '2026-10-22',
    amount: bob('199.00'),
  }),
  event('spotify', {
    name: 'Spotify',
    date: '2026-10-25',
    originalDate: '2026-10-25',
    accountId: CAJA_USD_ID,
    amount: usd('5.99'),
  }),
  event('luz', {
    name: 'Luz',
    date: '2026-10-28',
    originalDate: '2026-10-28',
    certainty: 'ESTIMATED',
    amountType: 'ESTIMATED',
    amount: bob('180.00'),
  }),
  event('agua', {
    name: 'Agua',
    date: '2026-10-28',
    originalDate: '2026-10-28',
    certainty: 'ESTIMATED',
    amountType: 'VARIABLE',
    amount: null,
  }),
  event('sueldo', {
    name: 'Sueldo',
    kind: 'INCOME',
    date: '2026-10-31',
    originalDate: '2026-10-31',
    certainty: 'EXPECTED',
    amount: bob('8000.00'),
  }),
  event('alquiler', {
    name: 'Alquiler',
    date: '2026-11-01',
    originalDate: '2026-11-01',
    amount: bob('2500.00'),
  }),
  event('tarjeta', {
    name: 'Pago de tarjeta · Visa Oro',
    kind: 'CARD_PAYMENT',
    date: '2026-11-15',
    originalDate: '2026-11-15',
    amount: bob('1120.50'),
  }),
];

const PARALLEL_USD: ResolvedRate = {
  ...PARALLEL_RATE,
  rate: { base: 'USD', quote: 'BOB', value: '12.00' },
};

export const CALENDAR: CashFlowCalendar = {
  horizonDays: 30,
  today: TODAY,
  from: TODAY,
  to: '2026-11-19',
  reportingCurrency: 'BOB',
  coverage: { through: '2027-01-31', complete: true },
  currencies: [BOB_CURRENCY, USD_CURRENCY],
  accounts: [
    {
      accountId: BANCO_ID,
      name: 'Banco BOB',
      currency: 'BOB',
      startBalance: bob('4000.00'),
      endBalance: bob('7200.50'),
      lowest: { amount: bob('2821.00'), date: '2026-10-28' },
      series: null,
    },
    {
      accountId: EFECTIVO_ID,
      name: 'Efectivo BOB',
      currency: 'BOB',
      startBalance: bob('500.00'),
      endBalance: bob('1000.00'),
      lowest: { amount: bob('500.00'), date: '2026-10-20' },
      series: null,
    },
    {
      accountId: CAJA_USD_ID,
      name: 'Caja USD',
      currency: 'USD',
      startBalance: usd('100.00'),
      endBalance: usd('94.01'),
      lowest: { amount: usd('94.01'), date: '2026-10-25' },
      series: null,
    },
  ],
  events: EVENTS,
  plannedSpending: {
    periods: [
      { periodId: '0190a000-0000-7000-8000-00000000b001', label: '2026-10', status: 'PLAN' },
      { periodId: null, label: '2026-11', status: 'NO_PLAN' },
    ],
  },
  suggestions: [],
  consolidated: { lowest: { amount: bob('4949.12'), date: '2026-10-28' }, complete: true, unconverted: [] },
  meta: {
    generatedAt: '2026-10-20T14:00:00Z',
    dataFreshness: '2026-10-20T13:59:00Z',
    rateWindowDays: 7,
    ratesUsed: [PARALLEL_USD],
    attributions: PARALLEL_USD.attribution ? [PARALLEL_USD.attribution] : [],
  },
};

/** Riesgo alto en BOB (TC-REPORTING-FORECAST-017): 1821.00 − 2500.00 = −679.00 el 2026-11-01; faltante 1500 + 679 = 2179. */
export const HIGH_RISK_BOB: CashFlowCurrency = {
  ...BOB_CURRENCY,
  risk: 'HIGH',
  lowest: { amount: bob('-679.00'), date: '2026-11-01' },
  firstShortfallDate: '2026-11-01',
  shortfallAmount: bob('2179.00'),
  belowZero: true,
};

export const HOME_BLOCK_HIGH: CashFlowHomeBlock = {
  horizonDays: 30,
  worst: {
    currency: 'BOB',
    risk: 'HIGH',
    lowest: bob('-679.00'),
    lowestDate: '2026-11-01',
    firstShortfallDate: '2026-11-01',
  },
  consolidatedLowest: { amount: bob('-679.00'), date: '2026-11-01' },
  complete: true,
};

export const HOME_BLOCK_NONE: CashFlowHomeBlock = {
  horizonDays: 30,
  worst: null,
  consolidatedLowest: { amount: bob('4949.12'), date: '2026-10-28' },
  complete: true,
};

// ───────────────────────────────────────────── banda del gasto variable predicho (add-predicted-cash-flow-band)

const toCents = (amount: string): bigint => BigInt(amount.replace('.', ''));
const fromCents = (value: bigint): string => {
  const sign = value < 0n ? '-' : '';
  const abs = (value < 0n ? -value : value).toString().padStart(3, '0');
  return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};
const minusCents = (amount: string, cents: bigint): Money => bob(fromCents(toCents(amount) - cents));

/**
 * Banda de BOB: del saldo de la serie principal se resta un gasto variable acumulado de 10.00, 30.00 y 5.00 por día
 * (esperado, alto y bajo). Con la reserva mínima de 1500.00 el saldo más bajo con gasto alto sigue por encima: improbable.
 */
export const PREDICTED_BOB: PredictedCashFlow = {
  status: 'AVAILABLE',
  reason: null,
  forecastRunId: '0190a000-0000-7000-8000-00000000c001',
  generatedAt: '2026-10-19T10:01:00Z',
  stale: false,
  intervalLevel: '0.8',
  series: BOB_SERIES.map((d, i) => ({
    date: d.date,
    expected: minusCents(d.balance.amount, BigInt((i + 1) * 1000)),
    high: minusCents(d.balance.amount, BigInt((i + 1) * 3000)),
    low: minusCents(d.balance.amount, BigInt((i + 1) * 500)),
  })),
  lowest: {
    expected: { amount: bob('3511.00'), date: '2026-10-28' },
    high: { amount: bob('2901.00'), date: '2026-10-28' },
  },
  shortfallLikelihood: 'UNLIKELY',
  firstShortfallDate: null,
};

export const PREDICTED_POSSIBLE: PredictedCashFlow = {
  ...PREDICTED_BOB,
  lowest: {
    expected: { amount: bob('2150.00'), date: '2026-12-14' },
    high: { amount: bob('1380.00'), date: '2026-12-14' },
  },
  shortfallLikelihood: 'POSSIBLE',
  firstShortfallDate: '2026-12-14',
};

export const unavailablePredicted = (
  reason: NonNullable<PredictedCashFlow['reason']>,
): PredictedCashFlow => ({
  status: 'NOT_AVAILABLE',
  reason,
  forecastRunId: null,
  generatedAt: null,
  stale: false,
  intervalLevel: '0.8',
  series: [],
  lowest: null,
  shortfallLikelihood: 'NOT_AVAILABLE',
  firstShortfallDate: null,
});

/** Q8 con el riesgo de los pagos conocidos en `NONE` y un déficit posible con el gasto predicho (TC-REPORTING-PREDICTED-010). */
export const HOME_BLOCK_PREDICTED: CashFlowHomeBlock = {
  ...HOME_BLOCK_NONE,
  predictedShortfall: { currency: 'BOB', likelihood: 'POSSIBLE', date: '2026-12-14' },
};
