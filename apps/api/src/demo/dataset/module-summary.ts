import { dec } from '@pf/shared-kernel';
import { buildDemoOracle, buildDemoPlan, summarizeDemoPlan, toDecimal, DEMO_MANIFEST } from './demo-plan.js';
import type { DemoCurrency } from './demo-plan.js';
import type { LoanKey } from './module-ops.js';
import { kantutaFigures, type StatementStatus } from './plan-modules/cards.js';
import { subscriptionCosts } from './plan-modules/commitments.js';
import { loanDefinitions, loanFigures } from './plan-modules/loans.js';

/**
 * Resumen de referencia por módulo del dataset Demo v2 (design.md decisiones 5, 8 y 9): lo que el plan calcula con sus
 * propios cálculos para cualquier ancla (`structuralOf`) y, con la ancla fija 2026-09-30, las cifras exactas del bloque
 * `modules` de `golden-summary.json`. El cargador lo compara contra lo que devuelven los contextos.
 */

const SCALE: Readonly<Record<DemoCurrency, number>> = { BOB: 2, USD: 2, USDT: 6, BTC: 8 };
const minorToDecimal = (minor: bigint, currency: DemoCurrency = 'BOB') => toDecimal({ minor, currency });

/** Tasas de cierre del dataset (decisión 7). */
export const CLOSING_RATES = { USD: '7.00', USDT: '6.95' } as const;

interface StatementSummary {
  readonly status: StatementStatus;
  readonly billed: string;
  readonly minimum: string;
  readonly pending: string;
}

export interface ModuleSummary {
  readonly subscriptions: {
    readonly count: number;
    readonly active: number;
    readonly trial: number;
    readonly paused: number;
    readonly cancelled: number;
    readonly monthlyBase: string;
    readonly yearlyBase: string;
    readonly trialMonthlyBase: string;
  };
  /** Ocurrencias atrasadas al llegar a la ancla: definiciones recurrentes sin resolver y cuotas de préstamo en mora. */
  readonly overdueOccurrences: { readonly recurring: number; readonly loanInstallments: number };
  readonly loans: Readonly<
    Record<
      LoanKey,
      {
        readonly status: 'ACTIVE' | 'PAID_OFF';
        readonly paid: number;
        readonly overdue: number;
        readonly outstanding: string;
        readonly scheduleVersion: number;
        readonly nextInstallmentNo: number | null;
        readonly nextDue: string | null;
        readonly lastDue: string;
        readonly interestInAnchorYear: string;
      }
    >
  >;
  readonly cards: {
    readonly kantuta: {
      readonly bobK1: StatementSummary;
      readonly usdK1: StatementSummary;
      readonly bobK2: StatementSummary;
      readonly usdK2: StatementSummary;
      readonly futureCharges: readonly { readonly due: string; readonly amount: string }[];
    };
    readonly andina: {
      readonly statements: number;
      readonly last: { readonly closing: string; readonly due: string; readonly billed: string };
      readonly payments: number;
    };
  };
  readonly goals: {
    readonly emergencyContributions: number;
    readonly emergencySaved: string;
    readonly reserved: { readonly travel: string; readonly laptop: string; readonly gifts: string };
  };
}

export function summarizeModules(anchor: string = DEMO_MANIFEST.anchorDate): ModuleSummary {
  const oracle = buildDemoOracle(anchor);
  const subs = oracle.subscriptions;
  const count = (status: string) => subs.filter((s) => s.status === status).length;
  const active = subs.filter((s) => s.status === 'active');
  const costs = subscriptionCosts(
    active,
    subs.filter((s) => s.status === 'trial'),
    CLOSING_RATES,
  );
  const loans = Object.fromEntries(
    loanDefinitions(anchor).map((def) => {
      const f = loanFigures(def, anchor);
      return [
        def.key,
        {
          status: f.status,
          paid: f.paid,
          overdue: f.overdue,
          outstanding: f.outstanding,
          scheduleVersion: f.scheduleVersion,
          nextInstallmentNo: f.nextInstallmentNo,
          nextDue: f.nextDue,
          lastDue: f.lastDue,
          interestInAnchorYear: f.interestInAnchorYear,
        },
      ];
    }),
  ) as ModuleSummary['loans'];
  const k = kantutaFigures(anchor);
  const stmt = (s: (typeof k)['bobK1']): StatementSummary => ({
    status: s.status,
    billed: minorToDecimal(s.billed),
    minimum: minorToDecimal(s.minimum),
    pending: minorToDecimal(s.pending),
  });
  const usd = (s: (typeof k)['usdK1']): StatementSummary => ({
    status: s.status,
    billed: minorToDecimal(s.billed, 'USD'),
    minimum: minorToDecimal(s.minimum, 'USD'),
    pending: minorToDecimal(s.pending, 'USD'),
  });
  const lastAndina = oracle.andina.at(-1);
  if (!lastAndina) throw new Error('la tarjeta Andina no tiene estados de cuenta');
  const contributions = oracle.emergencyContributions.length;
  return {
    subscriptions: {
      count: subs.length,
      active: count('active'),
      trial: count('trial'),
      paused: count('paused'),
      cancelled: count('cancelled'),
      monthlyBase: costs.monthly,
      yearlyBase: costs.yearly,
      trialMonthlyBase: costs.trialMonthly,
    },
    overdueOccurrences: {
      recurring: oracle.unresolved.length,
      loanInstallments: Object.values(loans).reduce((sum, l) => sum + l.overdue, 0),
    },
    loans,
    cards: {
      kantuta: {
        bobK1: stmt(k.bobK1),
        usdK1: usd(k.usdK1),
        bobK2: stmt(k.bobK2),
        usdK2: usd(k.usdK2),
        futureCharges: k.futureCharges.map((c) => ({ due: c.due, amount: minorToDecimal(c.amount) })),
      },
      andina: {
        statements: oracle.andina.length,
        last: {
          closing: lastAndina.closing,
          due: lastAndina.due,
          billed: minorToDecimal(lastAndina.billed),
        },
        payments: oracle.andina.filter((s) => s.payment !== null).length,
      },
    },
    goals: {
      emergencyContributions: contributions,
      emergencySaved: minorToDecimal(BigInt(contributions) * 150_000n),
      reserved: {
        travel: minorToDecimal(oracle.reserved.travel, 'USD'),
        laptop: minorToDecimal(oracle.reserved.laptop),
        gifts: minorToDecimal(oracle.reserved.gifts),
      },
    },
  };
}

