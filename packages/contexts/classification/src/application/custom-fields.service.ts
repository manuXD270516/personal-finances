import type { AuditChangeInput, AuditEntry } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  CustomFieldDefinition,
  MAX_ACTIVE_CUSTOM_FIELDS,
  type CustomFieldOptionInput,
  type CustomFieldPatch,
} from '../domain/custom-field.js';
import { notFound, validation } from '../domain/errors.js';
import type { ClassificationDeps } from './ports/index.js';

export interface DefineCustomFieldCommand {
  readonly id?: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly target: string;
  readonly required?: boolean;
  readonly options?: readonly CustomFieldOptionInput[];
  readonly position?: number;
}

type Snap = Readonly<Record<string, unknown>>;
type Change = 'DEFINED' | 'UPDATED' | 'ARCHIVED' | 'UNARCHIVED';

const CUSTOM_FIELD_AUDIT_FIELDS = [
  'key',
  'label',
  'dataType',
  'target',
  'required',
  'options',
  'position',
  'status',
] as const;

/** 412 con la versión vigente (`currentVersion`, docs/10 §6). */
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

/** Los valores compuestos de auditoría viajan como texto JSON (AUDIT solo admite escalares). */
const view = (f: CustomFieldDefinition): Snap => {
  const s = f.snapshot();
  return {
    key: s.key,
    label: s.label,
    dataType: s.dataType,
    target: s.target,
    required: s.required,
    options: JSON.stringify(s.options.map(({ key, label }) => ({ key, label }))),
    position: s.position,
    status: s.archivedAt === null ? 'ACTIVE' : 'ARCHIVED',
  };
};

function diff(before: Snap | null, after: Snap): AuditChangeInput[] {
  return CUSTOM_FIELD_AUDIT_FIELDS.filter(
    (f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after[f] ?? null),
  ).map((f) => ({ field: f, before: before?.[f] ?? null, after: after[f] ?? null }));
}

/**
 * Comandos de definiciones de custom fields (openspec add-custom-fields, FR-CLASSIFICATION-009). Cada mutación corre
 * en una `UnitOfWork` con RLS, se audita en la misma transacción (INV-029) y emite
 * `classification.CustomFieldDefinitionChanged.v1` por el outbox. Sin `delete` (INV-019). La autorización por rol
 * (EDITOR+) la aplica el guard de la API (`x-required-role`). Las definiciones no tienen máquina de estados.
 */
export class CustomFieldsService {
  constructor(private readonly deps: ClassificationDeps) {}

  private now(): string {
    return this.deps.clock.now().toString();
  }

