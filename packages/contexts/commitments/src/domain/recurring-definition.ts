import { DomainError, LocalDate } from '@pf/shared-kernel';
import type { DefinitionVersion } from './definition-version.js';
import {
  RECURRING_DEFINITION_LIFECYCLE,
  type DefinitionStatus,
  type DefinitionTransition,
  type DefinitionTransitionRecord,
} from './lifecycle.js';
import type { ManagedBy, RecurringKind } from './types.js';

export interface DefinitionState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly kind: RecurringKind;
  readonly managedBy: ManagedBy;
  readonly managedRef: string | null;
  readonly status: DefinitionStatus;
  readonly currentVersionNo: number;
  /** Última fecha nominal hasta la que se generó (ventana deslizante, high-water mark). */
  readonly generatedThrough: string | null;
  /** Fecha de fin fijada por "terminar" (cierra la serie; el estado pasa a ENDED al superarla). */
  readonly endDate: string | null;
  readonly endedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

export interface Annotation {
  readonly name?: string;
  readonly description?: string | null;
  readonly notes?: string | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const text = (value: string | null | undefined, max: number, pointer: string): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new DomainError('VALIDATION_FAILED', `must have at most ${max} characters`).at(pointer);
  }
  return trimmed;
};

export function validName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new DomainError('VALIDATION_FAILED', 'name must have between 1 and 120 characters').at('/name');
  }
  return name;
}

/**
 * AR `RecurringDefinition` (COMMITMENTS; design decisiones 3, 4, 8, 14 y 15): cabecera mutable más versiones
 * inmutables y append-only de la plantilla. Sus transiciones se validan contra `RECURRING_DEFINITION_LIFECYCLE`; el
 * nombre, la descripción y las notas son anotaciones. Cada cambio publicado sube `version` (el outbox exige una versión
 * distinta por evento del mismo agregado).
 */
export class RecurringDefinition {
  private transition: DefinitionTransitionRecord | null = null;
  private fieldsChanged: string[] = [];
  private newVersions: DefinitionVersion[] = [];

  private constructor(
    private state: DefinitionState,
    private readonly all: DefinitionVersion[],
    private persisted: number,
  ) {}

  /** Versión leída o escrita por última vez en la base (control optimista). */
  get persistedVersion(): number {
    return this.persisted;
  }

