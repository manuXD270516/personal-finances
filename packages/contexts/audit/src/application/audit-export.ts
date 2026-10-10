import { DomainError } from '@pf/shared-kernel';
import type { AuditPort } from '../contracts/index.js';
import { auditActionCategory } from '../domain/audit-action-category.js';
import type { AuditRecord } from '../domain/audit-record.js';
import { pageQueryOf, validateFilters, type AuditFilters } from './audit-queries.js';
import { UTF8_BOM, csvCell, isoInTimeZone, neutralizeFormula } from './lifecycle-report.js';
import type { AuditLogStore, ReadUnitOfWork, UserDisplayNames, WorkspaceTimeZones } from './ports/index.js';

/** Máximo de registros de una exportación síncrona (design decisión 3); más ⇒ `VALIDATION_FAILED`. */
export const MAX_EXPORT_ROWS = 50_000;

/** Encabezado estable del CSV del log (claves y códigos estables, no se traducen), en este orden. */
export const AUDIT_CSV_COLUMNS = [
  'occurredAt',
  'actorType',
  'actorId',
  'actorName',
  'origin',
  'action',
  'category',
  'aggregateType',
  'aggregateId',
  'aggregateVersion',
  'reason',
  'correlationId',
  'changes',
] as const;

export interface AuditExportDeps {
  readonly uow: ReadUnitOfWork;
  readonly store: AuditLogStore;
  readonly timeZones: WorkspaceTimeZones;
  /** Nombre visible de los actores (IDENTITY), resuelto en bloque por exportación. */
  readonly userNames: UserDisplayNames;
  readonly audit: AuditPort;
  /** Tope de filas (por defecto 50000); parametrizable solo para pruebas. */
  readonly maxRows?: number;
}

export interface AuditExportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly rowCount: number;
}

const isMoney = (v: unknown): v is { amount: string; currency: string } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { amount?: unknown }).amount === 'string' &&
  typeof (v as { currency?: unknown }).currency === 'string';

/** Valor del diff como texto: montos como `120.00 BOB` (decimal string, sin pasar por `number`), `null` vacío. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isMoney(value)) return `${value.amount} ${value.currency}`;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Diff resumido `campo: antes → después` (separado por ` | `). Cada valor se neutraliza por separado contra CSV
 * injection (una descripción `=SUM(A1)` sale como `'=SUM(A1)`); los campos sensibles ya están enmascarados al escribir
 * (NFR-SEC-015), así que aquí nunca aparecen en claro.
 */
export function diffSummary(changes: AuditRecord['changes']): string {
  return changes
    .map(
      (c) =>
        `${c.field}: ${neutralizeFormula(valueText(c.before))} → ${neutralizeFormula(valueText(c.after))}`,
    )
    .join(' | ');
}

/**
 * Fila del CSV de un registro (instante en la zona del workspace con su desfase). `actorName` es el nombre visible
 * actual del usuario; vacío para procesos o si no se pudo resolver (el `actorId` siempre está).
 */
export function auditCsvRow(
  r: AuditRecord,
  timeZone: string,
  actorNames: ReadonlyMap<string, string> = new Map(),
): string[] {
  return [
    isoInTimeZone(r.occurredAt.toString(), timeZone),
    r.actor.type,
    r.actor.userId ?? r.actor.process ?? '',
    r.actor.userId ? (actorNames.get(r.actor.userId) ?? '') : '',
    r.origin,
    r.action,
    auditActionCategory(r.action),
    r.aggregateType,
    r.aggregateId,
    r.aggregateVersion === null ? '' : String(r.aggregateVersion),
    r.reason ?? '',
    r.correlationId,
    diffSummary(r.changes),
  ];
}

/** CSV RFC 4180 (coma, CRLF, encabezado estable) con BOM UTF-8 (convenciones del recorrido, docs/31 D52). */
export function auditCsv(
  records: readonly AuditRecord[],
  timeZone: string,
  actorNames: ReadonlyMap<string, string> = new Map(),
): string {
  const lines = [[...AUDIT_CSV_COLUMNS], ...records.map((r) => auditCsvRow(r, timeZone, actorNames))].map(
    (row) => row.map(csvCell).join(','),
  );
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * `ExportAuditLog` (FR-AUDIT-006; solo OWNER, lo aplica `x-required-role` del contrato): exporta a CSV el resultado de
 * la consulta global con los mismos filtros, síncrono hasta 50000 registros (más ⇒ `VALIDATION_FAILED`: el usuario
 * acota los filtros). La exportación queda auditada (`audit.log.exported`, categoría SECURITY, agregado
 * `AuditLogExport` con los filtros y el número de filas, sin contenido) en la misma unidad de trabajo: si la auditoría
 * falla, no hay descarga (docs/12 §13.2). El registro de la exportación no aparece en su propio archivo.
 */
export class AuditLogExporter {
  constructor(private readonly deps: AuditExportDeps) {}

  async export(
    input: AuditFilters & { readonly userId: string; readonly workspaceId: string },
  ): Promise<AuditExportFile> {
    const valid = validateFilters(input);
    const { uow, store, timeZones, userNames, audit } = this.deps;
    const max = this.deps.maxRows ?? MAX_EXPORT_ROWS;
    return uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
      const timeZone = await timeZones.timeZoneOf(input.userId, input.workspaceId);
      const records = await store.page(
        pageQueryOf(input.workspaceId, input, valid, timeZone, { ascending: false, limit: max + 1 }),
      );
      if (records.length > max) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `the export would exceed ${max} records; narrow the filters`,
        );
      }
      const actorIds = [...new Set(records.flatMap((r) => (r.actor.userId ? [r.actor.userId] : [])))];
      const actorNames =
        actorIds.length === 0
          ? new Map<string, string>()
          : await userNames.namesOf(input.workspaceId, actorIds);
      const body = new TextEncoder().encode(auditCsv(records, timeZone, actorNames));
      const changes: { field: string; before: null; after: string | number }[] = [
        { field: 'format', before: null, after: 'csv' },
        { field: 'rowCount', before: null, after: records.length },
      ];
      const filters: readonly (readonly [string, string | undefined])[] = [
        ['actorUserId', input.actorUserId],
        ['action', input.action?.join(',')],
        ['aggregateType', input.aggregateType],
        ['aggregateId', input.aggregateId],
        ['origin', input.origin],
        ['correlationId', input.correlationId],
        ['category', input.category],
        ['from', input.from],
        ['to', input.to],
      ];
      for (const [field, value] of filters) {
        if (value !== undefined) changes.push({ field, before: null, after: value });
      }
      await audit.append({
        workspaceId: input.workspaceId,
        action: 'audit.log.exported',
        aggregateType: 'AuditLogExport',
        aggregateId: input.workspaceId,
        aggregateVersion: null,
        actor: { type: 'USER', userId: input.userId },
        changes,
      });
      return {
        fileName: `audit-${input.workspaceId}-${input.from ?? 'start'}-${input.to ?? 'end'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body,
        rowCount: records.length,
      };
    });
  }
}
