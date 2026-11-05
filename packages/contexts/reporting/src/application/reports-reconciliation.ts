import { dec, LocalDate, Money, plusDays, type Decimal } from '@pf/shared-kernel';
import type { ReportAmountDto } from '../contracts/financial-reports.js';
import { ReportReconciler, type ReconciliationMismatch } from '../domain/index.js';
import type { FinancialReportsService } from './financial-reports.exports.js';

/** Los reportes que usa la batería: el servicio en proceso (PBT, integración) o un adaptador HTTP (nightly). */
export type ReconciliationReports = Pick<
  FinancialReportsService,
  | 'getIncomeExpenses'
  | 'getExpensesByCategory'
  | 'getCashFlow'
  | 'getNetWorth'
  | 'getDrillDown'
  | 'getAccountBalanceHistory'
>;

/** Lo que la reconciliación necesita del ledger: el balance de comprobación a una fecha (`BalanceQuery.getTrialBalance`). */
export interface LedgerTrialPort {
  getTrialBalance(input: { readonly workspaceId: string; readonly asOf?: string }): Promise<{
    readonly currencies: readonly {
      readonly currency: string;
      readonly lines: readonly {
        readonly code: string;
        readonly accountId: string | null;
        readonly balance: { readonly amount: string; readonly currency: string };
      }[];
    }[];
  }>;
}

export interface ReconciliationInput {
  readonly userId: string | null;
  readonly workspaceId: string;
  readonly from: string;
  readonly to: string;
  /** Cuentas líquidas del flujo de caja (por omisión se omite la comparación del saldo final de caja). */
  readonly liquidAccountIds?: readonly string[];
  /** Cuentas cuyo historial de saldo se compara con el saldo contable (en `sampleDays` días al azar). */
  readonly historyAccountIds?: readonly string[];
  readonly sampleDays?: number;
  /** Categorías de las que se muestrea el drill-down (Σ filas = celda). */
  readonly drillSamples?: number;
  /** Semilla del muestreo (determinista). */
  readonly seed?: number;
}

const moneyOf = (m: { amount: string; currency: string }): Money =>
  Money.parse(m.amount, m.currency, m.amount.split('.')[1]?.length ?? 0);

/** Generador pseudoaleatorio determinista (LCG) para el muestreo del nightly. */
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Meses calendario consecutivos de `[from, to]` como rangos `YYYY-MM-01..fin`, en bloques de hasta 12. */
export function monthChunks(from: string, to: string, size = 12): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const first = LocalDate.parse(start);
    const endIdx = first.year * 12 + (first.month - 1) + size;
    const nextYear = Math.floor(endIdx / 12);
    const nextMonth = (endIdx % 12) + 1;
    const next = LocalDate.of(nextYear, nextMonth, 1);
    const chunkEnd = plusDays(next, -1).toString();
    out.push({ from: start, to: chunkEnd < to ? chunkEnd : to });
    start = next.toString();
  }
  return out;
}

/**
 * `ReportsReconciliation` (FR-REPORTING-008, NFR-DATA-008; design decisión 11): la MISMA batería de identidades en el
 * PBT, la integración con Demo v2 y el nightly. Compara los reportes con un camino INDEPENDIENTE del ledger (el balance
 * de comprobación entre cierres de mes sobre `INCOME:<c>` y `EXPENSE:<c>`, que no usa porciones): ingreso y gasto
 * nativos por mes y moneda, Σ categorías = gasto, flujo de caja inicial + componentes = final, historial de saldo =
 * saldo contable, Σ filas del drill-down = celda, y ΔNW = Σ componentes (a la precisión de presentación del
 * consolidado). Tolerancia cero en las cifras nativas. Devuelve las diferencias nombrando reporte, periodo y moneda.
 */
export class ReportsReconciliation {
  constructor(
    private readonly reports: ReconciliationReports,
    private readonly ledger: LedgerTrialPort,
  ) {}

  private async nominalBalances(ws: string, asOf: string): Promise<Map<string, Decimal>> {
    const tb = await this.ledger.getTrialBalance({ workspaceId: ws, asOf });
    const out = new Map<string, Decimal>();
    for (const c of tb.currencies) {
      for (const l of c.lines) {
        if (l.code.startsWith('INCOME:') || l.code.startsWith('EXPENSE:')) {
          out.set(l.code, dec(l.balance.amount));
        }
      }
    }
    return out;
  }

  private async userBalance(ws: string, asOf: string, accountId: string): Promise<Money | null> {
    const tb = await this.ledger.getTrialBalance({ workspaceId: ws, asOf });
    for (const c of tb.currencies) {
      const line = c.lines.find((l) => l.accountId === accountId);
      if (line) return moneyOf(line.balance);
    }
    return null;
  }

