import { DomainError, LocalDate } from '@pf/shared-kernel';
import type { Classification, ImportStatus } from '../domain/index.js';
import type { ImportsDeps } from './ports/index.js';
import { buildPreviewSummary, toRowView } from './preview.js';
import { toJobView, type ImportJobView, type PreviewCandidateView, type PreviewView } from './views.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `import ${id} not found`);

/** Lecturas de IMPORTS (sin efectos): lista, detalle con progreso y vista previa paginada con totales por SQL. */
export class ImportsQueries {
  constructor(private readonly deps: ImportsDeps) {}

  list(
    workspaceId: string,
    filter: {
      readonly accountId?: string | undefined;
      readonly status?: ImportStatus | undefined;
      readonly limit: number;
      readonly after?: readonly [string, string] | undefined;
    },
  ): Promise<ImportJobView[]> {
    return this.deps.uow.run(workspaceId, async () =>
      (await this.deps.jobs.list(workspaceId, filter)).map((j) => toJobView(j.state)),
    );
  }

  get(workspaceId: string, id: string): Promise<ImportJobView> {
    return this.deps.uow.run(workspaceId, async () => {
      const job = await this.deps.jobs.findById(workspaceId, id);
      if (!job) throw notFound(id);
      return toJobView(job.state);
    });
  }

  /**
   * Vista previa: conteos por clasificación, Σ de salidas y entradas de las filas a crear y saldo actual y resultante
   * (decisión 12). Paginada por línea de archivo (50 por defecto). Los candidatos de un posible duplicado se resuelven
   * para las filas de la página con la misma consulta set-based que la clasificación.
   */
  preview(
    workspaceId: string,
    id: string,
    options: {
      readonly classification?: Classification | undefined;
      readonly afterRowNumber?: number | undefined;
      readonly limit: number;
    },
  ): Promise<PreviewView> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, id);
      if (!job) throw notFound(id);
      const account = await deps.accounts.getAccount(workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
      const summary = await buildPreviewSummary(deps, {
        workspaceId,
        job: job.state,
        account,
        summary: await deps.staging.summary(workspaceId, id),
      });
      const found = await deps.staging.page(workspaceId, id, {
        classification: options.classification,
        afterRowNumber: options.afterRowNumber,
        limit: options.limit + 1,
      });
      const rows = found.slice(0, options.limit);

      const probable = rows.filter(
        (r) => r.classification === 'DUPLICATE_PROBABLE' && r.matchedTransactionId !== null && r.bookingDate,
      );
      const details = new Map<string, PreviewCandidateView>();
      if (probable.length > 0) {
        const result = await deps.duplicates.findForImport({
          workspaceId,
          accountId: account.accountId,
          windowDays: deps.settings.duplicateWindowDays,
          rows: probable.map((r) => ({
            rowRef: r.id,
            date: LocalDate.parse(r.bookingDate as string).toString(),
            direction: r.direction as 'IN' | 'OUT',
            amount: { amount: r.amount as string, currency: account.currency },
          })),
        });
        for (const entry of result) {
          const row = probable.find((r) => r.id === entry.rowRef);
          const c = entry.candidates.find((x) => x.transactionId === row?.matchedTransactionId);
          if (c) {
            details.set(entry.rowRef, {
              transactionId: c.transactionId,
              kind: c.kind,
              date: c.date,
              amount: c.amount,
              description: c.description,
            });
          }
        }
      }
      const views = rows.map((r) => {
        const candidate =
          details.get(r.id) ??
          (r.matchedTransactionId
            ? {
                transactionId: r.matchedTransactionId,
                kind: null,
                date: null,
                amount: null,
                description: null,
              }
            : null);
        return toRowView(r, candidate, account.currency);
      });
      const last = rows.at(-1);
      return {
        summary,
        rows: views,
        nextCursor: found.length > options.limit && last ? last.rowNumber : null,
      };
    });
  }
}
