import {
  currency as makeCurrency,
  dec,
  MoneyDecimal,
  Money,
  present,
  sumByCurrency,
  type Currency,
  type DatedAmount,
  type Decimal,
} from '@pf/shared-kernel';
import { ReportConversionPolicy, type ReportAmount } from './report-conversion.js';
import type { ReportPeriod } from './report-periods.js';

/*
 * Estructuras de datos puras de los reportes ampliados (openspec add-financial-reports-extended, FR-REPORTING-008):
 * etiquetas, cuentas, tendencias, comisiones, metas, deudas, costos recurrentes, suscripciones y conversiones. Todo lo
 * financiero se valora con `ReportConversionPolicy` (FlowValuation, nunca 1:1); aquí no hay E/S.
 */

const byAmountThenName = <T extends { amount: ReportAmount; name: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.amount.exact.comparedTo(a.amount.exact) || a.name.localeCompare(b.name, 'es'));

// ───────────────────────────────────────────── reporte 4: gastos por etiqueta

export interface TagFact {
  readonly date: string;
  readonly amount: Money;
  /** Conjunto de etiquetas de la porción (ids). */
  readonly tagIds: readonly string[];
}

export interface TagInfo {
  readonly tagId: string;
  readonly name: string;
  readonly archived: boolean;
}

export type TagMatch = 'ANY' | 'ALL';

export interface TagLine {
  readonly tagId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly amount: ReportAmount;
}

/**
 * `TagReport` (reporte 4): una porción con varias etiquetas suma en cada una, así que el reporte SIEMPRE es no aditivo
 * (`nonAdditive`). Con `ANY` cuenta en cada etiqueta pedida que tenga (o en todas las suyas si no se pidió ninguna);
 * con `ALL` solo cuentan las porciones que tienen todas las pedidas y suman en cada una de ellas. Puro.
 */
export const TagReport = {
  build(input: {
    readonly facts: readonly TagFact[];
    readonly tags: readonly TagInfo[];
    readonly requested: readonly string[];
    readonly match: TagMatch;
    readonly policy: ReportConversionPolicy;
    readonly perDays?: number;
  }): { readonly nonAdditive: true; readonly tags: readonly TagLine[] } {
    const { requested, match } = input;
    const wanted = new Set(requested);
    const rowsByTag = new Map<string, { date: string; amount: Money }[]>();
    for (const f of input.facts) {
      if (match === 'ALL' && requested.length > 0 && !requested.every((t) => f.tagIds.includes(t))) continue;
      const targets = requested.length > 0 ? f.tagIds.filter((t) => wanted.has(t)) : f.tagIds;
      for (const t of targets) {
        const rows = rowsByTag.get(t) ?? [];
        rows.push({ date: f.date, amount: f.amount });
        rowsByTag.set(t, rows);
      }
    }
    const info = new Map(input.tags.map((t) => [t.tagId, t]));
    const lines: TagLine[] = [...rowsByTag.entries()].map(([tagId, rows]) => ({
      tagId,
      name: info.get(tagId)?.name ?? tagId,
      archived: info.get(tagId)?.archived ?? true,
      amount: input.policy.value(rows, input.perDays),
    }));
    return { nonAdditive: true, tags: byAmountThenName(lines) };
  },
} as const;

// ───────────────────────────────────────────── reporte 5: gastos por cuenta

export interface AccountFact {
  readonly date: string;
  readonly accountId: string;
  readonly categoryId: string;
  readonly amount: Money;
}

export interface AccountInfo {
  readonly accountId: string;
  readonly name: string;
  readonly type: string;
  readonly institutionId: string | null;
}

export interface AccountSpendLine {
  readonly accountId: string;
  readonly name: string;
  readonly type: string;
  readonly institutionId: string | null;
  readonly amount: ReportAmount;
  readonly byCategory: readonly { readonly categoryId: string; readonly amount: ReportAmount }[];
}

/**
 * `AccountSpendReport` (reporte 5): gasto por cuenta pagadora desglosado por categoría. Cada porción tiene UNA cuenta,
 * así que la suma de las cuentas es el gasto total del rango (identidad que verifica `ReportReconciler`). Puro.
 */
