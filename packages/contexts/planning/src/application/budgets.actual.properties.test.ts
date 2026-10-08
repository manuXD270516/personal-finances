import { Instant, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BudgetQueries } from './budget.queries.js';
import { BudgetsService } from './budgets.service.js';
import { InMemoryBudgets } from './testing/in-memory-budgets.js';

const BOB = currency('BOB', 2);
const W = '0190a000-0000-7000-8000-00000000a001';
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const G = id(100);
// Árbol: ROOT -> CHILD -> LEAF y OTHER (aparte).
const ROOT = id(1);
const CHILD = id(2);
const LEAF = id(3);
const OTHER = id(4);
const CATEGORIES = [ROOT, CHILD, LEAF, OTHER] as const;
const UNDER_ROOT = new Set([ROOT, CHILD, LEAF]);

type Op =
  | { kind: 'EXPENSE'; category: number; cents: number; day: number }
  | { kind: 'REFUND'; of: number; cents: number; day: number }
  | { kind: 'VOID'; of: number }
  | { kind: 'RECATEGORIZE'; of: number; category: number }
  | { kind: 'PENDING'; category: number; cents: number; day: number };

const day = fc.integer({ min: 1, max: 30 });
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('EXPENSE' as const),
    category: fc.nat(3),
    cents: fc.integer({ min: 1, max: 500_000 }),
    day,
  }),
  fc.record({
    kind: fc.constant('REFUND' as const),
    of: fc.nat(20),
    cents: fc.integer({ min: 1, max: 100_000 }),
    day,
  }),
  fc.record({ kind: fc.constant('VOID' as const), of: fc.nat(20) }),
  fc.record({ kind: fc.constant('RECATEGORIZE' as const), of: fc.nat(20), category: fc.nat(3) }),
  fc.record({
    kind: fc.constant('PENDING' as const),
    category: fc.nat(3),
    cents: fc.integer({ min: 1, max: 500_000 }),
    day,
  }),
);

interface Live {
  readonly date: string;
  category: string;
  readonly cents: number;
  status: 'POSTED' | 'PENDING' | 'VOIDED';
  readonly sign: 1 | -1;
}

const date = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const cents = (n: number) => Money.ofMinorUnits(BigInt(n), BOB).toFixed();

/** Aplica la historia de eventos y devuelve las porciones vigentes (el modelo de referencia del oráculo). */
function replay(ops: readonly Op[]): Live[] {
  const live: Live[] = [];
  for (const o of ops) {
    if (o.kind === 'EXPENSE') {
      live.push({
        date: date(o.day),
        category: CATEGORIES[o.category]!,
        cents: o.cents,
        status: 'POSTED',
        sign: 1,
      });
    } else if (o.kind === 'PENDING') {
      live.push({
        date: date(o.day),
        category: CATEGORIES[o.category]!,
        cents: o.cents,
        status: 'PENDING',
        sign: 1,
      });
    } else if (o.kind === 'REFUND') {
      const target = live[o.of % Math.max(live.length, 1)];
      if (target && target.sign === 1 && target.status === 'POSTED') {
        live.push({
          date: date(o.day),
          category: target.category,
          cents: o.cents,
          status: 'POSTED',
          sign: -1,
        });
      }
    } else if (o.kind === 'VOID') {
      const target = live[o.of % Math.max(live.length, 1)];
      if (target) target.status = 'VOIDED';
    } else {
      const target = live[o.of % Math.max(live.length, 1)];
      if (target && target.status !== 'VOIDED') target.category = CATEGORIES[o.category]!;
    }
  }
  return live;
}

describe('TC-PLANNING-ACTUAL-007 — el gastado es la suma de los splits posteados vigentes (INV-034)', () => {
  it('[TC-PLANNING-ACTUAL-007] PBT: para toda historia de gastos, reembolsos, anulaciones y recategorizaciones, gastado(categoría) = Σ de sus porciones posteadas y de sus subcategorías', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 40 }), async (ops) => {
        const env = new InMemoryBudgets();
        env.mem.workspace(W);
        env.mem.clock.set(Instant.parse('2026-11-30T15:00:00Z'));
        const node = (categoryId: string, parentId: string | null) => ({
          categoryId,
          name: categoryId,
          kind: 'EXPENSE' as const,
          groupId: G,
          parentId,
          systemCode: null,
          archived: false,
        });
        env.tree = {
          groups: [{ groupId: G, name: 'G', kind: 'EXPENSE', archived: false }],
          categories: [node(ROOT, null), node(CHILD, ROOT), node(LEAF, CHILD), node(OTHER, null)],
          tags: [],
        };
        const nov = env.mem.seed(W, '2026-11', 'ACTIVE');
        const deps = env.deps();
        const service = new BudgetsService(deps);
        const queries = new BudgetQueries(deps);
        const budget = await service.createBudget({ workspaceId: W, periodId: nov.id });
        for (const c of [ROOT, OTHER]) {
          await service.addLine({
            workspaceId: W,
            budgetId: budget.id,
            target: { kind: 'CATEGORY', id: c },
            spec: { kind: 'MAXIMUM', planned: { amount: '1000000.00', currency: 'BOB' } },
          });
        }
        // Lo que devuelve SummarizeNominalFlows: porciones POSTED vigentes agregadas por fecha y categoría (neto de reembolsos).
        const live = replay(ops).filter((s) => s.status === 'POSTED');
        const grouped = new Map<string, number>();
        for (const s of live) {
          const key = `${s.date}|${s.category}`;
          grouped.set(key, (grouped.get(key) ?? 0) + s.sign * s.cents);
        }
        for (const [key, total] of grouped) {
          const [d, category] = key.split('|') as [string, string];
          env.flow(d, 'EXPENSE', category, (total < 0 ? '-' : '') + cents(Math.abs(total)));
        }
        const view = await queries.getBudget(W, budget.id);
        const actualOf = (categoryId: string) =>
          view.lines.find((l) => l.target.id === categoryId)!.progress.actual.amount;
        const sum = (include: (c: string) => boolean) =>
          live.filter((s) => include(s.category)).reduce((acc, s) => acc + s.sign * s.cents, 0);
        const money = (n: number) => (n < 0 ? '-' : '') + cents(Math.abs(n));
        expect(actualOf(ROOT)).toBe(money(sum((c) => UNDER_ROOT.has(c as never))));
        expect(actualOf(OTHER)).toBe(money(sum((c) => c === OTHER)));
        // Sin doble conteo: el gastado total del plan es la suma de las porciones de ambas líneas.
        expect(view.totals.actual.amount).toBe(money(sum(() => true)));
      }),
      { numRuns: 200 },
    );
  });
});
