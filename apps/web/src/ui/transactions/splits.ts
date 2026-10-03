import {
  allocateByPercent,
  allocateEqually,
  normalizeDecimalInput,
  parseAmount,
  subtractAmounts,
  sumAmounts,
} from '../common/money';

/** Fila editable de un split: el monto y el porcentaje son lo que escribió el usuario (se validan al calcular). */
export interface SplitRow {
  readonly key: string;
  readonly categoryId: string;
  readonly amount: string;
  readonly percent: string;
  readonly tagIds: readonly string[];
}

export interface SplitMoney {
  readonly locale: string;
  readonly currency: string;
  readonly scale: number;
}

export interface SplitsSummary {
  /** Monto canónico de cada fila (null si es inválido o vacío). */
  readonly amounts: readonly (string | null)[];
  readonly assigned: string | null;
  /** Total − Σ splits (0 ⇒ cuadra); null si el total o algún split no es válido. */
  readonly remaining: string | null;
  readonly balanced: boolean;
}

let seq = 0;
export const newSplitRow = (over: Partial<SplitRow> = {}): SplitRow => ({
  key: `s${(seq += 1)}`,
  categoryId: '',
  amount: '',
  percent: '',
  tagIds: [],
  ...over,
});

/**
 * Estado de los splits contra el total (FR-TRANSACTIONS splits, INV-021): una sola fila sin monto toma el total;
 * con varias, cada una debe ser un monto válido de la moneda y la suma debe ser exacta ("Restante por asignar").
 */
export function summarizeSplits(
  rows: readonly SplitRow[],
  total: string | null,
  m: SplitMoney,
): SplitsSummary {
  const amounts = rows.map((r, i) => {
    if (rows.length === 1 && i === 0 && r.amount.trim() === '') return total;
    const p = parseAmount(r.amount, m);
    return p.ok ? p.value : null;
  });
  if (total === null || amounts.some((a) => a === null)) {
    const valid = amounts.filter((a): a is string => a !== null);
    return {
      amounts,
      assigned: valid.length ? sumAmounts(valid, m.currency, m.scale) : null,
      remaining: null,
      balanced: false,
    };
  }
  const assigned = sumAmounts(amounts as string[], m.currency, m.scale);
  const remaining = subtractAmounts(total, assigned, m.currency, m.scale);
  return { amounts, assigned, remaining, balanced: /^-?0*(\.0*)?$/.test(remaining) };
}

/** Reparte el total en partes iguales entre las filas (mayor residuo, regla compartida con el dominio). */
export function splitEqually(rows: readonly SplitRow[], total: string, m: SplitMoney): SplitRow[] {
  const parts = allocateEqually(total, rows.length, m.currency, m.scale);
  return rows.map((r, i) => ({ ...r, amount: parts[i] ?? r.amount }));
}

/** Reparte por los porcentajes escritos en cada fila; `null` si no suman 100. */
export function splitByPercent(rows: readonly SplitRow[], total: string, m: SplitMoney): SplitRow[] | null {
  const percents = rows.map((r) => normalizeDecimalInput(r.percent, m.locale));
  if (percents.some((p) => p === null)) return null;
  const parts = allocateByPercent(total, percents as string[], m.currency, m.scale);
  return parts ? rows.map((r, i) => ({ ...r, amount: parts[i]! })) : null;
}