export const AccountSpendReport = {
  build(input: {
    readonly facts: readonly AccountFact[];
    readonly accounts: readonly AccountInfo[];
    readonly policy: ReportConversionPolicy;
  }): { readonly accounts: readonly AccountSpendLine[]; readonly total: ReportAmount } {
    const info = new Map(input.accounts.map((a) => [a.accountId, a]));
    const ids = [...new Set(input.facts.map((f) => f.accountId))];
    const lines: (AccountSpendLine & { name: string })[] = ids.map((accountId) => {
      const own = input.facts.filter((f) => f.accountId === accountId);
      const categories = [...new Set(own.map((f) => f.categoryId))].map((categoryId) => ({
        categoryId,
        name: categoryId,
        amount: input.policy.value(
          own.filter((f) => f.categoryId === categoryId).map((f) => ({ date: f.date, amount: f.amount })),
        ),
      }));
      const a = info.get(accountId);
      return {
        accountId,
        name: a?.name ?? accountId,
        type: a?.type ?? 'OTHER',
        institutionId: a?.institutionId ?? null,
        amount: input.policy.value(own.map((f) => ({ date: f.date, amount: f.amount }))),
        byCategory: byAmountThenName(categories).map(({ categoryId, amount }) => ({ categoryId, amount })),
      };
    });
    return {
      accounts: byAmountThenName(lines),
      total: input.policy.value(input.facts.map((f) => ({ date: f.date, amount: f.amount }))),
    };
  },
} as const;

// ───────────────────────────────────────────── reporte 6: tendencias mensuales

export const TREND_TOP_SERIES = 7;
export const TREND_PERIOD_CHOICES: readonly number[] = [6, 12, 24];

export interface TrendFact {
  readonly date: string;
  readonly categoryId: string;
  readonly amount: Money;
}

export interface TrendCategory {
  readonly categoryId: string;
  readonly name: string;
  /** Categoría de primer nivel a la que suma (ella misma si no tiene padre). */
  readonly topId: string;
}

export interface TrendSeries {
  /** `null` = la serie "Otras categorías". */
  readonly categoryId: string | null;
  readonly name: string;
  readonly cells: readonly { readonly period: ReportPeriod; readonly amount: ReportAmount }[];
  readonly total: ReportAmount;
}

/** Suma `amount` al acumulado de su (día, moneda) en `rows` (exacto: `Money.add` no redondea). */
function accumulate(rows: Map<string, DatedAmount>, date: string, amount: Money): void {
  const key = `${date}|${amount.currency.code}`;
  const prev = rows.get(key);
  rows.set(key, prev ? { date, amount: prev.amount.add(amount) } : { date, amount });
}

/**
 * `TrendMatrix` (reporte 6): matriz categoría × periodo. Las 7 categorías de primer nivel con mayor gasto consolidado
 * del rango (empate por nombre) son series y el resto se agrupa en "Otras categorías"; con `perDays` cada celda se divide
 * por los días de su periodo sin redondeo intermedio. Puro.
 */
