import { formatDecimal } from '../AuditHistory';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import {
  STATUS_FILTERS,
  type AnomalyNames,
  type SpendingAnomaly,
  type SpendingAnomalyReason,
  type StatusFilter,
} from './types';

/** Ruta (sin locale) de la vista (add-spending-anomaly-detection, decisión 14). */
export const SPENDING_ANOMALIES_PATH = '/gastos-atipicos';
/** La API acepta hasta 100 ids por consulta de marcas. */
export const MARK_BATCH = 100;

export interface AnomalyFilters {
  readonly status: StatusFilter;
  readonly from: string;
  readonly to: string;
}
export const DEFAULT_FILTERS: AnomalyFilters = { status: 'OPEN', from: '', to: '' };

/** Filtros desde la URL (`?estado=DISMISSED&desde=2026-11-01&hasta=2026-11-30`); lo inválido vuelve al valor por omisión. */
export function filtersFromSearch(search: URLSearchParams): AnomalyFilters {
  const status = search.get('estado');
  const date = (key: string): string => {
    const v = search.get(key) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/u.test(v) ? v : '';
  };
  return {
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'OPEN',
    from: date('desde'),
    to: date('hasta'),
  };
}

export function filtersToSearch(filters: AnomalyFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (filters.status !== 'OPEN') q.set('estado', filters.status);
  if (filters.from) q.set('desde', filters.from);
  if (filters.to) q.set('hasta', filters.to);
  return q;
}

/** `GET /spending-anomalies` con los filtros de la vista y el cursor de la página. */
export function listApiPath(base: string, filters: AnomalyFilters, cursor?: string | null): string {
  const q = new URLSearchParams({ status: filters.status, limit: '50' });
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (cursor) q.set('cursor', cursor);
  return `${base}/spending-anomalies?${q.toString()}`;
}

/** `GET /spending-anomalies?transactionId=…` para las filas visibles (hasta 100 ids por consulta). */
export function marksApiPath(base: string, transactionIds: readonly string[]): string {
  const q = new URLSearchParams();
  for (const id of transactionIds.slice(0, MARK_BATCH)) q.append('transactionId', id);
  return `${base}/spending-anomalies?${q.toString()}`;
}

/** Ids en tandas de hasta 100, sin repetir y en orden estable. */
export function batchesOf(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += MARK_BATCH) out.push(unique.slice(i, i + MARK_BATCH));
  return out;
}

/**
 * Motivo del gasto atípico por plantilla (sin modelos de lenguaje, FR-FORECAST-004): la razón con la mediana (o el percentil),
 * la referencia en la moneda de reporte y la cantidad de gastos de historia, con los formatos del workspace. `f` es del
 * namespace `SpendingAnomalies`. El texto nunca habla de error ni de fraude (RISK-015).
 */
export function reasonText(reason: SpendingAnomalyReason, f: FormatContext, names: AnomalyNames): string {
  const name =
    (reason.kind === 'CATEGORY_OUTLIER'
      ? reason.categoryId && names.category(reason.categoryId)
      : reason.counterpartyId && names.counterparty(reason.counterpartyId)) || f.t('noName');
  // Contraparte (D513): el motivo nombra la categoría principal. Las marcas anteriores al change 85 no la traen y no se
  // recalculan: usan la plantilla sin categoría.
  const category =
    reason.kind === 'COUNTERPARTY_OUTLIER' ? names.category(reason.categoryId ?? '') : undefined;
  const wanted =
    reason.kind === 'COUNTERPARTY_OUTLIER' && !category ? 'COUNTERPARTY_OUTLIER_LEGACY' : reason.kind;
  const key = f.has(`reason.${wanted}`) ? wanted : 'CATEGORY_OUTLIER';
  return f.t(`reason.${key}`, {
    category: category ?? '',
    ratio: reason.ratio === null ? '' : formatDecimal(reason.ratio, f.locale),
    name,
    reference: formatMoney(reason.reference, f.locale),
    count: reason.sampleSize,
  });
}

export function reasonsText(a: SpendingAnomaly, f: FormatContext, names: AnomalyNames): string[] {
  return a.reasons.map((r) => reasonText(r, f, names));
}