/** Parte del resumen que no depende de la ancla (estados y conteos): se conserva con cualquier fecha ancla. */
export function structuralOf(summary: ModuleSummary) {
  return {
    subscriptions: {
      count: summary.subscriptions.count,
      active: summary.subscriptions.active,
      trial: summary.subscriptions.trial,
      paused: summary.subscriptions.paused,
      cancelled: summary.subscriptions.cancelled,
    },
    overdueOccurrences: summary.overdueOccurrences,
    loans: Object.fromEntries(
      Object.entries(summary.loans).map(([key, l]) => [
        key,
        {
          status: l.status,
          paid: l.paid,
          overdue: l.overdue > 0 ? 'some' : 'none',
          outstanding: l.outstanding,
          scheduleVersion: l.scheduleVersion,
        },
      ]),
    ),
    cards: {
      kantuta: {
        bobK1: summary.cards.kantuta.bobK1.status,
        usdK1: summary.cards.kantuta.usdK1.status,
        bobK2: summary.cards.kantuta.bobK2.status,
        usdK2: summary.cards.kantuta.usdK2.status,
      },
      andinaLastIsOpenToPay: summary.cards.andina.last.billed !== '0.00',
    },
    goals: {
      emergencyContributions: summary.goals.emergencyContributions,
      reserved: summary.goals.reserved,
    },
  };
}

/** Cifras de referencia del resumen de deudas y del disponible para gastar (design.md decisión 8; ancla fija). */
export interface ReferenceFigures {
  readonly debtSummary: {
    readonly totalBob: string;
    readonly totalUsd: string;
    readonly consolidatedBob: string;
    readonly interestBob: string;
    readonly interestUsd: string;
    readonly debtFree: string;
  };
  readonly spendable: {
    readonly committedBob: string;
    readonly reservedBob: string;
    readonly reservedUsd: string;
    readonly plannedPendingUsd: string;
  };
}

export function referenceFigures(anchor: string = DEMO_MANIFEST.anchorDate): ReferenceFigures {
  const balances = summarizeDemoPlan(buildDemoPlan(anchor)).balances;
  const modules = summarizeModules(anchor);
  const bobDebt = [
    balances.loan_vehicular,
    balances.loan_consumo,
    balances.kantuta_bob,
    balances.card,
  ].reduce((sum, v) => sum.plus(v), dec('0'));
  const usdDebt = dec(balances.loan_educativo).plus(balances.kantuta_usd);
  const interest = (currency: DemoCurrency) =>
    Object.values(loanDefinitions(anchor))
      .filter((d) => d.currency === currency)
      .reduce((sum, d) => sum.plus(loanFigures(d, anchor).interestInAnchorYear), dec('0'));
  const committed = Object.entries(modules.loans)
    .filter(([, l]) => l.overdue > 0)
    .reduce(
      (sum, [key]) =>
        sum.plus(
          loanDefinitions(anchor)
            .filter((d) => d.key === key)
            .reduce(
              (acc, d) =>
                acc.plus(loanFigures(d, anchor).overdueAmounts.reduce((a, v) => a.plus(v), dec('0'))),
              dec('0'),
            ),
        ),
      dec('0'),
    )
    .plus('199.00');
  const scale = SCALE.BOB;
  return {
    debtSummary: {
      totalBob: bobDebt.toFixed(scale),
      totalUsd: usdDebt.toFixed(2),
      consolidatedBob: bobDebt.plus(usdDebt.times(CLOSING_RATES.USD)).toFixed(scale),
      interestBob: interest('BOB').toFixed(scale),
      interestUsd: interest('USD').toFixed(2),
      debtFree: loanDefinitions(anchor)
        .map((d) => loanFigures(d, anchor).lastDue)
        .sort()
        .at(-1) as string,
    },
    spendable: {
      committedBob: committed.toFixed(scale),
      reservedBob: dec(modules.goals.emergencySaved)
        .plus(modules.goals.reserved.laptop)
        .plus(modules.goals.reserved.gifts)
        .toFixed(scale),
      reservedUsd: modules.goals.reserved.travel,
      plannedPendingUsd: dec('150.00').minus(dec('50.00')).toFixed(2),
    },
  };
}
