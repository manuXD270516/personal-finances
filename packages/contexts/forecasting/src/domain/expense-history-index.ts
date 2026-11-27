import { LocalDate, type Decimal } from '@pf/shared-kernel';
import { mainCategoryOf, type ExpenseHistory } from './spending-anomaly-detector.js';

/** Días de historia de cada gasto: los 365 anteriores a su fecha (D473, decisión 4). */
export const HISTORY_DAYS = 365;

/** Un gasto ya valorado en la moneda de reporte (insumo del índice de historia). */
export interface ValuedExpense {
  readonly transactionId: string;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly date: string;
  readonly counterpartyId: string | null;
  /** Porciones; `categoryId = null` para «sin categoría». */
  readonly portions: readonly { readonly categoryId: string | null; readonly value: Decimal }[];
  readonly total: Decimal;
}

interface Entry {
  readonly date: string;
  readonly value: Decimal;
}

const byDate = (a: Entry, b: Entry): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Primer índice con `date >= from` en una lista ordenada por fecha. */
function lowerBound(entries: readonly Entry[], from: string): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((entries[mid] as Entry).date < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function window(entries: readonly Entry[] | undefined, from: string, before: string): Decimal[] {
  if (!entries) return [];
  const out: Decimal[] = [];
  for (let i = lowerBound(entries, from); i < entries.length; i += 1) {
    const e = entries[i] as Entry;
    if (e.date >= before) break;
    out.push(e.value);
  }
  return out;
}

/**
 * Índice de la historia de gastos por categoría (cada porción es una muestra), por contraparte (el monto total del gasto)
 * y del workspace (los montos totales). `historyFor(fecha)` entrega las muestras con fecha en `[fecha − 365, fecha − 1]`:
 * el gasto evaluado nunca se cuenta a sí mismo ni a los de su mismo día, así la pasada diaria y el backtesting coinciden.
 */
export class ExpenseHistoryIndex {
  private readonly categories = new Map<string, Entry[]>();
  private readonly counterparties = new Map<string, Entry[]>();
  /** Por par contraparte-categoría principal (D513). */
  private readonly counterpartyCategories = new Map<string, Entry[]>();
  private readonly all: Entry[] = [];

  constructor(expenses: readonly ValuedExpense[]) {
    for (const e of expenses) {
      this.all.push({ date: e.date, value: e.total });
      if (e.counterpartyId !== null)
        push(this.counterparties, e.counterpartyId, { date: e.date, value: e.total });
      if (e.counterpartyId !== null) {
        const main = mainCategoryOf(e.portions);
        if (main !== null)
          push(this.counterpartyCategories, pairKey(e.counterpartyId, main), {
            date: e.date,
            value: e.total,
          });
      }
      for (const p of e.portions) {
        if (p.categoryId !== null) push(this.categories, p.categoryId, { date: e.date, value: p.value });
      }
    }
    this.all.sort(byDate);
    for (const list of this.categories.values()) list.sort(byDate);
    for (const list of this.counterparties.values()) list.sort(byDate);
    for (const list of this.counterpartyCategories.values()) list.sort(byDate);
  }

  historyFor(date: string): ExpenseHistory {
    const from = LocalDate.parse(date).plusDays(-HISTORY_DAYS).toString();
    return {
      category: (id) => window(this.categories.get(id), from, date),
      counterparty: (id) => window(this.counterparties.get(id), from, date),
      counterpartyInCategory: (id, categoryId) =>
        window(this.counterpartyCategories.get(pairKey(id, categoryId)), from, date),
      workspace: () => window(this.all, from, date),
    };
  }
}

const pairKey = (counterpartyId: string, categoryId: string): string => `${counterpartyId}|${categoryId}`;

function push(map: Map<string, Entry[]>, key: string, entry: Entry): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}
