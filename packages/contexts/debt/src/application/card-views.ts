import type { Money } from '@pf/shared-kernel';
import type {
  CardAccountState,
  CardInstallmentPlanState,
  CreditCardState,
  CycleFigures,
  MinimumPaymentRuleSpec,
} from '../domain/index.js';
import type { AccountView, CycleView, UtilizationScope } from './card-engine.js';
import type { StatementRecord } from './card-ports.js';

/** Vistas de la API de tarjetas (openspec add-credit-cards § Contratos): montos como `{amount, currency}`. */
export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

export interface FiguresView {
  readonly previousBalance: MoneyView;
  readonly purchases: MoneyView;
  readonly refunds: MoneyView;
  readonly payments: MoneyView;
  readonly otherNet: MoneyView;
  readonly closingBalance: MoneyView;
  readonly unbilledInstallments: MoneyView;
  readonly billedBalance: MoneyView;
  readonly minimumDue: MoneyView;
  readonly noInterestPayment: MoneyView;
  readonly creditBalance: MoneyView;
}

export interface CardStatementView {
  /** `null` si el ciclo se calcula en lectura y no se emitió (ciclo abierto o anterior al registro). */
  readonly id: string | null;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly currency: string;
  readonly cycleStart: string;
  readonly closingDate: string;
  readonly dueDate: string;
  readonly status: string;
  readonly issuedAt: string | null;
  /** Cifras congeladas al emitir. */
  readonly issued: FiguresView | null;
  /** Cifras recalculadas hoy con el ledger. */
  readonly current: FiguresView;
  /** `current − issued` de las cifras que cambian; `null` si no hay estado emitido. */
  readonly difference: FiguresView | null;
  readonly reported: {
    readonly billedBalance: MoneyView | null;
    readonly minimumDue: MoneyView | null;
  } | null;
  readonly reportedDifference: MoneyView | null;
  readonly noInterestPayment: MoneyView;
  readonly minimumDue: MoneyView;
  readonly remainingNoInterest: MoneyView;
  readonly remainingMinimum: MoneyView;
  readonly consistent: boolean;
  readonly version: number | null;
}

export interface CardUtilizationView {
  readonly scope: 'SHARED' | 'ACCOUNT';
  readonly accountId: string | null;
  readonly limit: MoneyView;
  readonly used: MoneyView | null;
  readonly available: MoneyView | null;
  /** Porcentaje con 2 decimales HALF_EVEN; `null` si no puede calcularse (falta de tasa). */
  readonly utilization: string | null;
  readonly overdrawn: boolean;
  readonly missingRates: readonly string[];
}

export interface CardAccountView {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly creditLimit: MoneyView | null;
  readonly minimumRule: MinimumRuleView;
  readonly balance: MoneyView;
  readonly pendingPurchases: MoneyView;
  readonly creditUsed: MoneyView;
  readonly utilization: CardUtilizationView | null;
  readonly openCycle: CardStatementView;
  readonly lastStatement: CardStatementView | null;
  /** Próximo vencimiento con algo por pagar (estado emitido con faltante, o el ciclo abierto). */
  readonly nextDueDate: string;
  readonly paymentPlan: CardPaymentPlanView | null;
}

export type MinimumRuleView =
  | { readonly type: 'PERCENT'; readonly percent: string; readonly floor: MoneyView | null }
  | { readonly type: 'FIXED'; readonly amount: MoneyView };

export interface CardPaymentPlanView {
  readonly sourceAccountId: string;
  readonly policy: string;
  readonly materialization: {
    readonly mode: string;
    readonly autoCreateStatus: string | null;
    readonly leadDays: number | null;
  };
  readonly definitionId: string;
  readonly enabledAt: string;
}

