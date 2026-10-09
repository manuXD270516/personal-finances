import { DomainError, LocalDate } from '@pf/shared-kernel';
import type { AuditHistoryQuery, AuditLogEntryDto, AuditPagePosition } from '../contracts/index.js';
import {
  SECURITY_ACTION_RULES,
  auditActionCategory,
  isAuditActionCategory,
  type AuditActionCategory,
} from '../domain/audit-action-category.js';
import { auditAction, isAggregateType } from '../domain/audit-action.js';
import { isUuid } from '../domain/audit-actor.js';
import { isAuditOrigin } from '../domain/audit-origin.js';
import type { AuditRecord } from '../domain/audit-record.js';
import type { AuditLogPageQuery, AuditLogStore, ReadUnitOfWork, WorkspaceTimeZones } from './ports/index.js';

export type AuditSort = 'occurredAt' | '-occurredAt';

/** Filtros combinables de la consulta global del log (FR-AUDIT-006); todos opcionales y con semántica AND. */
export interface AuditFilters {
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  /** Solo registros de este usuario. */
  readonly actorUserId?: string;
  /** Una o varias acciones exactas (`contexto.entidad.verbo`). */
  readonly action?: readonly string[];
  readonly origin?: string;
  /** Identificador de correlación de la operación (en una edición masiva, su `bulkOperationId`). */
  readonly correlationId?: string;
  /** `SECURITY`: solo eventos de seguridad; `DATA`: solo cambios de datos. */
  readonly category?: string;
  /** Fechas de negocio (`YYYY-MM-DD`) en la zona del workspace, inclusivas. */
  readonly from?: string;
  readonly to?: string;
}

/** Rango máximo (días, inclusivo) de una consulta sin `aggregateId` ni `correlationId` (acota el escaneo de particiones). */
export const MAX_UNSCOPED_RANGE_DAYS = 366;
/** Máximo de acciones en el filtro `action`. */
export const MAX_ACTION_FILTERS = 20;

export interface ListAuditLogInput extends AuditFilters {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sort?: AuditSort;
  readonly after?: AuditPagePosition;
  readonly limit: number;
}

export interface AuditQueriesDeps {
  readonly uow: ReadUnitOfWork;
  readonly store: AuditLogStore;
  readonly timeZones: WorkspaceTimeZones;
}

const invalidFilter = (detail: string, pointer: string) =>
  new DomainError('INVALID_FILTER', detail).at(pointer);

/** Desfase (ms) de `timeZone` respecto de UTC en el instante `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Instante UTC de las 00:00 locales de `date` en `timeZone` (con cambios de horario). */
export function startOfDayIn(date: LocalDate, timeZone: string): Date {
  const [y, m, d] = date.toString().split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - offsetMs(naive, timeZone);
  guess = naive - offsetMs(guess, timeZone);
  return new Date(guess);
}

function nextDay(date: LocalDate): LocalDate {
  const [y, m, d] = date.toString().split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return LocalDate.of(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function parseDate(value: string, pointer: string): LocalDate {
  try {
    return LocalDate.parse(value);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'must be a date YYYY-MM-DD').at(pointer);
  }
}

const epochDay = (d: LocalDate): number => {
  const [y, m, day] = d.toString().split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
};

/** Filtros ya validados (fechas parseadas, categoría tipada). */
export interface ValidFilters {
  readonly from: LocalDate | undefined;
  readonly to: LocalDate | undefined;
  readonly category: AuditActionCategory | undefined;
}

/**
 * Valida los filtros de la consulta global (400): `aggregateId` exige `aggregateType`; ids como UUID; `action` como
 * lista de acciones bien formadas; `origin` y `category` de sus catálogos; rango invertido (`INVALID_FILTER`) y rango
 * de más de 366 días sin `aggregateId` ni `correlationId` (`VALIDATION_FAILED`, design decisión 2).
 */
export function validateFilters(f: AuditFilters): ValidFilters {
  if (f.aggregateId !== undefined && f.aggregateType === undefined) {
    throw invalidFilter('aggregateId requires aggregateType', '/aggregateId');
  }
  if (f.aggregateType !== undefined && !isAggregateType(f.aggregateType)) {
    throw new DomainError('VALIDATION_FAILED', 'invalid aggregateType').at('/aggregateType');
  }
  if (f.aggregateId !== undefined && !isUuid(f.aggregateId)) {
    throw new DomainError('VALIDATION_FAILED', 'aggregateId must be a UUID').at('/aggregateId');
  }
  if (f.actorUserId !== undefined && !isUuid(f.actorUserId)) {
    throw new DomainError('VALIDATION_FAILED', 'actorUserId must be a UUID').at('/actorUserId');
  }
  if (f.correlationId !== undefined && !isUuid(f.correlationId)) {
    throw new DomainError('VALIDATION_FAILED', 'correlationId must be a UUID').at('/correlationId');
  }
  if (f.action !== undefined) {
    if (f.action.length === 0 || f.action.length > MAX_ACTION_FILTERS) {
      throw new DomainError('VALIDATION_FAILED', `action must list 1..${MAX_ACTION_FILTERS} actions`).at(
        '/action',
      );
    }
    for (const a of f.action) {
      try {
        auditAction(a);
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'action must be context.entity.verb').at('/action');
      }
    }
  }
  if (f.origin !== undefined && !isAuditOrigin(f.origin)) {
    throw new DomainError('VALIDATION_FAILED', 'invalid origin').at('/origin');
  }
  if (f.category !== undefined && !isAuditActionCategory(f.category)) {
    throw new DomainError('VALIDATION_FAILED', 'category must be SECURITY or DATA').at('/category');
  }
  const from = f.from === undefined ? undefined : parseDate(f.from, '/from');
  const to = f.to === undefined ? undefined : parseDate(f.to, '/to');
  if (from && to) {
    if (from.compare(to) > 0) throw invalidFilter('from must not be after to', '/from');
    const scoped = f.aggregateId !== undefined || f.correlationId !== undefined;
    if (!scoped && epochDay(to) - epochDay(from) + 1 > MAX_UNSCOPED_RANGE_DAYS) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `the date range cannot exceed ${MAX_UNSCOPED_RANGE_DAYS} days unless aggregateId or correlationId is given`,
      ).at('/to');
    }
  }
  return { from, to, category: f.category as AuditActionCategory | undefined };
}

