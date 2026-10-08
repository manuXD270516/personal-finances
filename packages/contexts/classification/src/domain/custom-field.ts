import { DomainError } from '@pf/shared-kernel';
import { invalidTransition, validation } from './errors.js';
import { normalizeText } from './normalized-text.js';
import {
  CUSTOM_FIELD_DATA_TYPES,
  CUSTOM_FIELD_TARGETS,
  isCustomFieldDataType,
  isCustomFieldTarget,
  type CustomFieldDataType,
  type CustomFieldTarget,
} from './custom-field-value.js';

/** Clave `snake_case` (una letra minúscula + hasta 39 letras, dígitos o `_`), única entre las activas (decisión 7). */
export const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/u;
/** Clave de opción (estable, mismo alfabeto; puede empezar con dígito: "2026", "a1"). */
export const CUSTOM_FIELD_OPTION_KEY = /^[a-z0-9][a-z0-9_]{0,39}$/u;
/** Límites de la decisión 10. */
export const MAX_ACTIVE_CUSTOM_FIELDS = 50;
export const MAX_CUSTOM_FIELD_VALUES = 20;
export const MAX_CUSTOM_FIELD_OPTIONS = 50;

export interface CustomFieldOption {
  readonly key: string;
  readonly label: string;
  readonly position: number;
}

export interface CustomFieldOptionInput {
  readonly key: string;
  readonly label: string;
}

export interface CustomFieldDefinitionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: CustomFieldDataType;
  readonly target: CustomFieldTarget;
  readonly required: boolean;
  readonly options: readonly CustomFieldOption[];
  readonly position: number;
  readonly archivedAt: string | null;
  readonly version: number;
}

function checkLabel(raw: string, pointer: string): string {
  const label = raw.trim().replace(/\s+/gu, ' ');
  if (label.length < 1 || label.length > 80) throw validation('label must have 1..80 characters', pointer);
  return label;
}

function checkOptions(
  dataType: CustomFieldDataType,
  input: readonly CustomFieldOptionInput[],
): readonly CustomFieldOption[] {
  if (dataType !== 'SELECT') {
    if (input.length > 0) throw validation('only SELECT fields have options', '/options');
    return [];
  }
  if (input.length < 1) throw validation('a SELECT field needs at least one option', '/options');
  if (input.length > MAX_CUSTOM_FIELD_OPTIONS) {
    throw validation(`at most ${MAX_CUSTOM_FIELD_OPTIONS} options`, '/options');
  }
  const keys = new Set<string>();
  const labels = new Set<string>();
  return input.map((o, i) => {
    if (typeof o.key !== 'string' || !CUSTOM_FIELD_OPTION_KEY.test(o.key)) {
      throw validation('option key must match ^[a-z0-9][a-z0-9_]{0,39}$', `/options/${i}/key`);
    }
    if (typeof o.label !== 'string') throw validation('option label is required', `/options/${i}/label`);
    const label = checkLabel(o.label, `/options/${i}/label`);
    const normalized = normalizeText(label);
    if (keys.has(o.key)) throw validation('option keys must be unique', `/options/${i}/key`);
    if (labels.has(normalized)) throw validation('option labels must be unique', `/options/${i}/label`);
    keys.add(o.key);
    labels.add(normalized);
    return { key: o.key, label, position: i };
  });
}

export interface CustomFieldPatch {
  readonly label?: string;
  readonly required?: boolean;
  readonly position?: number;
  readonly dataType?: CustomFieldDataType;
  readonly target?: CustomFieldTarget;
  /** Reemplazo completo de la lista de opciones (el orden fija la posición). */
  readonly options?: readonly CustomFieldOptionInput[];
}

/** Uso de la definición por valores asignados (activos o históricos), consultado por la aplicación. */
export interface CustomFieldUsage {
  readonly hasValues: boolean;
  /** Claves de opción `SELECT` que algún valor usa. */
  readonly usedOptionKeys: ReadonlySet<string>;
}

/**
 * AR `CustomFieldDefinition` (design decisiones 1, 4, 5 y 7): clave inmutable, tipo/objetivo bloqueados cuando ya
 * hay valores, opciones con clave estable (no removibles en uso) y archivado suave (INV-019). No hay `delete`.
 */
export class CustomFieldDefinition {
  private constructor(private s: CustomFieldDefinitionSnapshot) {}

