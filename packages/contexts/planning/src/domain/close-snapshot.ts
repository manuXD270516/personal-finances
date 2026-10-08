import { dec, type Decimal } from '@pf/shared-kernel';
import type { ChecklistItem, MoneyValue } from './close-checklist.js';
import type { ChecklistItemKind } from './closing-policy.js';

/** Versión del esquema interno del contenido (`close-snapshot-content.v1`, design.md decisión 9). */
export const CLOSE_SNAPSHOT_CONTENT_VERSION = 1;

export type ReconciliationBasis = 'STATEMENT' | 'WITHOUT_STATEMENT';

/** Evidencia de la última conciliación finalizada de la cuenta (informativa aunque la cuenta no esté conciliada). */
export interface SnapshotReconciliation {
  readonly reconciliationId: string;
  readonly statementDate: string;
  readonly statementBalance: MoneyValue;
}

export interface SnapshotBalance {
  readonly accountId: string;
  readonly accountName: string;
  readonly ledgerAccountId: string | null;
  readonly currency: string;
  /** Saldo contable a `periodEnd` (Σ postings con signo). */
  readonly balance: MoneyValue;
  /** Saldo presentado según la naturaleza (deuda en positivo). */
  readonly presented: MoneyValue;
  readonly reconciliation: SnapshotReconciliation | null;
  /** `null` si la cuenta no estaba conciliada al cierre (advertencia reconocida). */
  readonly reconciliationBasis: ReconciliationBasis | null;
  readonly reconciledWithoutStatementTransactionIds: readonly string[];
}

export interface SnapshotWithoutStatementRow {
  readonly transactionId: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly amount: MoneyValue;
}

export interface SnapshotCurrencyFlows {
  readonly currency: string;
  readonly income: MoneyValue;
  readonly expense: MoneyValue;
  readonly savings: MoneyValue;
}

export interface SnapshotFlows {
  readonly byCurrency: readonly SnapshotCurrencyFlows[];
  readonly consolidated: {
    readonly currency: string;
    readonly income: MoneyValue;
    readonly expense: MoneyValue;
    readonly savings: MoneyValue;
    /** Un decimal (HALF_EVEN), `null` sin ingresos. */
    readonly savingsRate: string | null;
    readonly complete: boolean;
    readonly unconverted: readonly MoneyValue[];
  };
}

export interface SnapshotNetWorth {
  readonly amount: MoneyValue;
  readonly assets: MoneyValue;
  readonly liabilities: MoneyValue;
  readonly complete: boolean;
  readonly unconverted: readonly MoneyValue[];
  /** Tasas usadas (valoración de stocks y de cada flujo), tal como las resolvió FX. */
  readonly rates: readonly Readonly<Record<string, unknown>>[];
}

export interface SnapshotBudgetLine {
  readonly target: { readonly kind: 'CATEGORY' | 'GROUP' | 'TAG'; readonly id: string };
  readonly targetName: string;
  readonly nature: 'EXPENSE' | 'INCOME';
  readonly reference: MoneyValue;
  readonly actual: MoneyValue;
  readonly status: string;
}

export interface SnapshotBudget {
  readonly budgetId: string;
  readonly currency: string;
  readonly lines: readonly SnapshotBudgetLine[];
  readonly totals: { readonly planned: MoneyValue; readonly actual: MoneyValue; readonly complete: boolean };
}

export interface AcknowledgedWarnings {
  readonly items: readonly ChecklistItemKind[];
  readonly by: string | null;
  readonly at: string;
}

/** Contenido inmutable del snapshot de cierre: todo monto como `{amount: "decimal", currency}` (nunca `number`). */
export interface CloseSnapshotContent {
  readonly schemaVersion: number;
  readonly period: {
    readonly periodId: string;
    readonly label: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly startDay: number;
  };
  readonly baseCurrency: string;
  readonly balances: readonly SnapshotBalance[];
  readonly reconciledWithoutStatement: readonly SnapshotWithoutStatementRow[];
  readonly flows: SnapshotFlows;
  readonly netWorth: SnapshotNetWorth;
  /** `null` si el periodo no tiene plan. */
  readonly budgetVsActual: SnapshotBudget | null;
  /** `null` hasta Phase 4 (metas). */
  readonly goalContributions: null;
  readonly checklist: readonly ChecklistItem[];
  readonly acknowledgedWarnings: AcknowledgedWarnings | null;
}

export interface SnapshotAccountInput {
  readonly accountId: string;
  readonly accountName: string;
  readonly ledgerAccountId: string | null;
  readonly currency: string;
  readonly balance: MoneyValue;
  readonly presented: MoneyValue;
  readonly reconciliation: SnapshotReconciliation | null;
  readonly reconciliationBasis: ReconciliationBasis | null;
}