  async verify(input: ReconciliationInput): Promise<ReconciliationMismatch[]> {
    const mismatches: ReconciliationMismatch[] = [];
    const base = { userId: input.userId, workspaceId: input.workspaceId };
    const ws = input.workspaceId;
    for (const chunk of monthChunks(input.from, input.to)) {
      const range = {
        ...base,
        from: chunk.from,
        to: chunk.to,
        grouping: 'CALENDAR_MONTH' as const,
        reportingCurrency: undefined,
      };
      const { reportingCurrency: _r, ...params } = range;
      const ie = (await this.reports.getIncomeExpenses(params)).report;
      const cats = (await this.reports.getExpensesByCategory(params)).report;
      // ---- ingreso y gasto nativos por mes y moneda contra el ledger (camino independiente de las porciones)
      let before = await this.nominalBalances(ws, plusDays(LocalDate.parse(chunk.from), -1).toString());
      for (const row of ie.rows) {
        const after = await this.nominalBalances(ws, row.period.to);
        const currencies = new Set<string>();
        for (const k of [...before.keys(), ...after.keys()]) currencies.add(k.split(':')[1] as string);
        for (const m of [...row.income.byCurrency, ...row.expenses.byCurrency]) currencies.add(m.currency);
        for (const c of currencies) {
          const delta = (kind: 'INCOME' | 'EXPENSE') =>
            (after.get(`${kind}:${c}`) ?? dec('0')).minus(before.get(`${kind}:${c}`) ?? dec('0'));
          const scaleLike =
            row.income.byCurrency.concat(row.expenses.byCurrency).find((m) => m.currency === c)?.amount ??
            '0.00';
          const money = (d: Decimal) =>
            Money.parse(
              d.toFixed(scaleLike.split('.')[1]?.length ?? 2),
              c,
              scaleLike.split('.')[1]?.length ?? 2,
            );
          const reported = (a: ReportAmountDto) =>
            moneyOf(
              a.byCurrency.find((m) => m.currency === c) ?? {
                amount: money(dec('0')).toFixed(),
                currency: c,
              },
            );
          mismatches.push(
            ...ReportReconciler.nativeFlow(
              'INCOME_EXPENSES',
              row.period.label,
              'income',
              reported(row.income),
              money(delta('INCOME').neg()),
            ),
            ...ReportReconciler.nativeFlow(
              'INCOME_EXPENSES',
              row.period.label,
              'expenses',
              reported(row.expenses),
              money(delta('EXPENSE')),
            ),
          );
        }
        before = after;
      }
      // ---- Σ categorías = gasto del rango (por moneda nativa)
      const spent = new Map<string, Decimal>();
      for (const row of ie.rows) {
        for (const m of row.expenses.byCurrency)
          spent.set(m.currency, (spent.get(m.currency) ?? dec('0')).plus(m.amount));
      }
      const parts = (a: ReportAmountDto, into: Map<string, Decimal>) => {
        for (const m of a.byCurrency) into.set(m.currency, (into.get(m.currency) ?? dec('0')).plus(m.amount));
      };
      const catSum = new Map<string, Decimal>();
      for (const g of cats.groups) parts(g.amount, catSum);
      if (cats.others) parts(cats.others, catSum);
      for (const [c, total] of new Map([...spent])) {
        const scale = cats.total.byCurrency.find((m) => m.currency === c)?.amount.split('.')[1]?.length ?? 2;
        const mk = (d: Decimal) => Money.parse(d.toFixed(scale), c, scale);
        mismatches.push(
          ...ReportReconciler.categorySum('EXPENSES_BY_CATEGORY', `${chunk.from}..${chunk.to}`, mk(total), [
            mk(catSum.get(c) ?? dec('0')),
          ]),
        );
      }
      // ---- flujo de caja: inicial + componentes = final por moneda
      const cash = (
        await this.reports.getCashFlow({
          ...params,
          ...(input.liquidAccountIds ? { accountIds: input.liquidAccountIds } : {}),
        })
      ).report;
      for (const p of cash.periods) {
        for (const b of p.byCurrency) {
          const total = [b.operating, b.debt, b.savingsInvestments, b.currencyExchange, b.adjustments].reduce(
            (a, m) => a.plus(m.amount),
            dec(b.opening.amount),
          );
          if (!total.eq(b.closing.amount)) {
            mismatches.push({
              report: 'CASH_FLOW',
              period: p.period.label,
              currency: b.currency,
              identity: 'opening+components=closing',
              expected: dec(b.closing.amount).toFixed(),
              actual: total.toFixed(),
            });
          }
        }
      }
      // ---- patrimonio: ΔNW = Σ componentes (los componentes se presentan HALF_EVEN uno a uno: tolerancia de 1 unidad mínima por componente)
      const nw = (await this.reports.getNetWorth(params)).report;
      for (const d of nw.decomposition) {
        if (!d.complete) continue;
        const delta = dec(d.closing.amount).minus(d.opening.amount);
        const sum = [
          d.savings,
          d.conversionResult,
          d.adjustments,
          d.otherMovements,
          d.fxRevaluation,
          d.assetRevaluation,
        ].reduce((a, m) => a.plus(m.amount), dec('0'));
        const unit = dec('1').div(dec('10').pow(d.closing.amount.split('.')[1]?.length ?? 2));
        if (delta.minus(sum).abs().gt(unit.times(7))) {
          mismatches.push({
            report: 'NET_WORTH',
            period: d.period.label,
            currency: d.closing.currency,
            identity: 'delta=sum(components)',
            expected: delta.toFixed(),
            actual: sum.toFixed(),
          });
        }
      }
      // ---- drill-down: Σ filas = celda para las categorías con más porciones del bloque
      const leaves = cats.groups
        .flatMap((g) => g.categories)
        .sort((a, b) => dec(b.amount.consolidated.amount).comparedTo(a.amount.consolidated.amount));
      for (const leaf of leaves.slice(0, input.drillSamples ?? 3)) {
        const rows: Money[] = [];
        let cursor: string | undefined;
        let cell: ReportAmountDto | undefined;
        do {
          const page = (
            await this.reports.getDrillDown({
              ...base,
              report: 'EXPENSES_BY_CATEGORY',
              from: chunk.from,
              to: chunk.to,
              categoryIds: [leaf.categoryId],
              limit: 200,
              ...(cursor ? { cursor } : {}),
            })
          ).report;
          cell = page.totals;
          rows.push(...page.rows.map((r) => moneyOf(r.amount)));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        for (const m of leaf.amount.byCurrency) {
          const mine = rows.filter((r) => r.currency.code === m.currency);
          const sum = mine.reduce((a, r) => a.plus(r.toDecimal()), dec('0'));
          const target = cell?.byCurrency.find((x) => x.currency === m.currency)?.amount ?? '0';
          const cellMoney = moneyOf(m);
          mismatches.push(
            ...ReportReconciler.drillDown(
              'EXPENSES_BY_CATEGORY',
              `${leaf.name} ${chunk.from}..${chunk.to}`,
              cellMoney,
              mine.length ? mine : [Money.parse(sum.toFixed(2), m.currency, 2)],
            ),
          );
          if (!dec(target).eq(m.amount)) {
            mismatches.push({
              report: 'EXPENSES_BY_CATEGORY',
              period: leaf.name,
              currency: m.currency,
              identity: 'drill-down totals=cell',
              expected: m.amount,
              actual: target,
            });
          }
        }
      }
    }
    // ---- historial de saldo = saldo contable en días al azar
    if (input.historyAccountIds?.length) {
      const next = lcg(input.seed ?? 20_261_104);
      const start = LocalDate.parse(input.from).toEpochDay();
      const span = LocalDate.parse(input.to).toEpochDay() - start + 1;
      const sample = Math.min(input.sampleDays ?? 30, span);
      const picked = new Set<string>();
      while (picked.size < sample)
        picked.add(LocalDate.ofEpochDay(start + Math.floor(next() * span)).toString());
      for (const accountId of input.historyAccountIds) {
        const from = LocalDate.parse(input.from).toEpochDay();
        const to = LocalDate.parse(input.to).toEpochDay();
        // El historial admite hasta 731 días: se pide por tramos.
        const days = new Map<string, Money>();
        for (let s = from; s <= to; s += 731) {
          const hist = (
            await this.reports.getAccountBalanceHistory({
              ...input,
              accountId,
              from: LocalDate.ofEpochDay(s).toString(),
              to: LocalDate.ofEpochDay(Math.min(to, s + 730)).toString(),
            })
          ).report;
          for (const d of hist.days) days.set(d.date, moneyOf(d.balance));
        }
        for (const date of picked) {
          const ledger = await this.userBalance(ws, date, accountId);
          const reported = days.get(date);
          if (ledger && reported)
            mismatches.push(...ReportReconciler.balanceDay(`${accountId} ${date}`, reported, ledger));
        }
      }
    }
    return mismatches;
  }
}
