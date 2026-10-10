/**
 * Lógica pura de los próximos pagos (openspec add-upcoming-payments 6): recorte de la tarjeta del Home, presentación
 * del estado (texto + glifo: nunca solo color, NFR-USAB-104), texto del monto según su tipo y rutas. Sin React.
 */
import { formatMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import type { UpcomingItemStatus, UpcomingPaymentItem } from './types';

/** Ventanas del selector de la vista completa (por defecto 30). */
export const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_DAYS = 30;
/** Tarjeta Q8 del Home (docs/35 D148): 7 días fijos y hasta 5 ítems con enlace a la vista completa. */
export const HOME_DAYS = 7;
export const HOME_ITEMS = 5;

export const UPCOMING_PATH = '/pagos-proximos';
/** Pantalla de pagos recurrentes: aprobar, omitir y vincular se hacen allí (no se duplican aquí). */
export const RECURRING_PATH = '/recurring';

export const occurrencePath = (id: string): string => `/recurring/occurrences/${encodeURIComponent(id)}`;
export const transactionPath = (id: string): string => `/transacciones/${encodeURIComponent(id)}`;

/** Destino de un ítem: la ocurrencia (acciones) o la transacción pendiente. */
export function itemPath(item: Pick<UpcomingPaymentItem, 'kind' | 'occurrenceId' | 'transactionId'>): string {
  if (item.kind === 'OCCURRENCE' && item.occurrenceId) return occurrencePath(item.occurrenceId);
  if (item.transactionId) return transactionPath(item.transactionId);
  return RECURRING_PATH;
}

/** Los primeros `limit` ítems y cuántos quedan fuera ("y N más"). */
export function homeSlice<T>(items: readonly T[], limit = HOME_ITEMS): { shown: readonly T[]; more: number } {
  return { shown: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}

export interface StatusPresentation {
  /** Glifo decorativo (`aria-hidden`): el texto siempre acompaña. */
  readonly icon: string;
  readonly tone: 'danger' | 'warn' | 'neutral';
}

const STATUS: Record<UpcomingItemStatus, StatusPresentation> = {
  OVERDUE: { icon: '▲', tone: 'danger' },
  DUE: { icon: '●', tone: 'warn' },
  PENDING_APPROVAL: { icon: '✎', tone: 'warn' },
  PENDING: { icon: '◔', tone: 'neutral' },
  SCHEDULED: { icon: '○', tone: 'neutral' },
};
export const statusPresentation = (s: UpcomingItemStatus): StatusPresentation => STATUS[s];

/** Etiqueta de estado traducida; el vencido incluye los días de atraso. */
export function statusLabel(
  item: Pick<UpcomingPaymentItem, 'status' | 'daysOverdue'>,
  f: FormatContext,
): string {
  return item.status === 'OVERDUE' && item.daysOverdue !== undefined
    ? f.t('status.OVERDUE_DAYS', { days: item.daysOverdue })
    : f.t(`status.${item.status}`);
}

/**
 * Texto del monto de un ítem según su tipo (FR-COMMITMENTS-004): exacto, estimado marcado, rango con el máximo en los
 * totales, "monto variable" sin cifra. Nunca se muestra 0 para un pago sin monto.
 */
export function amountText(item: UpcomingPaymentItem, f: FormatContext): string {
  if (item.range) {
    return f.t('amount.range', {
      min: formatMoney(item.range.min, f.locale),
      max: formatMoney(item.range.max, f.locale),
    });
  }
  if (item.withoutAmount || item.amount === null) return f.t('amount.variable');
  const text = formatMoney(item.amount, f.locale);
  return item.estimated ? f.t('amount.estimated', { amount: text }) : text;
}

/** Montos separados por " · " (totales por moneda original). */
export const joinMoney = (list: readonly Money[], locale: string): string =>
  list.map((m) => formatMoney(m, locale)).join(' · ');
