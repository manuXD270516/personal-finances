/**
 * Lógica pura de la pantalla "Auditoría" (openspec add-global-audit-view 6.1; FR-AUDIT-006): filtros combinables,
 * consulta a `listAuditLog`, URL de exportación (`exportAuditLog`, solo OWNER) y enlaces desde otras pantallas.
 */
import type { Page } from '../common/types';

export type AuditCategory = 'SECURITY' | 'DATA';
export type CategoryFilter = AuditCategory | 'ALL';
export const CATEGORY_FILTERS: readonly CategoryFilter[] = ['ALL', 'SECURITY', 'DATA'];

export const AUDIT_ORIGINS = ['ui', 'api', 'import', 'rule', 'recurring', 'system'] as const;

/** Ruta de la pantalla (sin prefijo de locale); vive dentro de la configuración del workspace. */
export const AUDIT_PATH = '/configuracion/auditoria';

/** Rango máximo (días) de una consulta sin entidad ni correlación (la API responde 400 `VALIDATION_FAILED` si se excede). */
export const MAX_RANGE_DAYS = 366;
/** Máximo de registros que exporta el CSV síncrono. */
export const MAX_EXPORT_ROWS = 50_000;

/** `AuditLogEntry` del contrato (`listAuditLog`). */
export interface AuditEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: 'USER' | 'SYSTEM' | 'WORKER';
    readonly userId: string | null;
    readonly process: string | null;
  };
  readonly action: string;
  readonly category?: AuditCategory;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  readonly changes: readonly { readonly field: string; readonly before: unknown; readonly after: unknown }[];
  readonly reason: string | null;
  readonly correlationId: string;
  readonly origin: string;
}

/** Valores de los filtros tal como se escriben en el formulario (texto; vacío = sin filtro). */
export interface AuditFilters {
  readonly actorUserId: string;
  /** Una o varias acciones exactas separadas por comas. */
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly origin: string;
  readonly correlationId: string;
  readonly category: CategoryFilter;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actorUserId: '',
  action: '',
  aggregateType: '',
  aggregateId: '',
  origin: '',
  correlationId: '',
  category: 'ALL',
  from: '',
  to: '',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2}$/;
const AGGREGATE_TYPE = /^[A-Za-z]{1,64}$/;

/** Filtros iniciales desde los parámetros de la URL (`?correlationId=…`, `?aggregateType=…&aggregateId=…`). */
export function filtersFromParams(
  params: Readonly<Partial<Record<keyof AuditFilters, string>>>,
): AuditFilters {
  const category = params.category;
  return {
    ...EMPTY_AUDIT_FILTERS,
    ...Object.fromEntries(
      (Object.keys(EMPTY_AUDIT_FILTERS) as (keyof AuditFilters)[])
        .filter((k) => k !== 'category' && typeof params[k] === 'string')
        .map((k) => [k, (params[k] ?? '').trim()]),
    ),
    category: category === 'SECURITY' || category === 'DATA' ? category : 'ALL',
  };
}

export type FilterErrorKey =
  'actorUserId' | 'action' | 'aggregateType' | 'aggregateId' | 'correlationId' | 'from' | 'to';
export type FilterErrors = Partial<Record<FilterErrorKey, string>>;

const epochDay = (d: string): number => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
};

/**
 * Valida los filtros en el cliente con las mismas reglas que la API (la API sigue siendo la autoridad): devuelve la
 * CLAVE del mensaje de error de cada campo inválido (namespace `AuditLog`, `errors.*`).
 */
