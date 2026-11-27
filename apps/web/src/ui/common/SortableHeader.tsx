import { useCallback, useState, type CSSProperties } from 'react';
import type { FormatContext } from '../dashboard/types';
import { nextSort, type SortDirection, type SortKind, type SortState } from './sort';
import { cellStyle } from './ui';

/**
 * Orden por columna de las tablas comparativas (refine-data-tables, M-18). El encabezado activo declara `aria-sort`
 * en el `<th>` (nunca `none` ni en el botón); el botón es el control y conserva el foco al reordenar; el ícono de
 * sentido es decorativo (`aria-hidden`). El anuncio va a un `role="status"` propio de la tabla, una vez por cambio.
 *
 * Los textos salen del namespace de la vista (`sort.*`: announce, ascending, descending, textAscending,
 * textDescending, dateAscending, dateDescending), porque las vistas reciben un `FormatContext` de su namespace.
 */
const SORT_ICON_PATH = 'M6 1 L10 6 H2 Z M6 11 L2 6 H10 Z';

export function SortableHeader({
  label,
  direction,
  onSort,
  align = 'left',
}: {
  label: string;
  /** Sentido si esta es la columna activa; `undefined` en las demás (sin `aria-sort`). */
  direction: SortDirection | undefined;
  onSort: () => void;
  align?: 'left' | 'right';
}) {
  const style: CSSProperties = {
    borderBlockEnd: cellStyle.borderBlockEnd,
    textAlign: align,
    padding: 0,
  };
  return (
    <th scope="col" style={style} aria-sort={direction}>
      <button
        type="button"
        className="pf-sort-btn"
        style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
        onClick={onSort}
      >
        <span>{label}</span>
        <svg className="pf-sort-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d={SORT_ICON_PATH} fill="currentColor" />
        </svg>
      </button>
    </th>
  );
}

/** Texto del anuncio: «Ordenado por Monto, de mayor a menor». */
export function sortAnnouncement(
  f: FormatContext,
  column: string,
  direction: SortDirection,
  kind: SortKind,
): string {
  const prefix = kind === 'text' ? 'text' : kind === 'date' ? 'date' : '';
  const key = prefix
    ? `sort.${prefix}${direction === 'ascending' ? 'Ascending' : 'Descending'}`
    : `sort.${direction}`;
  return f.t('sort.announce', { column, direction: f.t(key) });
}

/** Estado del orden de una tabla y su anuncio. `toggle` recibe el rótulo de la columna para el anuncio. */
export function useTableSort<K extends string>(f: FormatContext, initial?: SortState<K>) {
  const [sort, setSort] = useState<SortState<K> | undefined>(initial);
  const [message, setMessage] = useState('');
  const toggle = useCallback(
    (key: K, label: string, kind: SortKind) => {
      const next = nextSort(sort, key, kind);
      setSort(next);
      setMessage(sortAnnouncement(f, label, next.direction, kind));
    },
    [sort, f],
  );
  const directionOf = (key: K): SortDirection | undefined => (sort?.key === key ? sort.direction : undefined);
  return { sort, toggle, message, directionOf };
}

/** Región de estado de la tabla: ya está en el DOM antes de ordenar, para que el cambio se anuncie. */
export function SortStatus({ message }: { message: string }) {
  return (
    <p role="status" className="pf-sr-only" data-testid="sort-status">
      {message}
    </p>
  );
}
