import { dec } from '@pf/shared-kernel';

/**
 * Orden por columna de las tablas comparativas (refine-data-tables, M-18). Se ordena lo que ya está en pantalla.
 * Los montos llegan como string decimal desde la API y se comparan como decimales exactos (INV-001, ADR-0006),
 * nunca con `number` ni con el texto formateado: «999,00» > «1.234,56» como texto.
 */
export type SortDirection = 'ascending' | 'descending';
export type SortKind = 'text' | 'decimal' | 'date';
export interface SortState<K extends string = string> {
  readonly key: K;
  readonly direction: SortDirection;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareValues(a: string, b: string, kind: SortKind): number {
  if (kind === 'decimal') return dec(a).comparedTo(dec(b));
  // Las fechas llegan en ISO (`YYYY-MM-DD` o instante): el orden léxico es el cronológico.
  if (kind === 'date') return a < b ? -1 : a > b ? 1 : 0;
  return collator.compare(a, b);
}

const isEmpty = (v: string | undefined | null): v is undefined | null =>
  v === undefined || v === null || v === '';

/** Copia ordenada (estable); los valores ausentes quedan al final en ambos sentidos. */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | undefined | null,
  direction: SortDirection,
  kind: SortKind,
): T[] {
  const factor = direction === 'ascending' ? 1 : -1;
  return [...rows]
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((x, y) => {
      const xe = isEmpty(x.v);
      const ye = isEmpty(y.v);
      if (xe || ye) return xe && ye ? x.index - y.index : xe ? 1 : -1;
      const c = compareValues(x.v as string, y.v as string, kind) * factor;
      return c !== 0 ? c : x.index - y.index;
    })
    .map((x) => x.row);
}

/**
 * Primera activación de una columna: los montos empiezan de mayor a menor (lo que se busca primero en un reporte);
 * el texto y las fechas, ascendentes. Repetir la misma columna alterna el sentido.
 */
export function nextSort<K extends string>(
  current: SortState<K> | undefined,
  key: K,
  kind: SortKind = 'text',
): SortState<K> {
  if (current?.key === key) {
    return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  }
  return { key, direction: kind === 'decimal' ? 'descending' : 'ascending' };
}