  static create(input: {
    id: string;
    workspaceId: string;
    key: string;
    label: string;
    dataType: string;
    target: string;
    required?: boolean;
    options?: readonly CustomFieldOptionInput[];
    position: number;
  }): CustomFieldDefinition {
    if (typeof input.key !== 'string' || !CUSTOM_FIELD_KEY.test(input.key)) {
      throw validation('key must match ^[a-z][a-z0-9_]{0,39}$', '/key');
    }
    if (!isCustomFieldDataType(input.dataType)) {
      throw validation(`dataType must be one of ${CUSTOM_FIELD_DATA_TYPES.join(', ')}`, '/dataType');
    }
    if (!isCustomFieldTarget(input.target)) {
      throw validation(`target must be one of ${CUSTOM_FIELD_TARGETS.join(', ')}`, '/target');
    }
    return new CustomFieldDefinition({
      id: input.id,
      workspaceId: input.workspaceId,
      key: input.key,
      label: checkLabel(String(input.label ?? ''), '/label'),
      dataType: input.dataType,
      target: input.target,
      required: input.required ?? false,
      options: checkOptions(input.dataType, input.options ?? []),
      position: input.position,
      archivedAt: null,
      version: 1,
    });
  }

  static restore(s: CustomFieldDefinitionSnapshot): CustomFieldDefinition {
    return new CustomFieldDefinition({ ...s, options: s.options.map((o) => ({ ...o })) });
  }

  get id(): string {
    return this.s.id;
  }
  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get key(): string {
    return this.s.key;
  }
  get label(): string {
    return this.s.label;
  }
  get dataType(): CustomFieldDataType {
    return this.s.dataType;
  }
  get target(): CustomFieldTarget {
    return this.s.target;
  }
  get required(): boolean {
    return this.s.required;
  }
  get options(): readonly CustomFieldOption[] {
    return this.s.options;
  }
  get optionKeys(): readonly string[] {
    return this.s.options.map((o) => o.key);
  }
  get position(): number {
    return this.s.position;
  }
  get archivedAt(): string | null {
    return this.s.archivedAt;
  }
  get isArchived(): boolean {
    return this.s.archivedAt !== null;
  }
  get version(): number {
    return this.s.version;
  }

  snapshot(): CustomFieldDefinitionSnapshot {
    return { ...this.s, options: this.s.options.map((o) => ({ ...o })) };
  }

  /**
   * Aplica un parche. Con valores asignados el tipo y el objetivo no cambian (`CUSTOM_FIELD_TYPE_LOCKED`) y una
   * opción en uso no se elimina (`CUSTOM_FIELD_OPTION_IN_USE`); agregar opciones y renombrarlas sí. Devuelve `false`
   * si el parche no cambia nada (sin versión nueva).
   */
  update(patch: CustomFieldPatch, usage: CustomFieldUsage): boolean {
    if (this.isArchived) throw new DomainError('CUSTOM_FIELD_ARCHIVED', 'the custom field is archived');
    const dataType = patch.dataType ?? this.s.dataType;
    const target = patch.target ?? this.s.target;
    if (!isCustomFieldDataType(dataType)) {
      throw validation(`dataType must be one of ${CUSTOM_FIELD_DATA_TYPES.join(', ')}`, '/dataType');
    }
    if (!isCustomFieldTarget(target)) {
      throw validation(`target must be one of ${CUSTOM_FIELD_TARGETS.join(', ')}`, '/target');
    }
    if (usage.hasValues && (dataType !== this.s.dataType || target !== this.s.target)) {
      throw new DomainError(
        'CUSTOM_FIELD_TYPE_LOCKED',
        'the type and target of a field with values cannot change',
      ).at(dataType !== this.s.dataType ? '/dataType' : '/target');
    }
    const label = patch.label === undefined ? this.s.label : checkLabel(patch.label, '/label');
    const required = patch.required ?? this.s.required;
    const position = patch.position ?? this.s.position;
    const optionsInput =
      patch.options ??
      (dataType === this.s.dataType ? this.s.options.map(({ key, label: l }) => ({ key, label: l })) : []);
    const options = checkOptions(dataType, optionsInput);
    const kept = new Set(options.map((o) => o.key));
    for (const used of usage.usedOptionKeys) {
      if (!kept.has(used)) {
        throw new DomainError('CUSTOM_FIELD_OPTION_IN_USE', `option '${used}' is used by existing values`).at(
          '/options',
        );
      }
    }
    const unchanged =
      label === this.s.label &&
      required === this.s.required &&
      position === this.s.position &&
      dataType === this.s.dataType &&
      target === this.s.target &&
      JSON.stringify(options) === JSON.stringify(this.s.options);
    if (unchanged) return false;
    this.s = { ...this.s, label, required, position, dataType, target, options, version: this.s.version + 1 };
    return true;
  }

  archive(at: string): void {
    if (this.isArchived) throw invalidTransition('custom field is already archived');
    this.s = { ...this.s, archivedAt: at, version: this.s.version + 1 };
  }

  unarchive(): void {
    if (!this.isArchived) throw invalidTransition('custom field is not archived');
    this.s = { ...this.s, archivedAt: null, version: this.s.version + 1 };
  }
}