export const TrendMatrix = {
  build(input: {
    readonly facts: readonly TrendFact[];
    readonly categories: readonly TrendCategory[];
    readonly periods: readonly ReportPeriod[];
    readonly policy: ReportConversionPolicy;
    readonly perDay: boolean;
    readonly othersName: string;
  }): readonly TrendSeries[] {
    const top = new Map(input.categories.map((c) => [c.categoryId, c.topId]));
    const names = new Map(input.categories.map((c) => [c.categoryId, c.name]));
    const topOf = (id: string) => top.get(id) ?? id;

    // Una sola pasada (fix-trends-report-perf): cada hecho se acumula UNA vez por (categoría de primer nivel, día,
    // moneda). `ReportConversionPolicy.value` consolida por (día, moneda) antes de convertir, así que valorar sobre
    // estos acumulados da exactamente las mismas cifras que valorar los hechos. `Map` conserva el orden de primera
    // aparición de las categorías de primer nivel, del que depende el orden de las tasas usadas (ver abajo).
    const byTop = new Map<string, Map<string, DatedAmount>>();
    for (const fact of input.facts) {
      const id = topOf(fact.categoryId);
      let rows = byTop.get(id);
      if (!rows) byTop.set(id, (rows = new Map()));
      accumulate(rows, fact.date, fact.amount);
    }

    // Ranking de TODAS las categorías de primer nivel, en orden de primera aparición: es la primera valoración de
    // cada (moneda, día), de modo que `meta.conversion.ratesUsed` conserva el mismo orden que con la definición
    // funcional (las celdas y los totales solo consultan tasas ya consultadas).
    const ranked = byAmountThenName(
      [...byTop].map(([categoryId, rows]) => ({
        categoryId,
        name: names.get(categoryId) ?? categoryId,
        amount: input.policy.value([...rows.values()]),
      })),
    );
    const kept = ranked.slice(0, TREND_TOP_SERIES);

    // Periodo(s) de cada día distinto, por contención de fechas (los periodos de un reporte no se solapan, pero la
    // definición funcional filtra por contención: se conserva sin suponerlo).
    const periodsOfDay = new Map<string, number[]>();
    const periodIndexes = (date: string): readonly number[] => {
      let found = periodsOfDay.get(date);
      if (!found) {
        found = [];
        input.periods.forEach((p, i) => {
          if (date >= p.from && date <= p.to) (found as number[]).push(i);
        });
        periodsOfDay.set(date, found);
      }
      return found;
    };
    const totalDays = input.perDay ? input.periods.reduce((n, p) => n + p.days, 0) : undefined;
    const seriesOf = (
      categoryId: string | null,
      name: string,
      rows: ReadonlyMap<string, DatedAmount>,
      /** Total ya valorado (el del ranking), reutilizable solo sin normalizar por día: es la misma valoración. */
      known?: ReportAmount,
    ): TrendSeries => {
      const buckets: DatedAmount[][] = input.periods.map(() => []);
      for (const row of rows.values()) {
        for (const i of periodIndexes(row.date)) (buckets[i] as DatedAmount[]).push(row);
      }
      return {
        categoryId,
        name,
        cells: input.periods.map((period, i) => ({
          period,
          amount: input.policy.value(buckets[i] as DatedAmount[], input.perDay ? period.days : undefined),
        })),
        total: known ?? input.policy.value([...rows.values()], totalDays),
      };
    };
    const series: TrendSeries[] = kept.map((k) =>
      seriesOf(
        k.categoryId,
        k.name,
        byTop.get(k.categoryId) as Map<string, DatedAmount>,
        input.perDay ? undefined : k.amount,
      ),
    );
    const rest = ranked.slice(TREND_TOP_SERIES);
    if (rest.length > 0) {
      // «Otras categorías»: los acumulados de las restantes, sumados por (día, moneda).
      const others = new Map<string, DatedAmount>();
      for (const r of rest) {
        for (const row of (byTop.get(r.categoryId) as Map<string, DatedAmount>).values()) {
          accumulate(others, row.date, row.amount);
        }
      }
      series.push(seriesOf(null, input.othersName, others));
    }
    return series;
  },
} as const;

// ───────────────────────────────────────────── reporte 14: comisiones

export type FeeType = 'CONVERSION' | 'TRANSFER' | 'LOAN' | 'CARD' | 'FEE_CATEGORY';
export const FEE_TYPES: readonly FeeType[] = ['CONVERSION', 'TRANSFER', 'LOAN', 'CARD', 'FEE_CATEGORY'];

export interface FeeFact {
  readonly date: string;
  readonly amount: Money;
  readonly categoryId: string;
  /** Tipo de la transacción de la porción y su rol (`FEE` para las comisiones de transferencias y conversiones). */
  readonly transactionKind: string;
  readonly portionRole: 'NOMINAL' | 'FEE';
  /** Rol de DEBT de la transacción (`CARD_CHARGE`: interés y cargos de una tarjeta, add-card-interest-ledger-portions). */
  readonly debtRole?: 'CARD_CHARGE' | null;
}

/**
 * Clasificación EXCLUSIVA de una porción de gasto en un tipo de comisión (decisión 4): comisión de una conversión, de
 * una transferencia, porciones de un pago de préstamo (interés, cargos, seguro, impuestos), porciones de un cargo de
 * tarjeta registrado o adoptado (`debtRole = CARD_CHARGE`, antes que las categorías: nunca inferido por categoría, D372) o
 * gasto en las categorías de comisiones del sistema. `null` si no es una comisión.
 */
export function classifyFee(f: FeeFact, feeCategoryIds: ReadonlySet<string>): FeeType | null {
  if (f.portionRole === 'FEE' && f.transactionKind === 'CONVERSION') return 'CONVERSION';
  if (f.portionRole === 'FEE' && f.transactionKind === 'TRANSFER') return 'TRANSFER';
  if (f.transactionKind === 'LOAN_PAYMENT') return 'LOAN';
  if (f.debtRole === 'CARD_CHARGE') return 'CARD';
  if (f.portionRole === 'NOMINAL' && feeCategoryIds.has(f.categoryId)) return 'FEE_CATEGORY';
  return null;
}

