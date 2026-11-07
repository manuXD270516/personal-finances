import { uuidv7 } from '@pf/platform/logging';
import { DomainError } from '@pf/shared-kernel';
import type {
  OpenedSavedReportViewDto,
  SavedReportViewDto,
  SavedViewWarningDto,
} from '../contracts/financial-reports.js';
import { MAX_SAVED_VIEWS, MONTHLY_REPORTS, SavedReportViewRules, type ViewRange } from '../domain/index.js';
import type { FinancialReportsDeps } from './ports/financial-reports.js';
import type { SavedViewRecord } from './ports/extended-reports.js';
import { ReportContext } from './report-context.js';

const notFound = () => new DomainError('RESOURCE_NOT_FOUND', 'saved view not found');
const stale = () => new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version');

const dto = (r: SavedViewRecord): SavedReportViewDto => ({
  id: r.id,
  reportId: r.reportId,
  name: r.name,
  params: r.params,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Vistas guardadas de reportes (FR-REPORTING-019): guardar, listar, abrir con avisos, renombrar y borrar combinaciones de
 * reporte y filtros, PERSONALES por usuario y workspace (la RLS de `reporting.saved_report_view` filtra por ambos, así que
 * la vista de otro miembro es inexistente). Preferencia personal sin valor contable: borrado físico y sin auditoría
 * (decisión 3 del change). Una vista guarda solo ids y parámetros, nunca montos ni resultados.
 */
export class SavedReportViewsService {
  constructor(private readonly deps: FinancialReportsDeps) {}

  private repo() {
    const ext = this.deps.extended;
    if (!ext) throw new DomainError('SERVICE_UNAVAILABLE', 'the saved views are not configured');
    return ext.savedViews;
  }

  private ctxOf(userId: string, workspaceId: string) {
    return { userId, workspaceId };
  }

  list(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly reportId?: string;
  }): Promise<readonly SavedReportViewDto[]> {
    if (input.reportId !== undefined) SavedReportViewRules.reportId(input.reportId);
    return this.deps.uow.run(this.ctxOf(input.userId, input.workspaceId), async () =>
      (
        await this.repo().list({
          workspaceId: input.workspaceId,
          userId: input.userId,
          ...(input.reportId !== undefined ? { reportId: input.reportId } : {}),
        })
      ).map(dto),
    );
  }

  create(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly reportId: unknown;
    readonly name: unknown;
    readonly params: unknown;
  }): Promise<SavedReportViewDto> {
    const valid = SavedReportViewRules.validate(input);
    return this.deps.uow.run(this.ctxOf(input.userId, input.workspaceId), async () => {
      const repo = this.repo();
      const scope = { workspaceId: input.workspaceId, userId: input.userId };
      // El bloqueo serializa las altas del usuario: el tope y el nombre único se verifican sin carreras.
      if ((await repo.lockAndCount(scope)) >= MAX_SAVED_VIEWS) {
        throw new DomainError(
          'SAVED_VIEW_LIMIT_EXCEEDED',
          `a user can keep at most ${MAX_SAVED_VIEWS} saved views per workspace`,
        );
      }
      if (await repo.nameTaken({ ...scope, reportId: valid.reportId, name: valid.name })) {
        throw new DomainError('SAVED_VIEW_NAME_TAKEN', 'a view of this report already has that name').at(
          '/name',
        );
      }
      const now = this.deps.clock.now().toString();
      const record: SavedViewRecord = {
        id: uuidv7(),
        ...scope,
        reportId: valid.reportId,
        name: valid.name,
        params: valid.params,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repo.insert(record);
      return dto(record);
    });
  }

  update(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly viewId: string;
    readonly expectedVersion: number;
    readonly name?: unknown;
    readonly params?: unknown;
  }): Promise<SavedReportViewDto> {
    return this.deps.uow.run(this.ctxOf(input.userId, input.workspaceId), async () => {
      const repo = this.repo();
      const scope = { workspaceId: input.workspaceId, userId: input.userId };
      const current = await repo.find({ ...scope, id: input.viewId });
      if (!current) throw notFound();
      if (current.version !== input.expectedVersion) throw stale();
      const name = input.name === undefined ? current.name : SavedReportViewRules.name(input.name);
      const params = input.params === undefined ? current.params : SavedReportViewRules.params(input.params);
      if (await repo.nameTaken({ ...scope, reportId: current.reportId, name, exceptId: current.id })) {
        throw new DomainError('SAVED_VIEW_NAME_TAKEN', 'a view of this report already has that name').at(
          '/name',
        );
      }
      const updatedAt = this.deps.clock.now().toString();
      if (
        !(await repo.update({
          ...scope,
          id: current.id,
          expectedVersion: current.version,
          name,
          params,
          updatedAt,
        }))
      ) {
        throw stale();
      }
      return dto({ ...current, name, params, version: current.version + 1, updatedAt });
    });
  }

  delete(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly viewId: string;
  }): Promise<void> {
    return this.deps.uow.run(this.ctxOf(input.userId, input.workspaceId), async () => {
      const removed = await this.repo().delete({
        workspaceId: input.workspaceId,
        userId: input.userId,
        id: input.viewId,
      });
      if (!removed) throw notFound();
    });
  }

  /**
   * Abre la vista: el rango relativo se calcula desde hoy en la zona del workspace y los filtros que apuntan a una
   * categoría, cuenta, etiqueta o contraparte archivada o inexistente se avisan sin fallar.
   */
  open(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly viewId: string;
  }): Promise<OpenedSavedReportViewDto> {
    return this.deps.uow.run(this.ctxOf(input.userId, input.workspaceId), async () => {
      const scope = { workspaceId: input.workspaceId, userId: input.userId };
      const view = await this.repo().find({ ...scope, id: input.viewId });
      if (!view) throw notFound();
      const params = view.params;
      const grouping =
        (params['grouping'] as 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH' | undefined) ??
        (MONTHLY_REPORTS.includes(view.reportId) ? 'CALENDAR_MONTH' : 'FINANCIAL_PERIOD');
      const range = params['range'] as ViewRange | undefined;
      let resolved: { from: string; to: string } | null = null;
      if (range) {
        const { calendar, today } = await ReportContext.calendarFor(this.deps, input.workspaceId, grouping);
        resolved = SavedReportViewRules.resolveRange(range, calendar, today);
      }
      return {
        ...dto(view),
        query: SavedReportViewRules.query(params, resolved),
        warnings: await this.warningsOf(input.userId, input.workspaceId, params),
      };
    });
  }

  private async warningsOf(
    userId: string,
    workspaceId: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<SavedViewWarningDto[]> {
    const ids = (key: string) => (Array.isArray(params[key]) ? (params[key] as string[]) : []);
    const warnings: SavedViewWarningDto[] = [];
    const warn = (
      kind: SavedViewWarningDto['kind'],
      id: string,
      found: { name: string; archived: boolean } | undefined,
    ) => {
      if (!found) warnings.push({ code: 'MISSING_FILTER', kind, id, name: null });
      else if (found.archived) warnings.push({ code: 'ARCHIVED_FILTER', kind, id, name: found.name });
    };
    const categoryIds = ids('categoryIds');
    const tagIds = ids('tagIds');
    if (categoryIds.length > 0 || tagIds.length > 0) {
      const tree = await this.deps.categories.categoryTree({ userId, workspaceId });
      const categories = new Map(tree.categories.map((c) => [c.categoryId, c]));
      const tags = new Map(tree.tags.map((t) => [t.tagId, t]));
      for (const id of categoryIds) warn('CATEGORY', id, categories.get(id));
      for (const id of tagIds) warn('TAG', id, tags.get(id));
    }
    const accountIds = ids('accountIds');
    if (accountIds.length > 0) {
      const accounts = new Map(
        (await this.deps.accounts.listAccounts({ workspaceId, includeArchived: true })).map((a) => [
          a.accountId,
          { name: a.name, archived: a.status === ('ARCHIVED' as string) },
        ]),
      );
      for (const id of accountIds) warn('ACCOUNT', id, accounts.get(id));
    }
    const counterpartyIds = ids('counterpartyIds');
    const catalog = this.deps.extended?.counterparties;
    if (counterpartyIds.length > 0 && catalog) {
      const found = new Map(
        (await catalog.counterpartiesByIds({ workspaceId, counterpartyIds })).map((c) => [
          c.counterpartyId,
          { name: c.name, archived: c.archived },
        ]),
      );
      for (const id of counterpartyIds) warn('COUNTERPARTY', id, found.get(id));
    }
    return warnings;
  }
}
