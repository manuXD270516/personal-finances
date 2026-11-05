import { dec, type Decimal, type Money } from '@pf/shared-kernel';
import type { LiquidityCurrencyBlock } from './liquidity-flow-report.js';
import type { NetWorthDecomposition } from './net-worth-decomposer.js';

/** Diferencia hallada entre un reporte y el ledger: nombra el reporte, el periodo y la moneda (tolerancia cero). */
export interface ReconciliationMismatch {
  readonly report: string;
  readonly period: string;
  readonly currency: string;
  readonly identity: string;
  readonly expected: string;
  readonly actual: string;
}

export const describeMismatch = (m: ReconciliationMismatch): string =>
  `${m.report} ${m.period} ${m.currency}: ${m.identity} esperado ${m.expected} y obtenido ${m.actual}`;

const diff = (
  report: string,
  period: string,
  currency: string,
  identity: string,
  expected: Decimal,
  actual: Decimal,
): ReconciliationMismatch[] =>
  expected.eq(actual)
    ? []
    : [
        {
          report,
          period,
          currency,
          identity,
          // Mismos decimales en ambas cifras (al menos 2) para que la diferencia mínima se lea: 3300.00 y 3300.01.
          expected: expected.toFixed(Math.max(expected.decimalPlaces(), actual.decimalPlaces(), 2)),
          actual: actual.toFixed(Math.max(expected.decimalPlaces(), actual.decimalPlaces(), 2)),
        },
      ];

/**
 * `ReportReconciler` (FR-REPORTING-008, NFR-DATA-008; design decisión 11): la MISMA batería de identidades para el PBT
 * de dominio, la integración con Demo v2 y el nightly. Cada verificación recibe la cifra del reporte y la del camino
 * independiente del ledger y devuelve las diferencias (vacío = cuadra). Tolerancia cero en nativo. Puro.
 */
export const ReportReconciler = {
  /** Ingreso o gasto nativo del reporte = movimientos sobre las cuentas de ingreso o gasto del ledger. */
  nativeFlow(
    report: string,
    period: string,
    identity: 'income' | 'expenses',
    reported: Money,
    ledger: Money,
  ): ReconciliationMismatch[] {
    return diff(report, period, reported.currency.code, identity, ledger.toDecimal(), reported.toDecimal());
  },

  /** Σ de las categorías (nativo) = gasto del reporte. */
  categorySum(
    report: string,
    period: string,
    expenses: Money,
    categories: readonly Money[],
  ): ReconciliationMismatch[] {
    const sum = categories.reduce((a, m) => a.plus(m.toDecimal()), dec('0'));
    return diff(
      report,
      period,
      expenses.currency.code,
      'sum(categories)=expenses',
      expenses.toDecimal(),
      sum,
    );
  },

  /** Flujo de caja: inicial + componentes = final con los saldos contables (por moneda). */
  cashFlow(period: string, block: LiquidityCurrencyBlock): ReconciliationMismatch[] {
    const total = [
      block.operating,
      block.debt,
      block.savingsInvestments,
      block.currencyExchange,
      block.adjustments,
    ].reduce((a, m) => a.plus(m.toDecimal()), block.opening.toDecimal());
    return diff(
      'CASH_FLOW',
      period,
      block.currency,
      'opening+components=closing',
      block.closing.toDecimal(),
      total,
    );
  },

  /** Historial de saldo: el saldo de un día = el saldo contable de la cuenta a esa fecha. */
  balanceDay(accountPeriod: string, reported: Money, ledger: Money): ReconciliationMismatch[] {
    return diff(
      'ACCOUNT_BALANCE_HISTORY',
      accountPeriod,
      reported.currency.code,
      'day balance=ledger balance',
      ledger.toDecimal(),
      reported.toDecimal(),
    );
  },

  /** Drill-down: Σ de las filas = cifra de la celda (por moneda nativa). */
  drillDown(
    report: string,
    cell: string,
    cellTotal: Money,
    rows: readonly Money[],
  ): ReconciliationMismatch[] {
    const sum = rows.reduce((a, m) => a.plus(m.toDecimal()), dec('0'));
    return diff(report, cell, cellTotal.currency.code, 'sum(rows)=cell', cellTotal.toDecimal(), sum);
  },

  /** Descomposición del patrimonio: ΔNW = Σ componentes a precisión 40. */
  netWorth(period: string, reportingCurrency: string, d: NetWorthDecomposition): ReconciliationMismatch[] {
    return diff(
      'NET_WORTH',
      period,
      reportingCurrency,
      'delta=sum(components)',
      d.deltaExact,
      d.componentsExact,
    );
  },

  /** Consolidado = `FlowValuation.consolidate` recalculado, sin redondear (comparación exacta de decimales). */
  consolidated(
    report: string,
    period: string,
    currency: string,
    reported: Decimal,
    recomputed: Decimal,
  ): ReconciliationMismatch[] {
    return diff(report, period, currency, 'consolidated=recomputed', recomputed, reported);
  },
} as const;