export interface FeeMonth {
  readonly period: ReportPeriod;
  readonly byType: readonly { readonly type: FeeType; readonly amount: ReportAmount }[];
  readonly total: ReportAmount;
}

export const FeeBreakdown = {
  build(input: {
    readonly facts: readonly FeeFact[];
    readonly feeCategoryIds: ReadonlySet<string>;
    readonly periods: readonly ReportPeriod[];
    readonly policy: ReportConversionPolicy;
  }): readonly FeeMonth[] {
    const classified = input.facts
      .map((f) => ({ f, type: classifyFee(f, input.feeCategoryIds) }))
      .filter((x): x is { f: FeeFact; type: FeeType } => x.type !== null);
    return input.periods.map((period) => {
      const own = classified.filter((x) => x.f.date >= period.from && x.f.date <= period.to);
      const byType = FEE_TYPES.map((type) => ({
        type,
        amount: input.policy.value(
          own.filter((x) => x.type === type).map((x) => ({ date: x.f.date, amount: x.f.amount })),
        ),
      }));
      return {
        period,
        byType,
        total: ReportConversionPolicy.combine(
          input.policy.target,
          byType.map((b) => b.amount),
        ),
      };
    });
  },

  /** Total de los últimos 12 meses completos (los 12 periodos anteriores al que contiene hoy). */
  last12Months(months: readonly FeeMonth[], policy: ReportConversionPolicy): ReportAmount {
    return ReportConversionPolicy.combine(
      policy.target,
      months.map((m) => m.total),
    );
  },
} as const;

// ───────────────────────────────────────────── reporte 9: metas de ahorro

export type GoalStatusKind = 'BEHIND' | 'ON_TRACK' | 'AHEAD';

export interface GoalMonthInput {
  readonly monthEnd: string;
  readonly contributions: Money;
  readonly withdrawals: Money;
  readonly accumulated: Money;
  readonly expected: Money | null;
  readonly status: GoalStatusKind | null;
  readonly complete: boolean;
}

export interface GoalInput {
  readonly goalId: string;
  readonly name: string;
  readonly currency: string;
  readonly target: Money;
  readonly startDate: string;
  readonly targetDate: string | null;
  readonly months: readonly GoalMonthInput[];
}

export interface GoalSeries extends GoalInput {
  readonly months: readonly (GoalMonthInput & { readonly period: string; readonly percent: string | null })[];
}

/**
 * `GoalProgressSeries` (reporte 9): ordena las metas por nombre y agrega el porcentaje del objetivo de cada cierre
 * (2 decimales HALF_EVEN, `null` con objetivo cero). El seguimiento (`expected`, `status`) lo calcula GOALS: aquí no se
 * recalcula. Puro.
 */
export const GoalProgressSeries = {
  build(goals: readonly GoalInput[]): readonly GoalSeries[] {
    return [...goals]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((g) => ({
        ...g,
        months: g.months.map((m) => ({
          ...m,
          period: m.monthEnd.slice(0, 7),
          percent: g.target.isZero()
            ? null
            : m.accumulated
                .toDecimal()
                .times(100)
                .div(g.target.toDecimal())
                .toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN)
                .toFixed(2),
        })),
      }));
  },
} as const;

// ───────────────────────────────────────────── reporte 10: evolución de deudas

export interface DebtInfo {
  readonly debtId: string;
  readonly kind: 'LOAN' | 'CARD';
  readonly name: string;
  readonly currency: string;
}

export interface DebtMonthInput {
  readonly period: ReportPeriod;
  /** Saldo pendiente al cierre (positivo = se debe). */
  readonly outstanding: Money;
  /** Pagado en el mes por componente con la fecha de cada pago; `null` en tarjetas (sin desglose de pagos). */
  readonly payments:
    | readonly {
        readonly date: string;
        readonly principal: Money;
        readonly interest: Money;
        readonly charges: Money;
      }[]
    | null;
  /**
   * Cargado en el mes por las porciones de los cargos vigentes de una tarjeta (interés y demás cargos) con la fecha de
   * cada cargo; `null` en préstamos (add-card-interest-ledger-portions).
   */
  readonly charged?:
    readonly { readonly date: string; readonly interest: Money; readonly other: Money }[] | null;
}

