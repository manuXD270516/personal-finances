import {
  FlowValuation,
  Money,
  convertExact,
  currency as makeCurrency,
  dec,
  type Currency,
  type Decimal,
  type ExactRate,
  type Instant,
} from '@pf/shared-kernel';
import type { ValuedExpense } from '../domain/index.js';
import type { AnomalyDeps, ExpenseLineInput } from './anomaly-ports.js';

export const scaleOfText = (amount: string): number => {
  const dot = amount.indexOf('.');
  return dot < 0 ? 0 : amount.length - dot - 1;
};

/** Las porciones de una transacción (todas con la misma versión, fecha, contraparte y moneda). */
export interface TransactionGroup {
  readonly transactionId: string;
  readonly version: number;
  readonly date: string;
  readonly counterpartyId: string | null;
  readonly lines: ExpenseLineInput[];
}

export interface LoadedExpense {
  readonly group: TransactionGroup;
  /** `null` si alguna porción no tiene tasa para su fecha (el gasto no se evalúa ni forma parte de la historia). */
  readonly expense: ValuedExpense | null;
}

/** `null` si alguna porción no tiene tasa para su fecha. */
function valueOf(
  group: TransactionGroup,
  target: Currency,
  uncategorized: ReadonlySet<string>,
  rateFor: (code: string, date: string) => ExactRate | null,
): ValuedExpense | null {
  const portions: { categoryId: string | null; value: Decimal }[] = [];
  let total = dec('0');
  for (const l of group.lines) {
    let value: Decimal;
    if (l.amount.currency === target.code) {
      value = dec(l.amount.amount);
    } else {
      const rate = rateFor(l.amount.currency, l.date);
      if (!rate) return null;
      value = convertExact(
        Money.parse(l.amount.amount, l.amount.currency, scaleOfText(l.amount.amount)),
        target,
        rate,
      );
    }
    portions.push({ categoryId: uncategorized.has(l.categoryId) ? null : l.categoryId, value });
    total = total.plus(value);
  }
  return {
    transactionId: group.transactionId,
    date: group.date,
    counterpartyId: group.counterpartyId,
    portions,
    total,
  };
}

/**
 * Carga y valora los gastos del workspace entre dos fechas (decisiones 2 y 3): porciones de TRANSACTIONS sin los gastos
 * administrados por otro módulo, sin los vinculados a una ocurrencia de un compromiso, agrupadas por transacción y llevadas
 * a la moneda de reporte con la tasa de su fecha (sin tasa, `expense = null`; nunca 1:1). Lecturas en serie.
 */
export async function loadExpenses(
  deps: Pick<AnomalyDeps, 'expenses' | 'resolved' | 'categories' | 'rates' | 'settings'>,
  workspaceId: string,
  ws: { readonly timeZone: string; readonly reportingCurrency: string; readonly reportingScale: number },
  range: { readonly from: string; readonly to: string },
  now: Instant,
): Promise<{ readonly target: Currency; readonly items: readonly LoadedExpense[] }> {
  const target = makeCurrency(ws.reportingCurrency, ws.reportingScale);
  const rawLines = await deps.expenses.listExpenseLines(workspaceId, range.from, range.to);
  if (rawLines.length === 0) return { target, items: [] };
  const linked = await deps.resolved.transactionIds(workspaceId, range.from, range.to);
  const lines = rawLines.filter((l) => !linked.has(l.transactionId));
  const catalog = await deps.categories.catalog(workspaceId);
  const uncategorized = new Set(catalog.categories.filter((c) => c.uncategorized).map((c) => c.categoryId));
  const foreign = lines
    .filter((l) => l.amount.currency !== target.code)
    .map((l) => ({
      date: l.date,
      amount: Money.parse(l.amount.amount, l.amount.currency, scaleOfText(l.amount.amount)),
    }));
  const rates = await FlowValuation.resolveRates({
    flows: foreign,
    target,
    timeZone: ws.timeZone,
    now,
    windowDays: deps.settings.rateValidityWindowDays,
    resolve: (input) => deps.rates.resolve(workspaceId, input),
    keyOf: (resolved) => JSON.stringify(resolved),
  });
  const groups = new Map<string, TransactionGroup>();
  for (const l of lines) {
    const g = groups.get(l.transactionId);
    if (g) g.lines.push(l);
    else
      groups.set(l.transactionId, {
        transactionId: l.transactionId,
        version: l.version,
        date: l.date,
        counterpartyId: l.counterpartyId,
        lines: [l],
      });
  }
  const items = [...groups.values()].map((group) => ({
    group,
    expense: valueOf(group, target, uncategorized, (code, date) => rates.rateFor(code, date)),
  }));
  return { target, items };
}
