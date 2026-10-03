import { DomainError, LocalDate } from '@pf/shared-kernel';
import type { AuditHistoryQuery, AuditLogEntryDto, AuditPagePosition } from '../contracts/index.js';
import { isAggregateType } from '../domain/audit-action.js';
import { isUuid } from '../domain/audit-actor.js';
import type { AuditRecord } from '../domain/audit-record.js';
import type { AuditLogStore, ReadUnitOfWork, WorkspaceTimeZones } from './ports/index.js';

export type AuditSort = 'occurredAt' | '-occurredAt';

export interface ListAuditLogInput {
  readonly userId: string;
  readonly workspaceId: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  /** Fechas de negocio (`YYYY-MM-DD`) en la zona del workspace, inclusivas. */
  readonly from?: string;
  readonly to?: string;
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

/** Proyección pública de un registro (nunca `client_ip_hash` ni `idempotency_key`, design §7). */
export function toAuditLogEntryDto(r: AuditRecord): AuditLogEntryDto {
  return {
    id: r.id,
    occurredAt: r.occurredAt.toString(),
    actor: { type: r.actor.type, userId: r.actor.userId, process: r.actor.process },
    action: r.action,
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
    if (input.aggregateId !== undefined && input.aggregateType === undefined) {
      throw invalidFilter('aggregateId requires aggregateType', '/aggregateId');
    }
    if (input.aggregateType !== undefined && !isAggregateType(input.aggregateType)) {
      throw new DomainError('VALIDATION_FAILED', 'invalid aggregateType').at('/aggregateType');
    }
    if (input.aggregateId !== undefined && !isUuid(input.aggregateId)) {
      throw new DomainError('VALIDATION_FAILED', 'aggregateId must be a UUID').at('/aggregateId');
    }
    const from = input.from === undefined ? undefined : parseDate(input.from, '/from');
    const to = input.to === undefined ? undefined : parseDate(input.to, '/to');
    if (from && to && from.compare(to) > 0) throw invalidFilter('from must not be after to', '/from');
    const sort = input.sort ?? (input.aggregateId !== undefined ? 'occurredAt' : '-occurredAt');
    const { uow, store, timeZones } = this.deps;
    return uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
      const tz = from || to ? await timeZones.timeZoneOf(input.userId, input.workspaceId) : undefined;
      return store.page({
        workspaceId: input.workspaceId,
        entities:
          input.aggregateId !== undefined && input.aggregateType !== undefined
            ? [{ aggregateType: input.aggregateType, aggregateId: input.aggregateId }]
            : [],
        ...(input.aggregateType !== undefined ? { aggregateType: input.aggregateType } : {}),
        ...(from && tz ? { from: startOfDayIn(from, tz) } : {}),
        ...(to && tz ? { to: startOfDayIn(nextDay(to), tz) } : {}),
        ascending: sort === 'occurredAt',
        ...(input.after ? { after: input.after } : {}),
        limit: input.limit,
      });
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