export interface DebtSeries extends DebtInfo {
  readonly months: readonly {
    readonly period: ReportPeriod;
    readonly outstanding: Money;
    readonly principalPaid: Money | null;
    readonly interestPaid: Money | null;
    readonly chargesPaid: Money | null;
    /** Interés y demás cargos (comisiones, seguro, impuestos) cargados por la tarjeta; `null` en préstamos. */
    readonly interestCharged: Money | null;
    readonly chargesCharged: Money | null;
  }[];
}

/**
 * `DebtEvolutionSeries` (reporte 10): por deuda y mes, saldo pendiente al cierre (ledger) y principal, interés y cargos
 * pagados (desglose de cada pago, INV-016). El consolidado valora los saldos con la tasa del cierre y lo pagado con la
 * tasa de la fecha de cada pago. Puro.
 */
export const DebtEvolutionSeries = {
  series(
    debts: readonly (DebtInfo & { readonly months: readonly DebtMonthInput[] })[],
  ): readonly DebtSeries[] {
    return [...debts]
      .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.debtId.localeCompare(b.debtId))
      .map((d) => ({
        debtId: d.debtId,
        kind: d.kind,
        name: d.name,
        currency: d.currency,
        months: d.months.map((m) => {
          const sum = (pick: (p: NonNullable<DebtMonthInput['payments']>[number]) => Money): Money | null => {
            if (m.payments === null) return null;
            const code = m.outstanding.currency;
            return m.payments.reduce((acc, p) => acc.add(pick(p)), Money.zero(code));
          };
          const charged = (
            pick: (p: NonNullable<DebtMonthInput['charged']>[number]) => Money,
          ): Money | null => {
            if (m.charged === undefined || m.charged === null) return null;
            return m.charged.reduce((acc, p) => acc.add(pick(p)), Money.zero(m.outstanding.currency));
          };
          return {
            period: m.period,
            outstanding: m.outstanding,
            principalPaid: sum((p) => p.principal),
            interestPaid: sum((p) => p.interest),
            chargesPaid: sum((p) => p.charges),
            interestCharged: charged((p) => p.interest),
            chargesCharged: charged((p) => p.other),
          };
        }),
      }));
  },

  /** Consolidado por mes: saldos a la tasa de cada cierre y pagos a la de su fecha. */
  consolidate(
    debts: readonly (DebtInfo & { readonly months: readonly DebtMonthInput[] })[],
    periods: readonly ReportPeriod[],
    balances: ReportConversionPolicy,
    flows: ReportConversionPolicy,
  ): readonly {
    readonly period: ReportPeriod;
    readonly outstanding: ReportAmount;
    readonly principalPaid: ReportAmount;
    readonly interestPaid: ReportAmount;
    readonly interestCharged: ReportAmount;
  }[] {
    return periods.map((period) => {
      const months = debts.flatMap((d) => d.months.filter((m) => m.period.to === period.to));
      const payments = months.flatMap((m) => m.payments ?? []);
      const charges = months.flatMap((m) => m.charged ?? []);
      return {
        period,
        outstanding: balances.value(months.map((m) => ({ date: period.to, amount: m.outstanding }))),
        principalPaid: flows.value(payments.map((p) => ({ date: p.date, amount: p.principal }))),
        interestPaid: flows.value(payments.map((p) => ({ date: p.date, amount: p.interest }))),
        // Solo el interés cargado de las tarjetas, a la tasa de la fecha de cada cargo.
        interestCharged: flows.value(charges.map((p) => ({ date: p.date, amount: p.interest }))),
      };
    });
  },
} as const;

// ───────────────────────────────────────────── reporte 11: costos recurrentes

export interface RecurringCostInput {
  readonly definitionId: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly cadence: string;
  readonly interval: number;
  readonly currency: Currency;
  /** Renovaciones por año (decimal exacto); `null` si el calendario no admite normalización. */
  readonly renewalsPerYear: string | null;
  /** Precio por renovación; `null` en los de monto variable. */
  readonly price: string | null;
  readonly variable: boolean;
}