  private run<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.uow.run({ userId, workspaceId }, fn);
  }

  async define(
    userId: string,
    workspaceId: string,
    cmd: DefineCustomFieldCommand,
  ): Promise<CustomFieldDefinition> {
    return this.run(userId, workspaceId, async () => {
      const all = await this.deps.customFields.listAll(workspaceId);
      const field = CustomFieldDefinition.create({
        id: cmd.id ?? this.deps.ids.next(),
        workspaceId,
        key: cmd.key,
        label: cmd.label,
        dataType: cmd.dataType,
        target: cmd.target,
        ...(cmd.required === undefined ? {} : { required: cmd.required }),
        ...(cmd.options === undefined ? {} : { options: cmd.options }),
        position: cmd.position ?? all.reduce((max, f) => Math.max(max, f.position), -1) + 1,
      });
      this.assertKeyFree(field, all);
      this.assertRoom(all);
      await this.deps.customFields.insert(field);
      await this.emit(userId, field, 'DEFINED');
      await this.audit(userId, 'defined', null, field);
      return field;
    });
  }

  async update(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: CustomFieldPatch,
  ): Promise<CustomFieldDefinition> {
    return this.run(userId, workspaceId, async () => {
      const field = await this.load(workspaceId, id, expectedVersion);
      const before = view(field);
      const usage = await this.deps.customFieldUsage.usageOf(workspaceId, id);
      if (!field.update(patch, usage)) return field;
      await this.save(field, expectedVersion);
      await this.emit(userId, field, 'UPDATED');
      await this.audit(userId, 'updated', before, field);
      return field;
    });
  }

  async archive(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<CustomFieldDefinition> {
    return this.run(userId, workspaceId, async () => {
      const field = await this.load(workspaceId, id, expectedVersion);
      const before = view(field);
      field.archive(this.now());
      await this.save(field, expectedVersion);
      await this.emit(userId, field, 'ARCHIVED');
      await this.audit(userId, 'archived', before, field);
      return field;
    });
  }

  async unarchive(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<CustomFieldDefinition> {
    return this.run(userId, workspaceId, async () => {
      const field = await this.load(workspaceId, id, expectedVersion);
      const before = view(field);
      field.unarchive();
      const all = await this.deps.customFields.listAll(workspaceId);
      this.assertKeyFree(field, all);
      this.assertRoom(all);
      await this.save(field, expectedVersion);
      await this.emit(userId, field, 'UNARCHIVED');
      await this.audit(userId, 'unarchived', before, field);
      return field;
    });
  }

  // ------------------------------------------------------------------ helpers

  private async load(workspaceId: string, id: string, expected: number): Promise<CustomFieldDefinition> {
    const f = await this.deps.customFields.findById(workspaceId, id);
    if (!f) throw notFound('custom field');
    if (f.version !== expected) throw preconditionFailed(f.version);
    return f;
  }

  private async save(field: CustomFieldDefinition, expected: number): Promise<void> {
    if (!(await this.deps.customFields.update(field, expected))) {
      throw preconditionFailed((await this.deps.customFields.findById(field.workspaceId, field.id))?.version);
    }
  }

  /** La clave es única entre las activas (decisión 7); el índice parcial de la BD es la defensa. */
  private assertKeyFree(field: CustomFieldDefinition, all: readonly CustomFieldDefinition[]): void {
    const clash = all.find((f) => f.id !== field.id && !f.isArchived && f.key === field.key);
    if (clash && !field.isArchived) {
      throw new DomainError('CUSTOM_FIELD_KEY_TAKEN', 'an active custom field already uses this key', {
        details: { existingId: clash.id },
      }).at('/key');
    }
  }

  private assertRoom(all: readonly CustomFieldDefinition[]): void {
    if (all.filter((f) => !f.isArchived).length >= MAX_ACTIVE_CUSTOM_FIELDS) {
      throw validation(`at most ${MAX_ACTIVE_CUSTOM_FIELDS} active custom fields per workspace`, '');
    }
  }

  private async emit(userId: string, f: CustomFieldDefinition, change: Change): Promise<void> {
    await this.deps.outbox.append({
      eventId: this.deps.ids.next(),
      eventType: 'classification.CustomFieldDefinitionChanged',
      eventVersion: 1,
      aggregateType: 'CustomFieldDefinition',
      aggregateId: f.id,
      aggregateVersion: f.version,
      workspaceId: f.workspaceId,
      occurredAt: this.now(),
      actor: { type: 'USER', id: userId },
      payload: { fieldId: f.id, key: f.key, change, dataType: f.dataType, target: f.target },
    });
  }

  private async audit(userId: string, verb: string, before: Snap | null, f: CustomFieldDefinition) {
    const entry: Omit<AuditEntry, 'actor'> & { readonly changes: readonly AuditChangeInput[] } = {
      workspaceId: f.workspaceId,
      action: `classification.custom_field.${verb}`,
      aggregateType: 'CustomFieldDefinition',
      aggregateId: f.id,
      aggregateVersion: f.version,
      changes: diff(before, view(f)),
    };
    await this.deps.audit.append({ ...entry, actor: { type: 'USER', userId } });
  }
}