export interface SnapshotBuildInput {
  readonly period: CloseSnapshotContent['period'];
  readonly baseCurrency: string;
  readonly accounts: readonly SnapshotAccountInput[];
  readonly withoutStatement: readonly SnapshotWithoutStatementRow[];
  readonly flows: {
    readonly byCurrency: readonly {
      readonly currency: string;
      readonly income: MoneyValue;
      readonly expense: MoneyValue;
    }[];
    readonly consolidated: SnapshotFlows['consolidated'];
  };
  readonly netWorth: SnapshotNetWorth;
  readonly budgetVsActual: SnapshotBudget | null;
  readonly checklist: readonly ChecklistItem[];
  readonly acknowledgedWarnings: AcknowledgedWarnings | null;
}

const scaleOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;
/** Resta exacta de dos montos de la misma moneda (misma escala canónica). */
const subtract = (a: MoneyValue, b: MoneyValue): MoneyValue => ({
  amount: dec(a.amount)
    .minus(b.amount)
    .toFixed(Math.max(scaleOf(a.amount), scaleOf(b.amount))),
  currency: a.currency,
});

/**
 * DS `CloseSnapshotBuilder` (FR-PLANNING-004; design.md decisión 9), puro. Ensambla el contenido inmutable con los
 * insumos ya consultados: los saldos y flujos por moneda son EXACTOS (sin redondeo); los consolidados en la moneda
 * base llegan de REPORTING ya cuantizados UNA sola vez con HALF_EVEN (INV-020). El ahorro por moneda es ingresos − gastos.
 */
export const CloseSnapshotBuilder = {
  build(input: SnapshotBuildInput): CloseSnapshotContent {
    const withoutStatementByAccount = new Map<string, string[]>();
    for (const row of input.withoutStatement) {
      withoutStatementByAccount.set(row.accountId, [
        ...(withoutStatementByAccount.get(row.accountId) ?? []),
        row.transactionId,
      ]);
    }
    const balances: SnapshotBalance[] = [...input.accounts]
      .sort((a, b) =>
        a.accountName === b.accountName
          ? a.accountId.localeCompare(b.accountId)
          : a.accountName.localeCompare(b.accountName),
      )
      .map((a) => {
        // Una sola escala por cuenta (la mayor del texto recibido): la ida y vuelta por `numeric` es exacta.
        const scale = Math.max(
          scaleOf(a.balance.amount),
          scaleOf(a.presented.amount),
          a.reconciliation ? scaleOf(a.reconciliation.statementBalance.amount) : 0,
        );
        const fix = (m: MoneyValue): MoneyValue => ({
          amount: dec(m.amount).toFixed(scale),
          currency: m.currency,
        });
        return {
          accountId: a.accountId,
          accountName: a.accountName,
          ledgerAccountId: a.ledgerAccountId,
          currency: a.currency,
          balance: fix(a.balance),
          presented: fix(a.presented),
          reconciliation: a.reconciliation
            ? { ...a.reconciliation, statementBalance: fix(a.reconciliation.statementBalance) }
            : null,
          reconciliationBasis: a.reconciliationBasis,
          reconciledWithoutStatementTransactionIds:
            a.reconciliationBasis === 'WITHOUT_STATEMENT'
              ? [...(withoutStatementByAccount.get(a.accountId) ?? [])].sort()
              : [],
        };
      });
    return {
      schemaVersion: CLOSE_SNAPSHOT_CONTENT_VERSION,
      period: input.period,
      baseCurrency: input.baseCurrency,
      balances,
      reconciledWithoutStatement: [...input.withoutStatement].sort((a, b) =>
        a.businessDate === b.businessDate
          ? a.transactionId.localeCompare(b.transactionId)
          : a.businessDate.localeCompare(b.businessDate),
      ),
      flows: {
        byCurrency: [...input.flows.byCurrency]
          .sort((a, b) => a.currency.localeCompare(b.currency))
          .map((f) => ({
            currency: f.currency,
            income: f.income,
            expense: f.expense,
            savings: subtract(f.income, f.expense),
          })),
        consolidated: input.flows.consolidated,
      },
      netWorth: input.netWorth,
      budgetVsActual: input.budgetVsActual,
      goalContributions: null,
      checklist: input.checklist,
      acknowledgedWarnings: input.acknowledgedWarnings,
    };
  },
} as const;

