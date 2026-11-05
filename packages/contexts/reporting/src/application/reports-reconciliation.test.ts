import { Instant } from '@pf/shared-kernel';
import { describeMismatch } from '../domain/index.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FinancialReportsService } from './financial-reports.exports.js';
import { ReportsReconciliation } from './reports-reconciliation.js';
import { InMemoryFinancialReports } from './testing/in-memory-reports.js';

// Reconciliación reporte↔ledger sobre ledgers generados al azar (openspec add-financial-reports, TC-REPORTING-REPORTS-027,
// nivel 1 de la batería de design.md decisión 11): ingresos, gastos, reembolsos, transferencias, plazo fijo, pagos de
// tarjeta y de cuota de préstamo, conversiones con comisión, en BOB y USD, con tasas aleatorias > 0.
const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';
const BANCO = '0190a000-0000-7000-8000-0000000000b1';
const EFECTIVO = '0190a000-0000-7000-8000-0000000000b2';
const TARJETA = '0190a000-0000-7000-8000-0000000000b3';
const PLAZO = '0190a000-0000-7000-8000-0000000000b4';
const USDACC = '0190a000-0000-7000-8000-0000000000b5';
const CATS = [
  '0190a000-0000-7000-8000-0000000000c1',
  '0190a000-0000-7000-8000-0000000000c2',
  '0190a000-0000-7000-8000-0000000000c3',
];
const GROUP = '0190a000-0000-7000-8000-0000000000d1';
const INCOME_CAT = '0190a000-0000-7000-8000-0000000000c9';

type Op =
  | { kind: 'income' | 'expense' | 'refund'; day: number; cents: number; ccy: 'BOB' | 'USD'; cat: number }
  | {
      kind: 'transfer' | 'plazo' | 'card' | 'loan' | 'conversion';
      day: number;
      cents: number;
      extra: number;
      ccy: 'BOB' | 'USD';
      cat: number;
    };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constantFrom('income', 'expense', 'refund'),
    day: fc.integer({ min: 0, max: 91 }),
    cents: fc.integer({ min: 1, max: 500_000 }),
    ccy: fc.constantFrom('BOB', 'USD'),
    cat: fc.integer({ min: 0, max: 2 }),
  }) as fc.Arbitrary<Op>,
  fc.record({
    kind: fc.constantFrom('transfer', 'plazo', 'card', 'loan', 'conversion'),
    day: fc.integer({ min: 0, max: 91 }),
    cents: fc.integer({ min: 100, max: 500_000 }),
    extra: fc.integer({ min: 1, max: 99 }),
    ccy: fc.constantFrom('BOB', 'USD'),
    cat: fc.integer({ min: 0, max: 2 }),
  }) as fc.Arbitrary<Op>,
);

const amt = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const neg = (cents: number) => `-${amt(cents)}`;
const dateOf = (day: number) => {
  const d = new Date(Date.UTC(2026, 7, 1 + day));
  return d.toISOString().slice(0, 10);
};

