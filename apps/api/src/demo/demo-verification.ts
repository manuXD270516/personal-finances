import { kantutaPlan } from './dataset/plan-modules/cards.js';
import type { ModuleSummary } from './dataset/module-summary.js';
import type { GoalKey, LoanKey } from './dataset/module-ops.js';
import { DemoModuleError } from './demo-module-executor.js';
import type { financeRuntimes } from '../identity/identity-wiring.js';

type Runtimes = ReturnType<typeof financeRuntimes>;

const mismatch = (what: string, expected: unknown, actual: unknown): never => {
  throw new DemoModuleError(
    'DEMO_GOLDEN_MISMATCH',
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};
const same = (what: string, expected: unknown, actual: unknown): void => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatch(what, expected, actual);
};

/**
 * Verificación final por módulo (design.md decisión 9): lo que el plan calcula con sus propios cálculos
 * (`summarizeModules`, para cualquier ancla) contra lo que devuelven las consultas públicas de COMMITMENTS, DEBT y
 * GOALS con el reloj simulado al final del día A. Lo que dependen de los consumidores asíncronos del outbox (cargos de
 * suscripciones, aportes recurrentes de metas) NO se verifica aquí: converge después de `READY` y lo cubren las
 * pruebas. Una discrepancia hace fallar la carga.
 */
export async function verifyModules(input: {
  readonly r: Runtimes;
  readonly ws: string;
  readonly anchor: string;
  readonly summary: ModuleSummary;
  readonly cards: ReadonlyMap<string, string>;
  readonly loans: ReadonlyMap<LoanKey, string>;
  readonly goals: ReadonlyMap<GoalKey, string>;
}): Promise<void> {
  const { r, ws, summary } = input;

  // ── Suscripciones: estados y costo mensual/anual a las tasas de cierre.
  const subs = await r.commitments.subscriptionQueries.list(ws, {
    statuses: ['ACTIVE', 'TRIAL', 'PAUSED', 'CANCELLED'],
  } as never);
  const count = (status: string) => subs.filter((s) => s.status === status).length;
  same(
    'subscriptions by status',
    {
      count: summary.subscriptions.count,
      active: summary.subscriptions.active,
      trial: summary.subscriptions.trial,
      paused: summary.subscriptions.paused,
      cancelled: summary.subscriptions.cancelled,
    },
    {
      count: subs.length,
      active: count('ACTIVE'),
      trial: count('TRIAL'),
      paused: count('PAUSED'),
      cancelled: count('CANCELLED'),
    },
  );
  const cost = await r.commitments.subscriptionQueries.costSummary(ws);
  same(
    'subscription cost',
    [
      summary.subscriptions.monthlyBase,
      summary.subscriptions.yearlyBase,
      summary.subscriptions.trialMonthlyBase,
    ],
    [cost.totals.monthly.amount, cost.totals.annual.amount, cost.afterTrial.monthly.amount],
  );

  // ── Ocurrencias atrasadas: una de las definiciones recurrentes y las cuotas de préstamo en mora.
  const overdue = await r.commitments.queries.listOccurrences(ws, { statuses: ['OVERDUE'], limit: 100 });
  same(
    'overdue occurrences',
    summary.overdueOccurrences.recurring + summary.overdueOccurrences.loanInstallments,
    overdue.length,
  );

  // ── Préstamos: estado, principal pendiente, mora y versión del cronograma.
  for (const [key, id] of input.loans) {
    const expected = summary.loans[key];
    const loan = await r.debt.queries.get(ws, id);
    same(
      `loan ${key}`,
      [expected.status, expected.outstanding, expected.overdue, expected.scheduleVersion],
      [
        loan.status,
        loan.outstandingPrincipal?.amount,
        loan.overdueInstallments.length,
        loan.currentScheduleVersion,
      ],
    );
  }

  // ── Tarjetas: estados de cuenta de "Tarjeta Kantuta Demo" (con su estado y mínimo) y el último de la Andina.
  const kantuta = kantutaPlan(input.anchor);
  const kantutaId = input.cards.get('kantuta');
  if (kantutaId) {
    const statements = await r.cards.queries.listStatements(ws, kantutaId);
    const expected = summary.cards.kantuta;
    const at = (currency: string, closing: string) =>
      statements.find((s) => s.currency === currency && s.closingDate === closing);
    const rows = [
      ['BOB', kantuta.k1, expected.bobK1],
      ['USD', kantuta.k1, expected.usdK1],
      ['BOB', kantuta.k2, expected.bobK2],
      ['USD', kantuta.k2, expected.usdK2],
    ] as const;
    for (const [currency, closing, want] of rows) {
      const got = at(currency, closing);
      same(
        `Kantuta ${currency} ${closing}`,
        [want.status, want.billed, want.minimum],
        [got?.status, got?.issued?.billedBalance.amount, got?.minimumDue.amount],
      );
    }
    const charges = await r.cards.queries.getFutureCharges(ws, kantutaId, 8);
    same(
      'Kantuta future charges',
      expected.futureCharges,
      charges.map((c) => ({ due: c.dueDate, amount: c.total.amount })),
    );
  }
  const andinaId = input.cards.get('andina');
  if (andinaId) {
    const statements = await r.cards.queries.listStatements(ws, andinaId);
    const issued = statements.filter((s) => s.id !== null);
    const last = issued[0];
    same(
      'Andina last statement',
      [summary.cards.andina.last.closing, summary.cards.andina.last.due, summary.cards.andina.last.billed],
      [last?.closingDate, last?.dueDate, last?.issued?.billedBalance.amount],
    );
  }

  // ── Metas: reservas (movimientos síncronos) y estado; los aportes recurrentes del fondo llegan por el consumidor.
  const reserved = summary.goals.reserved;
  const wanted: [GoalKey, string][] = [
    ['travel', reserved.travel],
    ['laptop', reserved.laptop],
    ['gifts', reserved.gifts],
  ];
  for (const [key, amount] of wanted) {
    const id = input.goals.get(key);
    if (!id) continue;
    const goal = await r.goals.queries.get(ws, id);
    same(`goal ${key}`, amount, goal.progress.total.amount);
    if (key === 'laptop') same('goal laptop status', 'ACHIEVED', goal.status);
  }
}