/** JSON canónico (claves ordenadas, sin espacios): base del `content_sha256` (design.md decisión 9). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

// ───────────────────────────────────────── comparación entre versiones y variación respecto al periodo anterior

export interface SnapshotDiff {
  readonly balances: readonly {
    readonly accountId: string;
    readonly currency: string;
    readonly delta: MoneyValue;
  }[];
  readonly flows: {
    readonly byCurrency: readonly {
      readonly currency: string;
      readonly income: MoneyValue;
      readonly expense: MoneyValue;
      readonly savings: MoneyValue;
    }[];
    readonly consolidated: {
      readonly income: MoneyValue;
      readonly expense: MoneyValue;
      readonly savings: MoneyValue;
    };
  };
  readonly netWorth: { readonly delta: MoneyValue };
}

const zero = (currency: string, scale: number): MoneyValue => ({ amount: dec('0').toFixed(scale), currency });

/** `to - from` por cuenta, por moneda y en los consolidados (exacto; una cuenta ausente en una versión vale 0). */
export const SnapshotComparator = {
  diff(from: CloseSnapshotContent, to: CloseSnapshotContent): SnapshotDiff {
    const fromBalances = new Map(from.balances.map((b) => [b.accountId, b]));
    const toBalances = new Map(to.balances.map((b) => [b.accountId, b]));
    const accountIds = [...new Set([...fromBalances.keys(), ...toBalances.keys()])];
    const balances = accountIds
      .map((accountId) => {
        const a = fromBalances.get(accountId);
        const b = toBalances.get(accountId);
        const ref = (b ?? a) as SnapshotBalance;
        const scale = scaleOf(ref.balance.amount);
        return {
          accountId,
          currency: ref.currency,
          delta: subtract(b?.balance ?? zero(ref.currency, scale), a?.balance ?? zero(ref.currency, scale)),
        };
      })
      .sort((x, y) => x.accountId.localeCompare(y.accountId));

    const fromFlows = new Map(from.flows.byCurrency.map((f) => [f.currency, f]));
    const toFlows = new Map(to.flows.byCurrency.map((f) => [f.currency, f]));
    const currencies = [...new Set([...fromFlows.keys(), ...toFlows.keys()])].sort();
    const byCurrency = currencies.map((currency) => {
      const a = fromFlows.get(currency);
      const b = toFlows.get(currency);
      const ref = (b ?? a) as SnapshotCurrencyFlows;
      const z = zero(currency, scaleOf(ref.income.amount));
      return {
        currency,
        income: subtract(b?.income ?? z, a?.income ?? z),
        expense: subtract(b?.expense ?? z, a?.expense ?? z),
        savings: subtract(b?.savings ?? z, a?.savings ?? z),
      };
    });
    const fc = from.flows.consolidated;
    const tc = to.flows.consolidated;
    return {
      balances,
      flows: {
        byCurrency,
        consolidated: {
          income: subtract(tc.income, fc.income),
          expense: subtract(tc.expense, fc.expense),
          savings: subtract(tc.savings, fc.savings),
        },
      },
      netWorth: { delta: subtract(to.netWorth.amount, from.netWorth.amount) },
    };
  },
} as const;

export const KPIS = ['INCOME', 'EXPENSE', 'SAVINGS', 'SAVINGS_RATE', 'NET_WORTH'] as const;
export type Kpi = (typeof KPIS)[number];

export interface KpiVariation {
  readonly kpi: Kpi;
  /** Dinero en la moneda base; para `SAVINGS_RATE`, puntos porcentuales como texto decimal (`null` sin tasa). */
  readonly absolute: MoneyValue | string | null;
  /** Variación relativa con un decimal (HALF_EVEN); `null` si el valor anterior es 0 o no hay base. */
  readonly percentage: string | null;
}

const pct = (current: Decimal, previous: Decimal): string | null =>
  previous.isZero()
    ? null
    : current
        .minus(previous)
        .dividedBy(previous.abs())
        .times(100)
        .toDecimalPlaces(1, 6 /* ROUND_HALF_EVEN */)
        .toFixed(1);

/** Variación (FR-PLANNING-007) de los KPIs del snapshot respecto al vigente del periodo inmediatamente anterior. */
export const PeriodVariation = {
  compare(current: CloseSnapshotContent, previous: CloseSnapshotContent): KpiVariation[] {
    const c = current.flows.consolidated;
    const p = previous.flows.consolidated;
    const money = (kpi: Kpi, cur: MoneyValue, prev: MoneyValue): KpiVariation => ({
      kpi,
      absolute: subtract(cur, prev),
      percentage: pct(dec(cur.amount), dec(prev.amount)),
    });
    const rate: KpiVariation =
      c.savingsRate === null || p.savingsRate === null
        ? { kpi: 'SAVINGS_RATE', absolute: null, percentage: null }
        : {
            kpi: 'SAVINGS_RATE',
            absolute: dec(c.savingsRate).minus(p.savingsRate).toFixed(1),
            percentage: pct(dec(c.savingsRate), dec(p.savingsRate)),
          };
    return [
      money('INCOME', c.income, p.income),
      money('EXPENSE', c.expense, p.expense),
      money('SAVINGS', c.savings, p.savings),
      rate,
      money('NET_WORTH', current.netWorth.amount, previous.netWorth.amount),
    ];
  },
} as const;
