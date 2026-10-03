import { DomainError } from '@pf/shared-kernel';

/** Clases de institución (docs/01 FR-ACCOUNTS-012, docs/31 D3). */
export const INSTITUTION_KINDS = [
  'BANK',
  'FINTECH',
  'EXCHANGE',
  'BROKER',
  'WALLET_PROVIDER',
  'OTHER',
] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

const COUNTRY = /^[A-Z]{2}$/;

const invalid = (pointer: string, message: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

export function institutionKind(value: unknown): InstitutionKind {
  if (typeof value !== 'string' || !(INSTITUTION_KINDS as readonly string[]).includes(value)) {
    throw invalid('/kind', `unknown institution kind '${String(value)}'`);
  }
  return value as InstitutionKind;
}

/** País ISO 3166-1 alfa-2 en mayúsculas (`BO`); "Bolivia" ⇒ `VALIDATION_FAILED` (TC-ACCOUNTS-INSTITUTION-001). */
export function countryCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!COUNTRY.test(value)) throw invalid('/countryCode', 'countryCode must be ISO 3166-1 alpha-2');
  return value;
}

function text(value: string | null | undefined, max: number, pointer: string): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > max) throw invalid(pointer, `${pointer.slice(1)} exceeds ${max} characters`);
  return value;
}

function institutionName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 100) throw invalid('/name', 'name must have 1..100 characters');
  return name;
}

function website(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
  } catch {
    throw invalid('/website', 'website must be an http(s) URL');
  }
  return text(value, 500, '/website');
}

export interface InstitutionState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly countryCode: string | null;
  readonly website: string | null;
  readonly icon: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
}

export interface InstitutionFields {
  readonly name?: string;
  readonly kind?: string;
  readonly countryCode?: string | null;
  readonly website?: string | null;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly notes?: string | null;
}

export type InstitutionField = keyof InstitutionFields;

/** Agregado `Institution` (accounts/institutions). Archivada ⇒ no asignable a cuentas (`INSTITUTION_ARCHIVED`). */
export class Institution {
  private state: InstitutionState;
  readonly persistedVersion: number;

  private constructor(state: InstitutionState, persistedVersion: number) {
    this.state = state;
    this.persistedVersion = persistedVersion;
  }

  static restore(state: InstitutionState): Institution {
    return new Institution(state, state.version);
  }

  static create(
    input: {
      readonly id: string;
      readonly workspaceId: string;
      readonly name: string;
      readonly kind: string;
    } & Omit<InstitutionFields, 'name' | 'kind'>,
  ): Institution {
    return new Institution(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: institutionName(input.name),
        kind: institutionKind(input.kind),
        countryCode: countryCode(input.countryCode),
        website: website(input.website),
        icon: text(input.icon, 40, '/icon'),
        color: text(input.color, 20, '/color'),
        notes: text(input.notes, 2000, '/notes'),
        archivedAt: null,
        version: 1,
      },
      0,
    );
  }

  get id(): string {
    return this.state.id;
  }
  get isArchived(): boolean {
    return this.state.archivedAt !== null;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): InstitutionState {
    return this.state;
  }

  /** Aplica los cambios; devuelve los campos que cambiaron (las cuentas vinculadas no se tocan, INSTITUTION-003). */
  update(changes: InstitutionFields): InstitutionField[] {
    const s = this.state;
    const next: { -readonly [K in keyof InstitutionState]: InstitutionState[K] } = { ...s };
    const changed: InstitutionField[] = [];
    const set = <K extends InstitutionField>(field: K, value: InstitutionState[K]) => {
      if (s[field] === value) return;
      next[field] = value as never;
      changed.push(field);
    };
    if (changes.name !== undefined) set('name', institutionName(changes.name));
    if (changes.kind !== undefined) set('kind', institutionKind(changes.kind));
    if (changes.countryCode !== undefined) set('countryCode', countryCode(changes.countryCode));
    if (changes.website !== undefined) set('website', website(changes.website));
    if (changes.icon !== undefined) set('icon', text(changes.icon, 40, '/icon'));
    if (changes.color !== undefined) set('color', text(changes.color, 20, '/color'));
    if (changes.notes !== undefined) set('notes', text(changes.notes, 2000, '/notes'));
    if (changed.length > 0) this.state = { ...next, version: s.version + 1 };
    return changed;
  }

  /** Idempotente: archivar una institución ya archivada no cambia nada (devuelve `false`). */
  archive(at: string): boolean {
    if (this.isArchived) return false;
    this.state = { ...this.state, archivedAt: at, version: this.state.version + 1 };
    return true;
  }
}