  /** El repositorio lo invoca tras insertar o guardar: la versión actual pasa a ser la persistida. */
  markPersisted(): void {
    this.persisted = this.state.version;
    this.newVersions = [];
  }

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly description?: string | null | undefined;
    readonly notes?: string | null | undefined;
    readonly kind: RecurringKind;
    readonly managedBy?: ManagedBy;
    readonly managedRef?: string | null;
    readonly version1: DefinitionVersion;
    readonly at: string;
    readonly by: string | null;
  }): RecurringDefinition {
    const definition = new RecurringDefinition(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: validName(input.name),
        description: text(input.description, 1000, '/description'),
        notes: text(input.notes, 2000, '/notes'),
        kind: input.kind,
        managedBy: input.managedBy ?? 'USER',
        managedRef: input.managedRef ?? null,
        status: 'ACTIVE',
        currentVersionNo: 1,
        generatedThrough: null,
        endDate: null,
        endedAt: null,
        version: 1,
        createdAt: input.at,
        createdBy: input.by,
        updatedAt: input.at,
        updatedBy: input.by,
      },
      [input.version1],
      0,
    );
    definition.newVersions = [input.version1];
    definition.mark('CREATE', null, 'ACTIVE');
    return definition;
  }

  static restore(state: DefinitionState, versions: readonly DefinitionVersion[]): RecurringDefinition {
    const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
    return new RecurringDefinition({ ...state }, sorted, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get name(): string {
    return this.state.name;
  }
  get kind(): RecurringKind {
    return this.state.kind;
  }
  get status(): DefinitionStatus {
    return this.state.status;
  }
  get endDate(): string | null {
    return this.state.endDate;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): DefinitionState {
    return { ...this.state };
  }
  get versions(): readonly DefinitionVersion[] {
    return this.all;
  }
  /** Versiones agregadas en esta instancia (el repositorio las inserta; son inmutables). */
  get addedVersions(): readonly DefinitionVersion[] {
    return this.newVersions;
  }
  get current(): DefinitionVersion {
    return this.versionNo(this.state.currentVersionNo);
  }
  get lastTransition(): DefinitionTransitionRecord | null {
    return this.transition;
  }
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }

  versionNo(no: number): DefinitionVersion {
    const found = this.all.find((v) => v.versionNo === no);
    if (!found) throw new Error(`definition ${this.state.id} has no version ${no}`);
    return found;
  }

  /** Versión vigente para una fecha nominal: la última con `effectiveFrom ≤ fecha`. */
  versionAt(date: LocalDate): DefinitionVersion {
    let chosen = this.all[0] as DefinitionVersion;
    for (const v of this.all) if (LocalDate.parse(v.effectiveFrom).compare(date) <= 0) chosen = v;
    return chosen;
  }

  /** Anotación: nombre, descripción o notas (sin versión de plantilla ni transición). */
  annotate(changes: Annotation, at: string, by: string | null): void {
    const patch: Partial<Mutable<DefinitionState>> = {};
    const fields: string[] = [];
    if (changes.name !== undefined && validName(changes.name) !== this.state.name) {
      patch.name = validName(changes.name);
      fields.push('name');
    }
    if (changes.description !== undefined) {
      const value = text(changes.description, 1000, '/description');
      if (value !== this.state.description) {
        patch.description = value;
        fields.push('description');
      }
    }
    if (changes.notes !== undefined) {
      const value = text(changes.notes, 2000, '/notes');
      if (value !== this.state.notes) {
        patch.notes = value;
        fields.push('notes');
      }
    }
    if (fields.length === 0) return;
    this.apply(patch, at, by);
    this.fieldsChanged = fields;
  }

  pause(at: string, by: string | null): void {
    this.step('PAUSE', 'PAUSED', {}, at, by);
  }

  resume(at: string, by: string | null): void {
    this.step('RESUME', 'ACTIVE', {}, at, by);
  }

  /**
   * `END` inmediato (o automático al superar la fecha de fin / agotar la serie). Una definición terminada no se
   * reanuda ni se revisa (`INVALID_STATUS_TRANSITION`).
   */
  end(input: { readonly endDate: string; readonly at: string; readonly by: string | null }): void {
    this.step('END', 'ENDED', { endDate: input.endDate, endedAt: input.at }, input.at, input.by);
  }

  /** Fija una fecha de fin futura (la serie se cierra ahí; el estado sigue igual hasta superarla). */
  scheduleEnd(endDate: string, at: string, by: string | null): void {
    if (this.state.status === 'ENDED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'the definition has already ended');
    }
    // Valida contra la máquina que `END` es posible desde el estado actual.
    RECURRING_DEFINITION_LIFECYCLE.transition('END', this.state.status, 'ENDED');
    this.apply({ endDate }, at, by);
    this.fieldsChanged = ['endDate'];
  }

  /** `REVISE`: agrega la versión `n+1` (inmutable) y la hace vigente. El estado no cambia. */
  revise(version: DefinitionVersion, at: string, by: string | null): void {
    const from = this.state.status;
    RECURRING_DEFINITION_LIFECYCLE.transition('REVISE', from, from);
    if (version.versionNo !== this.state.currentVersionNo + 1) {
      throw new Error('revision must be the next version');
    }
    this.all.push(version);
    this.newVersions.push(version);
    this.apply({ currentVersionNo: version.versionNo }, at, by);
    this.mark('REVISE', from, from);
  }

  /** Avanza el high-water mark de la generación SIN subir la versión (no es un hecho publicado). */
  setGeneratedThrough(date: string): void {
    this.state = { ...this.state, generatedThrough: date };
  }

  /** Sube la versión del agregado sin cambiar datos (hecho publicado de la generación). */
  touch(at: string, by: string | null): void {
    this.apply({}, at, by);
  }

  private step(
    code: DefinitionTransition,
    to: DefinitionStatus,
    patch: Partial<Mutable<DefinitionState>>,
    at: string,
    by: string | null,
  ): void {
    const from = this.state.status;
    RECURRING_DEFINITION_LIFECYCLE.transition(code, from, to);
    this.apply({ ...patch, status: to }, at, by);
    this.mark(code, from, to);
  }

  private apply(patch: Partial<Mutable<DefinitionState>>, at: string, by: string | null): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1, updatedAt: at, updatedBy: by };
  }

  private mark(transition: DefinitionTransition, from: DefinitionStatus | null, to: DefinitionStatus): void {
    this.transition = { transition, from, to };
  }
}