export interface RecurringCostLine {
  readonly definitionId: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly cadence: string;
  readonly interval: number;
  readonly variable: boolean;
  /** Costo mensual y anual en la moneda nativa; `null` si es variable o no se puede normalizar. */
  readonly monthly: Money | null;
  readonly annual: Money | null;
  /** Consolidado en la moneda de reporte (mensual); `null` sin tasa o sin monto. */
  readonly monthlyReporting: Money | null;
}

/** Moneda de trabajo con 12 decimales: el costo anual/mensual se calcula exacto y se presenta al final. */
const wide = (c: Currency): Currency => makeCurrency(c.code, Math.max(c.scale, 12));

/**
 * `RecurringCostTable` (reporte 11): costo mensual (= anual ÷ 12) y anual de cada compromiso recurrente de egreso activo
 * (precio × renovaciones por año), ordenado por costo mensual consolidado. Los de monto variable se cuentan aparte
 * (`variableCount`) y no suman. Los totales se valoran UNA vez desde el anual exacto con la tasa vigente. Puro.
 */
export const RecurringCostTable = {
  build(input: {
    readonly items: readonly RecurringCostInput[];
    readonly asOf: string;
    readonly policy: ReportConversionPolicy;
  }): {
    readonly items: readonly RecurringCostLine[];
    readonly totals: { readonly monthly: ReportAmount; readonly annual: ReportAmount };
    readonly variableCount: number;
  } {
    const annualExact = (i: RecurringCostInput): Decimal | null =>
      i.variable || i.price === null || i.renewalsPerYear === null
        ? null
        : dec(i.price).times(dec(i.renewalsPerYear));
    const annualRows = input.items.flatMap((i) => {
      const a = annualExact(i);
      return a === null ? [] : [{ date: input.asOf, amount: Money.roundToScale(a, wide(i.currency)) }];
    });
    const twelve = dec('12');
    const lines: RecurringCostLine[] = input.items.map((i) => {
      const a = annualExact(i);
      const base = {
        definitionId: i.definitionId,
        name: i.name,
        categoryId: i.categoryId,
        cadence: i.cadence,
        interval: i.interval,
        variable: i.variable,
      };
      if (a === null) return { ...base, monthly: null, annual: null, monthlyReporting: null };
      const consolidated = input.policy.value([
        { date: input.asOf, amount: Money.roundToScale(a, wide(i.currency)) },
      ]);
      return {
        ...base,
        monthly: present(a.div(twelve), i.currency),
        annual: present(a, i.currency),
        monthlyReporting: consolidated.complete
          ? present(consolidated.exact.div(twelve), input.policy.target)
          : null,
      };
    });
    const ordered = lines.sort(
      (a, b) =>
        (b.monthlyReporting?.toDecimal() ?? dec('-1')).comparedTo(
          a.monthlyReporting?.toDecimal() ?? dec('-1'),
        ) || a.name.localeCompare(b.name, 'es'),
    );
    const annual = input.policy.value(annualRows);
    const monthlyExact = annual.exact.div(twelve);
    const nativeCurrencies = new Map(input.items.map((i) => [i.currency.code, i.currency]));
    const monthly: ReportAmount = {
      byCurrency: sumByCurrency(
        input.items.flatMap((i) => {
          const a = annualExact(i);
          return a === null ? [] : [present(a.div(twelve), i.currency)];
        }),
      ),
      consolidated: present(monthlyExact, input.policy.target),
      exact: monthlyExact,
      complete: annual.complete,
      unconverted: annual.unconverted.map((m) =>
        present(m.toDecimal().div(twelve), nativeCurrencies.get(m.currency.code) ?? m.currency),
      ),
    };
    return {
      items: ordered,
      totals: {
        monthly,
        annual: {
          ...annual,
          byCurrency: sumByCurrency(
            input.items.flatMap((i) => {
              const a = annualExact(i);
              return a === null ? [] : [present(a, i.currency)];
            }),
          ),
          unconverted: annual.unconverted.map((m) =>
            present(m.toDecimal(), nativeCurrencies.get(m.currency.code) ?? m.currency),
          ),
        },
      },
      variableCount: input.items.filter((i) => i.variable).length,
    };
  },
} as const;

// ───────────────────────────────────────────── reporte 12: evolución de suscripciones

export type SubscriptionEventKind = 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED';

export interface SubscriptionEvent {
  readonly subscriptionId: string;
  readonly name: string;
  readonly date: string;
  readonly kind: SubscriptionEventKind;
  readonly previousPrice: Money | null;
  readonly newPrice: Money | null;
  readonly renewalsPerYear: string;
}