function build(ops: readonly Op[], rateSeed: number): InMemoryFinancialReports {
  const mem = new InMemoryFinancialReports();
  mem.clock.set(Instant.parse('2026-11-15T16:00:00Z'));
  mem.addAccount({ accountId: BANCO, name: 'Banco', type: 'BANK', currency: 'BOB' }, null);
  mem.addAccount({ accountId: EFECTIVO, name: 'Efectivo', type: 'CASH', currency: 'BOB' }, null);
  mem.addAccount({ accountId: TARJETA, name: 'Tarjeta', type: 'CREDIT_CARD', currency: 'BOB' }, null);
  mem.addAccount({ accountId: PLAZO, name: 'Plazo', type: 'INVESTMENT', currency: 'BOB' }, null);
  mem.addAccount({ accountId: USDACC, name: 'Cuenta USD', type: 'BANK', currency: 'USD' }, null);
  mem.tree = {
    groups: [{ groupId: GROUP, name: 'Gastos', kind: 'EXPENSE', archived: false }],
    categories: [
      ...CATS.map((c, i) => ({
        categoryId: c,
        name: `Cat ${i}`,
        kind: 'EXPENSE' as const,
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      })),
      {
        categoryId: INCOME_CAT,
        name: 'Ingreso',
        kind: 'INCOME' as const,
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
    ],
    tags: [],
  };
  mem.firstEntryDate = '2026-08-01';
  // Una tasa USD/BOB por día (> 0) para todo el rango.
  for (let d = -10; d < 100; d += 1) {
    mem.rates.push({
      base: 'USD',
      quote: 'BOB',
      value: (((rateSeed + d * 37) % 1900) / 100 + 1).toFixed(2),
      asOf: `${dateOf(d)}T12:00:00Z`,
    });
  }
  mem.entry('open', '2026-07-31', [
    { account: BANCO, currency: 'BOB', amount: '10000.00' },
    { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '-10000.00' },
  ]);
  let n = 0;
  let split = 0;
  const portion = (
    date: string,
    nature: 'INCOME' | 'EXPENSE',
    cat: string,
    amount: string,
    ccy: string,
    accountId: string,
  ) => {
    split += 1;
    mem.portions.push({
      transactionId: `t${n}`,
      splitId: `0190a000-0000-7000-8000-${String(split).padStart(12, '0')}`,
      businessDate: date,
      nature,
      categoryId: cat,
      accountId,
      counterpartyId: null,
      description: null,
      amount: { amount, currency: ccy },
      tagIds: [],
    });
  };
  for (const op of ops) {
    n += 1;
    const date = dateOf(op.day);
    const acc = op.ccy === 'BOB' ? (op.cents % 2 === 0 ? BANCO : EFECTIVO) : USDACC;
    const c = op.ccy;
    const id = `e${n}`;
    const cat = CATS[op.cat] as string;
    if (op.kind === 'income') {
      mem.entry(
        id,
        date,
        [
          { account: acc, currency: c, amount: amt(op.cents) },
          { account: 'SYSTEM:INCOME', currency: c, amount: neg(op.cents) },
        ],
        `t${n}`,
      );
      portion(date, 'INCOME', INCOME_CAT, amt(op.cents), c, acc);
    } else if (op.kind === 'expense') {
      mem.entry(
        id,
        date,
        [
          { account: acc, currency: c, amount: neg(op.cents) },
          { account: 'SYSTEM:EXPENSE', currency: c, amount: amt(op.cents) },
        ],
        `t${n}`,
      );
      portion(date, 'EXPENSE', cat, amt(op.cents), c, acc);
    } else if (op.kind === 'refund') {
      mem.entry(
        id,
        date,
        [
          { account: acc, currency: c, amount: amt(op.cents) },
          { account: 'SYSTEM:EXPENSE', currency: c, amount: neg(op.cents) },
        ],
        `t${n}`,
      );
      portion(date, 'EXPENSE', cat, neg(op.cents), c, acc);
    } else if (op.kind === 'transfer') {
      const [from, to] = c === 'BOB' ? [BANCO, EFECTIVO] : [USDACC, USDACC];
      if (from !== to) {
        mem.entry(
          id,
          date,
          [
            { account: from, currency: c, amount: neg(op.cents) },
            { account: to, currency: c, amount: amt(op.cents) },
          ],
          `t${n}`,
        );
      }
    } else if (op.kind === 'plazo' && c === 'BOB') {
      mem.entry(
        id,
        date,
        [
          { account: BANCO, currency: 'BOB', amount: neg(op.cents) },
          { account: PLAZO, currency: 'BOB', amount: amt(op.cents) },
        ],
        `t${n}`,
      );
    } else if (op.kind === 'card' && c === 'BOB') {
      mem.entry(
        id,
        date,
        [
          { account: BANCO, currency: 'BOB', amount: neg(op.cents) },
          { account: TARJETA, currency: 'BOB', amount: amt(op.cents) },
        ],
        `t${n}`,
      );
    } else if (op.kind === 'loan' && c === 'BOB') {
      const interest = Math.max(1, Math.trunc((op.cents * op.extra) / 1000));
      mem.entry(
        id,
        date,
        [
          { account: BANCO, currency: 'BOB', amount: neg(op.cents + interest) },
          { account: TARJETA, currency: 'BOB', amount: amt(op.cents) },
          { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: amt(interest) },
        ],
        `t${n}`,
      );
      portion(date, 'EXPENSE', cat, amt(interest), 'BOB', BANCO);
    } else if (op.kind === 'conversion') {
      const usdCents = Math.max(1, Math.trunc(op.cents / 10));
      const fee = op.extra;
      mem.entry(
        id,
        date,
        [
          { account: BANCO, currency: 'BOB', amount: neg(op.cents + fee) },
          { account: 'SYSTEM:FX_TRADING', currency: 'BOB', amount: amt(op.cents) },
          { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: amt(fee) },
          { account: 'SYSTEM:FX_TRADING', currency: 'USD', amount: neg(usdCents) },
          { account: USDACC, currency: 'USD', amount: amt(usdCents) },
        ],
        `t${n}`,
      );
      portion(date, 'EXPENSE', cat, amt(fee), 'BOB', BANCO);
    }
  }
  return mem;
}

const input = {
  userId: USER,
  workspaceId: WS,
  from: '2026-08-01',
  to: '2026-10-31',
  liquidAccountIds: [BANCO, EFECTIVO, USDACC],
  historyAccountIds: [BANCO, USDACC],
  sampleDays: 10,
  drillSamples: 3,
} as const;
const reconcile = (mem: InMemoryFinancialReports) =>
  new ReportsReconciliation(new FinancialReportsService(mem.financialDeps()), mem).verify(input);

describe('Reconciliación de los reportes con el ledger', () => {
  it('[TC-REPORTING-REPORTS-027] [PBT] ledgers aleatorios: ingresos, gastos, categorías, flujo de caja, historial, patrimonio y drill-down cuadran', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbOp, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (ops, seed) => {
          const mismatches = await reconcile(build(ops, seed));
          expect(mismatches, JSON.stringify(mismatches.slice(0, 3))).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  }, 180_000);

  it('[TC-REPORTING-REPORTS-027] una diferencia mínima (3300.01 frente a 3300.00) falla nombrando reporte, periodo y moneda', async () => {
    const mem = build([{ kind: 'expense', day: 70, cents: 330_000, ccy: 'BOB', cat: 0 }], 11);
    expect(await reconcile(mem)).toEqual([]);
    const p = mem.portions.find((x) => x.nature === 'EXPENSE')!;
    mem.portions[mem.portions.indexOf(p)] = { ...p, amount: { amount: '3300.01', currency: 'BOB' } };
    const found = await reconcile(mem);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({
      report: 'INCOME_EXPENSES',
      period: '2026-10',
      currency: 'BOB',
      identity: 'expenses',
    });
  }, 60_000);

  it('[TC-REPORTING-REPORTS-029] el fallo de la verificación del nightly nombra el reporte, el periodo y la moneda de la diferencia', async () => {
    const mem = build([{ kind: 'expense', day: 40, cents: 123_456, ccy: 'USD', cat: 1 }], 5);
    const p = mem.portions.find((x) => x.nature === 'EXPENSE')!;
    mem.portions[mem.portions.indexOf(p)] = { ...p, amount: { amount: '1235.00', currency: 'USD' } };
    const [first] = await reconcile(mem);
    expect(describeMismatch(first!)).toMatch(
      /^INCOME_EXPENSES 2026-09 USD: expenses esperado 1234\.56 y obtenido 1235\.00$/u,
    );
  }, 60_000);
});
