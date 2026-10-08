import { DomainError } from '@pf/shared-kernel';
import type {
  CustomFieldValueInputDto,
  CustomFieldValuesItemDto,
  CustomFieldValuesResultDto,
  ValidatedCustomFieldValueDto,
} from '../contracts/index.js';
import { MAX_CUSTOM_FIELD_VALUES, type CustomFieldDefinition } from '../domain/custom-field.js';
import { normalizeCustomFieldValue, type CustomFieldTarget } from '../domain/custom-field-value.js';
import { notFound, referenceNotFound, validation } from '../domain/errors.js';
import type { ClassificationDeps } from './ports/index.js';

const byPosition = (a: CustomFieldDefinition, b: CustomFieldDefinition) =>
  a.position - b.position || a.key.localeCompare(b.key) || a.id.localeCompare(b.id);

/**
 * Consultas de custom fields (VIEWER+) y `ValidateCustomFieldValues`, la query pública que invocan TRANSACTIONS y
 * ACCOUNTS (openspec add-custom-fields, FR-CLASSIFICATION-009). Sin efectos.
 */
export class CustomFieldsQueries {
  constructor(private readonly deps: ClassificationDeps) {}

  private run<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.uow.run({ userId, workspaceId }, fn);
  }

  list(
    userId: string,
    workspaceId: string,
    f: { readonly target?: CustomFieldTarget; readonly includeArchived?: boolean } = {},
  ): Promise<CustomFieldDefinition[]> {
    return this.run(userId, workspaceId, async () =>
      (await this.deps.customFields.listAll(workspaceId))
        .filter(
          (d) =>
            (f.includeArchived === true || !d.isArchived) &&
            (f.target === undefined || d.target === f.target),
        )
        .sort(byPosition),
    );
  }

  get(userId: string, workspaceId: string, id: string): Promise<CustomFieldDefinition> {
    return this.run(userId, workspaceId, async () => {
      const f = await this.deps.customFields.findById(workspaceId, id);
      if (!f) throw notFound('custom field');
      return f;
    });
  }

  /**
   * Valida los valores de cada registro (split o cuenta) de la entidad `target`. Cada entrada fija o quita (`null`) el
   * valor de UN campo; lo no mencionado no cambia. Con `requireMandatory`, tras aplicar la entrada cada campo
   * obligatorio activo del `target` debe tener valor (creación y edición de custom fields; decisión 6).
   */
  validateCustomFieldValues(
    userId: string,
    workspaceId: string,
    input: {
      readonly target: CustomFieldTarget;
      readonly requireMandatory: boolean;
      readonly items: readonly CustomFieldValuesItemDto[];
    },
  ): Promise<CustomFieldValuesResultDto[]> {
    return this.run(userId, workspaceId, async () => {
      const all = await this.deps.customFields.listAll(workspaceId);
      const byId = new Map(all.map((d) => [d.id, d]));
      const activeByKey = new Map(all.filter((d) => !d.isArchived).map((d) => [d.key, d]));
      const archivedByKey = new Map(all.filter((d) => d.isArchived).map((d) => [d.key, d]));
      const mandatory = all.filter((d) => !d.isArchived && d.required && d.target === input.target);
      const resolve = (v: CustomFieldValueInputDto, ptr: string): CustomFieldDefinition => {
        if (v.fieldId === undefined && v.key === undefined) {
          throw validation('fieldId or key is required', ptr);
        }
        const def =
          v.fieldId === undefined
            ? (activeByKey.get(v.key as string) ?? archivedByKey.get(v.key as string))
            : byId.get(v.fieldId);
        if (!def) {
          throw referenceNotFound('custom field', `${ptr}/${v.fieldId === undefined ? 'key' : 'fieldId'}`);
        }
        return def;
      };
      return input.items.map((item) => {
        const set: ValidatedCustomFieldValueDto[] = [];
        const remove: string[] = [];
        const seen = new Set<string>();
        for (const [i, v] of item.values.entries()) {
          const ptr = `${item.pointer}/${i}`;
          const def = resolve(v, ptr);
          if (def.target !== input.target) {
            throw new DomainError(
              'CUSTOM_FIELD_TARGET_MISMATCH',
              `custom field '${def.key}' applies to ${def.target}, not ${input.target}`,
            ).at(ptr);
          }
          if (def.isArchived) {
            throw new DomainError('CUSTOM_FIELD_ARCHIVED', `custom field '${def.key}' is archived`).at(ptr);
          }
          if (seen.has(def.id)) throw validation(`custom field '${def.key}' appears twice`, ptr);
          seen.add(def.id);
          if (v.value === null) {
            remove.push(def.id);
            continue;
          }
          const n = normalizeCustomFieldValue(
            { dataType: def.dataType, optionKeys: def.optionKeys },
            v.value,
            `${ptr}/value`,
          );
          set.push({ fieldId: def.id, key: def.key, valueType: n.valueType, value: n.value });
        }
        const final = new Set(item.existingFieldIds ?? []);
        for (const s of set) final.add(s.fieldId);
        for (const r of remove) final.delete(r);
        if (final.size > MAX_CUSTOM_FIELD_VALUES) {
          throw validation(`at most ${MAX_CUSTOM_FIELD_VALUES} custom field values per record`, item.pointer);
        }
        if (input.requireMandatory) {
          const missing = mandatory.find((d) => !final.has(d.id));
          if (missing) {
            throw new DomainError('CUSTOM_FIELD_REQUIRED', `custom field '${missing.key}' is required`).at(
              item.pointer,
            );
          }
        }
        return { set, removeFieldIds: remove };
      });
    });
  }
}