/**
 * `SubscriptionCostSeries` (reporte 12): reconstruye desde los eventos (alta, cambio de precio, baja) el precio vigente de
 * cada suscripción al cierre de cada mes; el costo mensual normalizado es precio × renovaciones por año ÷ 12 y se valora
 * con la tasa del cierre (`policy` de saldos). Los eventos se asignan al periodo que contiene su fecha. Puro.
 */
export const SubscriptionCostSeries = {
  build(input: {
    readonly events: readonly SubscriptionEvent[];
    readonly periods: readonly ReportPeriod[];
    readonly policy: ReportConversionPolicy;
  }): readonly {
    readonly period: ReportPeriod;
    readonly monthlyCost: ReportAmount;
    readonly active: number;
    readonly events: readonly SubscriptionEvent[];
  }[] {
    const sorted = [...input.events].sort(
      (a, b) => a.date.localeCompare(b.date) || a.subscriptionId.localeCompare(b.subscriptionId),
    );
    const twelve = dec('12');
    return input.periods.map((period) => {
      const state = new Map<string, { price: Money; renewals: string } | null>();
      for (const e of sorted) {
        if (e.date > period.to) break;
        if (e.kind === 'CANCELLED') state.set(e.subscriptionId, null);
        else if (e.newPrice) state.set(e.subscriptionId, { price: e.newPrice, renewals: e.renewalsPerYear });
      }
      const live = [...state.values()].filter((s): s is { price: Money; renewals: string } => s !== null);
      const rows = live.map((s) => ({
        date: period.to,
        amount: Money.roundToScale(
          s.price.toDecimal().times(dec(s.renewals)).div(twelve),
          wide(s.price.currency),
        ),
      }));
      const valued = input.policy.value(rows);
      const natives = new Map(live.map((s) => [s.price.currency.code, s.price.currency]));
      return {
        period,
        monthlyCost: {
          ...valued,
          byCurrency: sumByCurrency(
            live.map((s) =>
              present(s.price.toDecimal().times(dec(s.renewals)).div(twelve), s.price.currency),
            ),
          ),
          unconverted: valued.unconverted.map((m) =>
            present(m.toDecimal(), natives.get(m.currency.code) ?? m.currency),
          ),
        },
        active: live.length,
        events: sorted.filter((e) => e.date >= period.from && e.date <= period.to),
      };
    });
  },
} as const;

// ───────────────────────────────────────────── reporte 13: conversiones

export interface ConversionPointInput {
  readonly transactionId: string;
  readonly date: string;
  readonly base: string;
  readonly quote: string;
  /** Tasa efectiva en la orientación base/quote del par de visualización. */
  readonly effectiveRate: string;
  /** Referencia registrada con su orientación almacenada; `null` si no se registró una. */
  readonly reference: { readonly base: string; readonly quote: string; readonly value: string } | null;
}

export interface ConversionPoint {
  readonly transactionId: string;
  readonly date: string;
  readonly pair: string;
  readonly effectiveRate: string;
  /** Referencia en la orientación de la tasa efectiva; `null` sin referencia (nunca se estima). */
  readonly referenceRate: string | null;
}

/**
 * `ConversionScatter` (reporte 13): un punto por conversión posteada con su tasa efectiva y la de referencia registrada,
 * orientada al par de visualización (la inversa exacta a 8 decimales HALF_EVEN solo para mostrar). Sin referencia el
 * punto va sin comparación. Puro.
 */
export const ConversionScatter = {
  points(input: readonly ConversionPointInput[]): readonly ConversionPoint[] {
    return [...input]
      .sort((a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId))
      .map((p) => {
        let referenceRate: string | null = null;
        if (p.reference) {
          if (p.reference.base === p.base && p.reference.quote === p.quote) referenceRate = p.reference.value;
          else if (p.reference.base === p.quote && p.reference.quote === p.base) {
            referenceRate = dec('1')
              .div(dec(p.reference.value))
              .toDecimalPlaces(8, MoneyDecimal.ROUND_HALF_EVEN)
              .toFixed(8);
          }
        }
        return {
          transactionId: p.transactionId,
          date: p.date,
          pair: `${p.base}/${p.quote}`,
          effectiveRate: p.effectiveRate,
          referenceRate,
        };
      });
  },
} as const;
