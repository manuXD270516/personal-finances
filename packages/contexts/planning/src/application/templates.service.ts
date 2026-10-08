import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  BudgetTemplate,
  buildTemplateLines,
  parseOptionalText,
  parseTemplateName,
  type TemplateLine,
  type TemplateVersion,
} from '../domain/index.js';
import { loadTargetTree, planCurrency } from './budget-calculator.js';
import type { BudgetsDeps } from './ports/index.js';
import { toTemplateDto, type TemplateDto } from './template-view.js';

const AGGREGATE = 'BudgetTemplate';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `budget template ${id} not found`);

/** Líneas de una versión como texto JSON compacto para la auditoría (docs/31 D19: valores compuestos como texto). */
export function linesAuditJson(lines: readonly TemplateLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      target: `${l.target.kind}:${l.target.id}`,
      kind: l.spec.kind,
      planned: l.spec.planned,
      min: l.spec.min,
      max: l.spec.max,
      percent: l.spec.percent,
      incomeBasis: l.spec.incomeBasis,
      rolloverPolicy: l.spec.rolloverPolicy,
      rolloverCap: l.spec.rolloverCap,
      thresholds: l.spec.thresholds,
      currency: l.currency,
    })),
  );
}

export interface CreateTemplateInput {
  readonly workspaceId: string;
  readonly name: unknown;
  readonly description?: unknown;
  readonly lines: unknown;
}

export interface PublishVersionInput {
  readonly workspaceId: string;
  readonly templateId: string;
  readonly baseVersionNo: unknown;
  readonly lines: unknown;
  readonly changeNote?: unknown;
}

/**
 * Comandos de templates (openspec add-budget-templates decisiones 1, 5, 8 y 9): cada uno corre en UNA unidad de
 * trabajo con el template bloqueado `FOR UPDATE`, auditoría síncrona (INV-029) y sin eventos (decisión 10). El rol
 * (VIEWER lee; EDITOR/OWNER escriben) lo aplica el contrato (`x-required-role`). Las versiones y líneas son WS-RO.
 */
export class TemplatesService {
  constructor(private readonly deps: BudgetsDeps) {}