export interface CreditCardView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly statementDay: number;
  readonly dueDay: number;
  readonly dueWeekendAdjustment: string;
  readonly annualRate: string | null;
  readonly limitMode: string;
  readonly sharedLimit: MoneyView | null;
  readonly utilizationThresholds: readonly string[];
  readonly reminderDays: number;
  readonly accounts: readonly CardAccountView[];
  /** Utilización por ámbito (una por cuenta con límite separado, o la compartida). */
  readonly utilization: readonly CardUtilizationView[];
  readonly paymentPlanConflicts?: readonly {
    readonly accountId: string;
    readonly conflictingDefinitions: readonly { definitionId: string; name: string }[];
  }[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const m = (v: Money): MoneyView => v.toJSON();

export function figuresView(f: Omit<CycleFigures, 'currency' | 'consistent'>): FiguresView {
  return {
    previousBalance: m(f.previousBalance),
    purchases: m(f.purchases),
    refunds: m(f.refunds),
    payments: m(f.payments),
    otherNet: m(f.otherNet),
    closingBalance: m(f.closingBalance),
    unbilledInstallments: m(f.unbilledInstallments),
    billedBalance: m(f.billedBalance),
    minimumDue: m(f.minimumDue),
    noInterestPayment: m(f.noInterestPayment),
    creditBalance: m(f.creditBalance),
  };
}

export function minimumRuleView(rule: MinimumPaymentRuleSpec, currency: string): MinimumRuleView {
  return rule.type === 'PERCENT'
    ? {
        type: 'PERCENT',
        percent: rule.percent,
        floor: rule.floor === null ? null : { amount: rule.floor, currency },
      }
    : { type: 'FIXED', amount: { amount: rule.amount, currency } };
}

export function statementView(
  accountView: AccountView,
  cv: CycleView,
  diff: FiguresView | null,
  record: StatementRecord | null = cv.record,
): CardStatementView {
  const cur = accountView.currency;
  const standing = cv.standing;
  const zero = { amount: (0).toFixed(cur.scale), currency: cur.code };
  return {
    id: record?.id ?? null,
    cardAccountId: accountView.account.id,
    accountId: accountView.account.accountId,
    currency: cur.code,
    cycleStart: cv.cycle.start.toString(),
    closingDate: cv.cycle.closing.toString(),
    dueDate: cv.cycle.dueDate.toString(),
    status: cv.status,
    issuedAt: record?.issuedAt ?? null,
    issued: cv.issued ? figuresView(cv.issued) : null,
    current: figuresView(cv.current),
    difference: diff,
    reported: record
      ? {
          billedBalance:
            record.reportedBilledBalance === null
              ? null
              : { amount: record.reportedBilledBalance, currency: cur.code },
          minimumDue:
            record.reportedMinimumDue === null
              ? null
              : { amount: record.reportedMinimumDue, currency: cur.code },
        }
      : null,
    reportedDifference: standing?.reportedDifference ? m(standing.reportedDifference) : null,
    noInterestPayment: standing ? m(standing.noInterestPayment) : m(cv.current.noInterestPayment),
    minimumDue: standing ? m(standing.minimumDue) : m(cv.current.minimumDue),
    remainingNoInterest: standing ? m(standing.remainingNoInterest) : zero,
    remainingMinimum: standing ? m(standing.remainingMinimum) : zero,
    consistent: cv.current.consistent,
    version: record?.version ?? null,
  };
}

export function utilizationView(scope: UtilizationScope): CardUtilizationView {
  return {
    scope: scope.scope,
    accountId: scope.accountId,
    limit: m(scope.limit),
    used: scope.used ? m(scope.used) : null,
    available: scope.utilization ? m(scope.utilization.available) : null,
    utilization: scope.utilization?.display ?? null,
    overdrawn: scope.utilization?.overdrawn ?? false,
    missingRates: scope.missingRates,
  };
}

function planView(account: CardAccountState): CardPaymentPlanView | null {
  const p = account.paymentPlan;
  return p
    ? {
        sourceAccountId: p.sourceAccountId,
        policy: p.policy,
        materialization: { ...p.materialization },
        definitionId: p.definitionId,
        enabledAt: p.enabledAt,
      }
    : null;
}

/** Próximo vencimiento relevante: el del estado emitido más antiguo con faltante, o el del ciclo abierto. */
function nextDue(view: AccountView): string {
  const pending = view.cycles.filter((c) => !c.open && c.standing?.remainingNoInterest.isPositive());
  const first = pending[0];
  return first ? first.cycle.dueDate.toString() : (view.cycles.at(-1) as CycleView).cycle.dueDate.toString();
}

export function cardView(
  state: CreditCardState,
  views: readonly AccountView[],
  scopes: readonly UtilizationScope[],
  conflicts?: CreditCardView['paymentPlanConflicts'],
): CreditCardView {
  const accounts = views.map((v): CardAccountView => {
    const scope =
      scopes.find((s) => s.scope === 'ACCOUNT' && s.scopeKey === v.account.id) ??
      (state.limitMode === 'SHARED' ? scopes[0] : undefined);
    const open = v.cycles.at(-1) as CycleView;
    const closed = v.cycles.filter((c) => !c.open && c.record);
    const last = closed.at(-1);
    const sharedNote = scope && scope.scope === 'SHARED' ? utilizationView(scope) : null;
    return {
      id: v.account.id,
      accountId: v.account.accountId,
      currency: v.currency.code,
      creditLimit:
        v.account.creditLimit === null ? null : { amount: v.account.creditLimit, currency: v.currency.code },
      minimumRule: minimumRuleView(v.account.minimumRule, v.currency.code),
      balance: m(v.balance),
      pendingPurchases: m(v.pendingOut),
      creditUsed: m(v.used),
      utilization: scope && scope.scope === 'ACCOUNT' ? utilizationView(scope) : sharedNote,
      openCycle: statementView(v, open, null, null),
      lastStatement: last ? statementView(v, last, null) : null,
      nextDueDate: nextDue(v),
      paymentPlan: planView(v.account),
    };
  });
  return {
    id: state.id,
    name: state.name,
    status: state.status,
    ...(() => {
      const t = state.terms.at(-1) as CreditCardState['terms'][number];
      return { statementDay: t.statementDay, dueDay: t.dueDay, dueWeekendAdjustment: t.dueWeekendAdjustment };
    })(),
    annualRate: state.annualRate,
    limitMode: state.limitMode,
    sharedLimit: state.sharedLimit
      ? { amount: state.sharedLimit.amount, currency: state.sharedLimit.currency }
      : null,
    utilizationThresholds: state.utilizationThresholds,
    reminderDays: state.reminderDays,
    accounts,
    utilization: scopes.map(utilizationView),
    ...(conflicts && conflicts.length > 0 ? { paymentPlanConflicts: conflicts } : {}),
    version: state.version,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export interface InstallmentPlanView {
  readonly id: string;
  readonly cardAccountId: string;
  readonly purchaseTransactionId: string;
  readonly purchaseDate: string;
  readonly principal: MoneyView;
  readonly installmentCount: number;
  readonly annualRate: string;
  readonly startCycle: string;
  readonly status: string;
  readonly cancelReason: string | null;
  readonly installments: readonly {
    readonly n: number;
    readonly billingClosingDate: string;
    readonly dueDate: string;
    readonly principal: MoneyView;
    readonly interest: MoneyView;
    readonly total: MoneyView;
  }[];
  readonly version: number;
}

export function installmentPlanView(s: CardInstallmentPlanState): InstallmentPlanView {
  const money = (amount: string): MoneyView => ({ amount, currency: s.currency });
  return {
    id: s.id,
    cardAccountId: s.cardAccountId,
    purchaseTransactionId: s.purchaseTransactionId,
    purchaseDate: s.purchaseDate,
    principal: money(s.principal),
    installmentCount: s.installmentCount,
    annualRate: s.annualRate,
    startCycle: s.startCycle,
    status: s.status,
    cancelReason: s.cancelReason,
    installments: s.installments.map((i) => ({
      n: i.n,
      billingClosingDate: i.billingClosingDate,
      dueDate: i.dueDate,
      principal: money(i.principal),
      interest: money(i.interest),
      total: money(i.total),
    })),
    version: s.version,
  };
}