export function filterErrors(f: AuditFilters): FilterErrors {
  const errors: Record<string, string> = {};
  if (f.actorUserId && !UUID.test(f.actorUserId)) errors['actorUserId'] = 'uuid';
  if (f.correlationId && !UUID.test(f.correlationId)) errors['correlationId'] = 'uuid';
  if (f.aggregateType && !AGGREGATE_TYPE.test(f.aggregateType)) errors['aggregateType'] = 'aggregateType';
  if (f.aggregateId) {
    if (!UUID.test(f.aggregateId)) errors['aggregateId'] = 'uuid';
    else if (!f.aggregateType) errors['aggregateId'] = 'needsType';
  }
  if (f.action) {
    const actions = actionList(f.action);
    if (actions.length === 0 || actions.length > 20 || actions.some((a) => !ACTION.test(a))) {
      errors['action'] = 'action';
    }
  }
  if (f.from && !DATE.test(f.from)) errors['from'] = 'date';
  if (f.to && !DATE.test(f.to)) errors['to'] = 'date';
  if (!errors['from'] && !errors['to'] && f.from && f.to) {
    if (f.from > f.to) errors['to'] = 'order';
    else if (!f.aggregateId && !f.correlationId && epochDay(f.to) - epochDay(f.from) + 1 > MAX_RANGE_DAYS) {
      errors['to'] = 'range';
    }
  }
  return errors;
}

export const actionList = (value: string): string[] =>
  value
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');

/** Parámetros de consulta de los filtros no vacíos (`listAuditLog` y `exportAuditLog` comparten nombres). */
export function filterParams(f: AuditFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.actorUserId) q.set('actorUserId', f.actorUserId);
  if (f.action) q.set('action', actionList(f.action).join(','));
  if (f.aggregateType) q.set('aggregateType', f.aggregateType);
  if (f.aggregateId) q.set('aggregateId', f.aggregateId);
  if (f.origin) q.set('origin', f.origin);
  if (f.correlationId) q.set('correlationId', f.correlationId);
  if (f.category !== 'ALL') q.set('category', f.category);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  return q;
}

/** Ruta relativa al workspace de una página del log (más reciente primero, 50 por página). */
export function listPath(f: AuditFilters, cursor?: string | null): string {
  const q = filterParams(f);
  q.set('limit', '50');
  if (cursor) q.set('cursor', cursor);
  return `/audit-log?${q.toString()}`;
}

/** Ruta relativa al workspace del CSV con los mismos filtros (`format=csv`). */
export function exportPath(f: AuditFilters): string {
  const q = filterParams(f);
  const withFormat = new URLSearchParams({ format: 'csv' });
  for (const [k, v] of q) withFormat.set(k, v);
  return `/audit-log/export?${withFormat.toString()}`;
}

/** El export CSV es solo para el OWNER (la consulta, para OWNER y EDITOR; docs/33 D105). */
export const canExport = (role: string): boolean => role === 'OWNER';
export const canQuery = (role: string): boolean => role === 'OWNER' || role === 'EDITOR';

/** Enlace (sin locale) a la pantalla con filtros: todos los registros de una operación o de una entidad. */
export function auditHref(
  target:
    { readonly correlationId: string } | { readonly aggregateType: string; readonly aggregateId: string },
): string {
  const q = new URLSearchParams();
  if ('correlationId' in target) q.set('correlationId', target.correlationId);
  else {
    q.set('aggregateType', target.aggregateType);
    q.set('aggregateId', target.aggregateId);
  }
  return `${AUDIT_PATH}?${q.toString()}`;
}

/** Entidades con página propia donde se ve su recorrido: ruta (sin locale) o `undefined` si no la tienen. */
export function entityHref(aggregateType: string, aggregateId: string): string | undefined {
  switch (aggregateType) {
    case 'Transaction':
      return `/transacciones/${aggregateId}`;
    case 'Account':
      return `/cuentas/${aggregateId}`;
    case 'Reconciliation':
      return undefined; // la sesión se abre desde su cuenta
    default:
      return undefined;
  }
}

/** Une dos páginas sin repetir registros (por id), conservando el orden. */
export function appendEntries(current: readonly AuditEntry[], more: readonly AuditEntry[]): AuditEntry[] {
  const seen = new Set(current.map((e) => e.id));
  return [...current, ...more.filter((e) => !seen.has(e.id))];
}

export type AuditPage = Page<AuditEntry>;

/** Clave de i18n de una acción (`identity.session.started` → `actions.identity_session_started`). */
export const actionKey = (action: string): string => `actions.${action.replaceAll('.', '_')}`;

/** Resumen de los filtros activos (para el aviso de "sin resultados" y el nombre accesible del export). */
export const activeFilterCount = (f: AuditFilters): number =>
  Object.entries(f).filter(([k, v]) => (k === 'category' ? v !== 'ALL' : v !== '')).length;