/** Consulta del almacén para unos filtros ya validados; `timeZone` interpreta `from`/`to` como fechas de negocio. */
export function pageQueryOf(
  workspaceId: string,
  f: AuditFilters,
  valid: ValidFilters,
  timeZone: string | undefined,
  page: Pick<AuditLogPageQuery, 'ascending' | 'limit' | 'after'>,
): AuditLogPageQuery {
  const { from, to, category } = valid;
  return {
    workspaceId,
    entities:
      f.aggregateId !== undefined && f.aggregateType !== undefined
        ? [{ aggregateType: f.aggregateType, aggregateId: f.aggregateId }]
        : [],
    ...(f.aggregateType !== undefined ? { aggregateType: f.aggregateType } : {}),
    ...(f.actorUserId !== undefined ? { actorUserId: f.actorUserId } : {}),
    ...(f.action !== undefined ? { actions: f.action } : {}),
    ...(f.origin !== undefined ? { origin: f.origin } : {}),
    ...(f.correlationId !== undefined ? { correlationId: f.correlationId } : {}),
    ...(category !== undefined ? { category: { kind: category, security: SECURITY_ACTION_RULES } } : {}),
    ...(from && timeZone ? { from: startOfDayIn(from, timeZone) } : {}),
    ...(to && timeZone ? { to: startOfDayIn(nextDay(to), timeZone) } : {}),
    ascending: page.ascending,
    ...(page.after ? { after: page.after } : {}),
    limit: page.limit,
  };
}

/** Proyección pública de un registro (nunca `client_ip_hash` ni `idempotency_key`, design §7). */
export function toAuditLogEntryDto(r: AuditRecord): AuditLogEntryDto {
  return {
    id: r.id,
    occurredAt: r.occurredAt.toString(),
    actor: { type: r.actor.type, userId: r.actor.userId, process: r.actor.process },
    action: r.action,
    category: auditActionCategory(r.action),
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    aggregateVersion: r.aggregateVersion,
    changes: r.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
    reason: r.reason,
    correlationId: r.correlationId,
    origin: r.origin,
    userAgent: r.userAgent,
  };
}

/**
 * Queries de AUDIT (design §7): `GetAuditHistory` (con entidad: orden cronológico ascendente por defecto) y
 * `SearchAuditLog` (sin entidad: más reciente primero; rango `from`/`to` en la zona del workspace convertido a
 * `[from 00:00, to+1 00:00)` locales en UTC). Una entidad inexistente o de otro workspace devuelve lista vacía (RLS).
 */
export class AuditQueries implements AuditHistoryQuery {
  constructor(private readonly deps: AuditQueriesDeps) {}

  /** Valida los filtros y devuelve como máximo `limit` registros desde la posición `after`. */
  async list(input: ListAuditLogInput): Promise<readonly AuditRecord[]> {
    const valid = validateFilters(input);
    const sort = input.sort ?? (input.aggregateId !== undefined ? 'occurredAt' : '-occurredAt');
    const { uow, store, timeZones } = this.deps;
    return uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
      const tz =
        valid.from || valid.to ? await timeZones.timeZoneOf(input.userId, input.workspaceId) : undefined;
      return store.page(
        pageQueryOf(input.workspaceId, input, valid, tz, {
          ascending: sort === 'occurredAt',
          ...(input.after ? { after: input.after } : {}),
          limit: input.limit,
        }),
      );
    });
  }

  async historyOf(
    input: Parameters<AuditHistoryQuery['historyOf']>[0],
  ): Promise<readonly AuditLogEntryDto[]> {
    if (input.entities.length === 0) return [];
    for (const e of input.entities) {
      if (!isAggregateType(e.aggregateType) || !isUuid(e.aggregateId)) {
        throw new DomainError('VALIDATION_FAILED', 'invalid entity reference');
      }
    }
    const records = await this.deps.uow.run({ userId: input.userId, workspaceId: input.workspaceId }, () =>
      this.deps.store.page({
        workspaceId: input.workspaceId,
        entities: input.entities,
        ascending: true,
        ...(input.after ? { after: input.after } : {}),
        limit: input.limit,
      }),
    );
    return records.map(toAuditLogEntryDto);
  }
}