  /** `CreateTemplate`: template activo con su versión 1; nombre único entre activos (`NAME_TAKEN`). */
  async createTemplate(input: CreateTemplateInput): Promise<TemplateDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const name = parseTemplateName(input.name);
    const description = parseOptionalText(input.description, 'description', 500);
    const currency = await this.baseCurrency(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      await this.assertNameFree(workspaceId, name);
      const tree = await loadTargetTree(deps, workspaceId);
      const lines = buildTemplateLines({
        lines: input.lines,
        currency,
        tree,
        base: [],
        nextId: () => deps.ids.next(),
      });
      const now = deps.clock.now().toString();
      const template = BudgetTemplate.create({
        id: deps.ids.next(),
        workspaceId,
        name,
        description,
        firstVersion: {
          id: deps.ids.next(),
          versionNo: 1,
          basedOnVersionNo: null,
          changeNote: null,
          createdAt: now,
          createdBy: this.actorId(),
          lines,
        },
        at: now,
      });
      await deps.templates.insert(template);
      template.markPersisted();
      await deps.audit.append({
        workspaceId,
        action: 'planning.template.created',
        aggregateType: AGGREGATE,
        aggregateId: template.id,
        aggregateVersion: template.version,
        changes: [
          { field: 'name', before: null, after: name },
          { field: 'description', before: null, after: description },
          { field: 'status', before: null, after: 'ACTIVE' },
          { field: 'versionNo', before: null, after: 1 },
          { field: 'lineCount', before: null, after: lines.length },
          { field: 'lines', before: null, after: linesAuditJson(lines) },
        ],
      });
      return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
    });
  }

  /** `PublishTemplateVersion`: instantánea completa N+1; `baseVersionNo` distinto de la vigente => 409. */
  async publishVersion(input: PublishVersionInput): Promise<TemplateDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const baseVersionNo = input.baseVersionNo;
    if (typeof baseVersionNo !== 'number' || !Number.isInteger(baseVersionNo) || baseVersionNo < 1) {
      throw new DomainError('VALIDATION_FAILED', 'baseVersionNo must be a positive integer').at(
        '/baseVersionNo',
      );
    }
    const changeNote = parseOptionalText(input.changeNote, 'changeNote', 500);
    const currency = await this.baseCurrency(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const template = await this.lock(workspaceId, input.templateId);
      template.assertActive();
      if (baseVersionNo !== template.currentVersionNo) {
        throw new DomainError(
          'CONCURRENCY_CONFLICT',
          `template ${template.name} is at version ${template.currentVersionNo}, not ${baseVersionNo}`,
          { details: { currentVersionNo: template.currentVersionNo } },
        );
      }
      const before = template.currentVersion;
      const tree = await loadTargetTree(deps, workspaceId);
      const lines = buildTemplateLines({
        lines: input.lines,
        currency,
        tree,
        base: before.lines,
        nextId: () => deps.ids.next(),
      });
      const now = deps.clock.now().toString();
      const next = template.publishVersion({
        baseVersionNo,
        versionId: deps.ids.next(),
        lines,
        changeNote,
        by: this.actorId(),
        at: now,
      });
      await this.persistVersion(template);
      await deps.audit.append({
        workspaceId,
        action: 'planning.template.version_published',
        aggregateType: AGGREGATE,
        aggregateId: template.id,
        aggregateVersion: template.version,
        changes: versionChanges(before, next),
      });
      return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
    });
  }

  /** `CloneTemplate`: template nuevo e independiente con las líneas de una versión (por defecto la vigente). */
  async cloneTemplate(input: {
    readonly workspaceId: string;
    readonly templateId: string;
    readonly name: unknown;
    readonly versionNo?: unknown;
  }): Promise<TemplateDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const name = parseTemplateName(input.name);
    const versionNo = optionalVersionNo(input.versionNo);
    return deps.uow.run(workspaceId, async () => {
      const source = await deps.templates.findById(workspaceId, input.templateId);
      if (!source) throw notFound(input.templateId);
      const version =
        versionNo === undefined || versionNo === source.currentVersionNo
          ? source.currentVersion
          : await deps.templates.findVersion(workspaceId, source.id, versionNo);
      if (!version) {
        throw new DomainError(
          'REFERENCE_NOT_FOUND',
          `version ${versionNo} of template ${source.name} not found`,
        ).at('/versionNo');
      }
      await this.assertNameFree(workspaceId, name);
      const now = deps.clock.now().toString();
      const lines = version.lines.map((l) => ({ ...l, id: deps.ids.next() }));
      const template = BudgetTemplate.create({
        id: deps.ids.next(),
        workspaceId,
        name,
        description: source.snapshot.description,
        firstVersion: {
          id: deps.ids.next(),
          versionNo: 1,
          basedOnVersionNo: null,
          changeNote: null,
          createdAt: now,
          createdBy: this.actorId(),
          lines,
        },
        at: now,
      });
      await deps.templates.insert(template);
      template.markPersisted();
      await deps.audit.append({
        workspaceId,
        action: 'planning.template.cloned',
        aggregateType: AGGREGATE,
        aggregateId: template.id,
        aggregateVersion: template.version,
        changes: [
          { field: 'name', before: null, after: name },
          { field: 'status', before: null, after: 'ACTIVE' },
          { field: 'clonedFromTemplateId', before: null, after: source.id },
          { field: 'clonedFromVersionNo', before: null, after: version.versionNo },
          { field: 'versionNo', before: null, after: 1 },
          { field: 'lineCount', before: null, after: lines.length },
          { field: 'lines', before: null, after: linesAuditJson(lines) },
        ],
      });
      return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
    });
  }

  /** `ArchiveTemplate`: nunca se borra; deja de ser predeterminado y no puede aplicarse. Idempotente. */
  async archive(input: { workspaceId: string; templateId: string }): Promise<TemplateDto> {
    return this.mutate(input, 'planning.template.archived', (template) => {
      const wasDefault = template.isDefault;
      if (!template.archive()) return null;
      const changes: AuditChangeInput[] = [{ field: 'status', before: 'ACTIVE', after: 'ARCHIVED' }];
      if (wasDefault) changes.push({ field: 'isDefault', before: true, after: false });
      return changes;
    });
  }

  /** `UnarchiveTemplate`: el nombre debe seguir libre entre los activos (`NAME_TAKEN`). */
  async unarchive(input: { workspaceId: string; templateId: string }): Promise<TemplateDto> {
    return this.mutate(
      input,
      'planning.template.unarchived',
      (template) => {
        if (!template.unarchive()) return null;
        return [{ field: 'status', before: 'ARCHIVED', after: 'ACTIVE' }];
      },
      async (template) => {
        if (template.status === 'ARCHIVED') await this.assertNameFree(input.workspaceId, template.name);
      },
    );
  }

  /** `SetDefaultTemplate`: a lo sumo uno; el anterior se desmarca en la misma transacción. */
  async setDefault(input: { workspaceId: string; templateId: string }): Promise<TemplateDto> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      await deps.templates.lockDefaults(workspaceId);
      const template = await this.lock(workspaceId, input.templateId);
      template.assertActive();
      if (!template.setDefault()) {
        return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
      }
      const previous = await deps.templates.findDefault(workspaceId);
      if (previous && previous.id !== template.id) {
        previous.clearDefault();
        await this.persist(previous);
        await deps.audit.append({
          workspaceId,
          action: 'planning.template.default_cleared',
          aggregateType: AGGREGATE,
          aggregateId: previous.id,
          aggregateVersion: previous.version,
          changes: [{ field: 'isDefault', before: true, after: false }],
        });
      }
      await this.persist(template);
      await deps.audit.append({
        workspaceId,
        action: 'planning.template.default_set',
        aggregateType: AGGREGATE,
        aggregateId: template.id,
        aggregateVersion: template.version,
        changes: [{ field: 'isDefault', before: false, after: true }],
      });
      return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
    });
  }

  // ------------------------------------------------------------------ internos

  private async mutate(
    input: { workspaceId: string; templateId: string },
    action: string,
    apply: (template: BudgetTemplate) => AuditChangeInput[] | null,
    precheck?: (template: BudgetTemplate) => Promise<void>,
  ): Promise<TemplateDto> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      const template = await this.lock(workspaceId, input.templateId);
      if (precheck) await precheck(template);
      const changes = apply(template);
      if (changes) {
        await this.persist(template);
        await deps.audit.append({
          workspaceId,
          action,
          aggregateType: AGGREGATE,
          aggregateId: template.id,
          aggregateVersion: template.version,
          changes,
        });
      }
      return toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id));
    });
  }

  private async lock(workspaceId: string, templateId: string): Promise<BudgetTemplate> {
    const template = await this.deps.templates.findById(workspaceId, templateId, { lock: 'update' });
    if (!template) throw notFound(templateId);
    return template;
  }

  private async persist(template: BudgetTemplate): Promise<void> {
    if (!(await this.deps.templates.save(template))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the template was modified concurrently');
    }
    template.markPersisted();
  }

  private async persistVersion(template: BudgetTemplate): Promise<void> {
    await this.persist(template);
    await this.deps.templates.insertCurrentVersion(template);
  }

  private async assertNameFree(workspaceId: string, name: string): Promise<void> {
    if (await this.deps.templates.findActiveByName(workspaceId, name)) {
      throw new DomainError('NAME_TAKEN', `an active template is already named ${name}`).at('/name');
    }
  }

  private async baseCurrency(workspaceId: string) {
    const { deps } = this;
    if (!deps.settings) throw new Error('BudgetsDeps.settings is required to publish templates');
    const settings = await deps.settings.settingsOf(workspaceId);
    return planCurrency(deps, workspaceId, settings.baseCurrency);
  }

  private actorId(): string | null {
    const id = this.deps.actor.userId();
    return id === '' ? null : id;
  }
}

function optionalVersionNo(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new DomainError('VALIDATION_FAILED', 'versionNo must be a positive integer').at('/versionNo');
  }
  return raw;
}

/** Cambios de una versión nueva respecto de la vigente (para el audit log). */
function versionChanges(before: TemplateVersion, next: TemplateVersion): AuditChangeInput[] {
  return [
    { field: 'versionNo', before: before.versionNo, after: next.versionNo },
    { field: 'changeNote', before: null, after: next.changeNote },
    { field: 'lineCount', before: before.lines.length, after: next.lines.length },
    { field: 'lines', before: linesAuditJson(before.lines), after: linesAuditJson(next.lines) },
  ];
}
