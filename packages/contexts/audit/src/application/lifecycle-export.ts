import { DomainError, type Clock } from '@pf/shared-kernel';
import type {
  AuditPort,
  LifecycleAggregateType,
  LifecycleExportFormat,
  LifecycleExportLoaders,
} from '../contracts/index.js';
import {
  buildLifecycleReport,
  lifecycleCsv,
  lifecycleFileName,
  type LifecycleReport,
  type LifecycleReportLocale,
} from './lifecycle-report.js';
import type { ReadUnitOfWork, WorkspaceTimeZones } from './ports/index.js';

/** Renderizador del PDF del recorrido (infraestructura: pdfkit). */
export interface LifecyclePdfRenderer {
  render(report: LifecycleReport): Promise<Uint8Array>;
}

export interface LifecycleExportDeps {
  /** Cargas del recorrido por tipo de agregado (las aporta el composition root desde cada contexto dueño). */
  readonly loaders: LifecycleExportLoaders;
  readonly timeZones: WorkspaceTimeZones;
  /** Unidad de trabajo con contexto RLS (usuario + workspace) en la que también se audita la exportación. */
  readonly uow: ReadUnitOfWork;
  readonly audit: AuditPort;
  readonly clock: Clock;
  readonly pdf: LifecyclePdfRenderer;
}

export interface LifecycleExportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Uint8Array;
}

export const LIFECYCLE_EXPORT_CONTENT_TYPES: Readonly<Record<LifecycleExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

/**
 * `ExportLifecycle` (docs/31 D52): descarga síncrona del recorrido de un agregado en CSV o PDF. Mismo alcance que la
 * consulta del recorrido (la carga el contexto dueño: 404 idéntico a inexistente fuera del workspace, RLS). Exportar
 * no modifica el recorrido ni escribe una anotación, pero queda auditado (`audit.lifecycle.exported`, agregado
 * `LifecycleExport` con el tipo de agregado y el formato, sin contenido del archivo; docs/12 §13.2 y docs/14: vía de
 * extracción de datos) en la misma unidad de trabajo: si la auditoría falla, no hay descarga.
 */
export class LifecycleExporter {
  constructor(private readonly deps: LifecycleExportDeps) {}

  async export(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly aggregateType: LifecycleAggregateType;
    readonly aggregateId: string;
    readonly format: LifecycleExportFormat;
    /** Locale de los textos del PDF (es; en/pt preparados). El CSV usa claves y códigos estables. */
    readonly locale?: LifecycleReportLocale;
  }): Promise<LifecycleExportFile> {
    const loader = this.deps.loaders[input.aggregateType];
    if (!loader) {
      throw new DomainError('RESOURCE_NOT_FOUND', `no lifecycle export for ${input.aggregateType}`);
    }
    const { uow, timeZones, audit, clock, pdf } = this.deps;
    return uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
      const source = await loader({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateId: input.aggregateId,
      });
      const timeZone = await timeZones.timeZoneOf(input.userId, input.workspaceId);
      const body =
        input.format === 'csv'
          ? new TextEncoder().encode(lifecycleCsv(source, timeZone))
          : await pdf.render(
              buildLifecycleReport(source, {
                timeZone,
                generatedAt: clock.now().toString(),
                locale: input.locale ?? 'es',
              }),
            );
      await audit.append({
        workspaceId: input.workspaceId,
        action: 'audit.lifecycle.exported',
        aggregateType: 'LifecycleExport',
        aggregateId: source.lifecycle.aggregateId,
        aggregateVersion: null,
        actor: { type: 'USER', userId: input.userId },
        changes: [
          { field: 'aggregateType', before: null, after: input.aggregateType },
          { field: 'format', before: null, after: input.format },
        ],
      });
      return {
        fileName: lifecycleFileName(input.aggregateType, source.lifecycle.aggregateId, input.format),
        contentType: LIFECYCLE_EXPORT_CONTENT_TYPES[input.format],
        body,
      };
    });
  }
}
