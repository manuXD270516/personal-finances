/**
 * Lógica pura de la pantalla de periodos financieros (openspec add-financial-periods 6.1–6.2): sin React ni zona
 * horaria del proceso. Las fechas de negocio `YYYY-MM-DD` se comparan como texto y se formatean sin conversión de
 * zona; "hoy" llega ya calculado en la zona del workspace (`todayIn(ws.timezone)`).
 */

export type FinancialPeriodStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'REOPENED';

export const PERIOD_STATUSES: readonly FinancialPeriodStatus[] = ['DRAFT', 'ACTIVE', 'CLOSED', 'REOPENED'];

/** `FinancialPeriod` del contrato OpenAPI. */
export interface FinancialPeriod {
  readonly id: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: FinancialPeriodStatus;
  readonly startDay: number;
  readonly isTransition: boolean;
  readonly pendingClosure: boolean;
  readonly closeCount: number;
  readonly reopenCount: number;
  readonly latestCloseNo: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly activatedAt: string | null;
}

/** `2026-10-25` → `25/10/2026` (docs/28 §8.5: fechas de negocio en dd/MM/yyyy, sin conversión de zona). */
export function formatBusinessDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/** Nombre del mes de la etiqueta (`2026-10` → "octubre de 2026" en es-BO); día 1 en UTC, sin zona del proceso. */
export function periodName(label: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return label;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)),
  );
}

export const containsDate = (p: FinancialPeriod, date: string): boolean =>
  p.periodStart <= date && date <= p.periodEnd;

/** Periodos por inicio descendente (el más reciente primero, como el listado de la API). */
export const newestFirst = (periods: readonly FinancialPeriod[]): FinancialPeriod[] =>
  [...periods].sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0));

/**
 * Periodo por defecto del selector: el que contiene hoy en la zona del workspace; si ninguno lo contiene, el último
 * ya iniciado; si todos son futuros, el primero.
 */
export function defaultPeriodId(periods: readonly FinancialPeriod[], today: string): string | undefined {
  const current = periods.find((p) => containsDate(p, today));
  if (current) return current.id;
  const started = newestFirst(periods).find((p) => p.periodStart <= today);
  return (started ?? [...periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))[0])?.id;
}

/** Activación manual (EDITOR/OWNER): solo un DRAFT cuyo inicio ya llegó en la zona del workspace. */
export const canActivate = (p: FinancialPeriod, today: string, canEdit: boolean): boolean =>
  canEdit && p.status === 'DRAFT' && p.periodStart <= today;
