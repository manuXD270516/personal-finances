import { DomainError } from '@pf/shared-kernel';
import { parseProfileOptions, type ProfileOptions } from './profile-options.js';
import type { StatementFormat } from './statement.js';

/**
 * `MappingProfile` (FR-IMPORTS-005; openspec add-import-pipeline decisión 6): perfil por institución y opcionalmente
 * por cuenta. Cada versión es INMUTABLE (congelada): editar crea la siguiente sin tocar las anteriores, y un import
 * conserva `(id, version)`. Archivar afecta al perfil completo y no a lo ya importado.
 */
export interface MappingProfileVersion {
  readonly id: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly institutionId: string | null;
  readonly accountId: string | null;
  readonly name: string;
  readonly format: StatementFormat;
  readonly options: ProfileOptions;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface MappingProfileState {
  readonly id: string;
  readonly workspaceId: string;
  readonly archivedAt: string | null;
  /** Versiones en orden ascendente (la última es la vigente). */
  readonly versions: readonly MappingProfileVersion[];
}

export const MAX_PROFILE_NAME_LENGTH = 120;

const invalid = (pointer: string, message: string) =>
  new DomainError('IMPORT_MAPPING_INVALID', message).at(pointer);

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || Array.from(trimmed).length > MAX_PROFILE_NAME_LENGTH) {
    throw invalid('/name', `name must have 1 to ${MAX_PROFILE_NAME_LENGTH} characters`);
  }
  return trimmed;
}

export class MappingProfile {
  private constructor(private current: MappingProfileState) {}

  /** Versión 1. Sin institución ni cuenta no tiene a quién aplicarse (`IMPORT_MAPPING_INVALID`). */
  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly institutionId: string | null;
    readonly accountId: string | null;
    readonly name: string;
    readonly format: StatementFormat;
    readonly options: unknown;
    readonly createdBy: string;
    readonly now: string;
  }): MappingProfile {
    if (input.institutionId === null && input.accountId === null) {
      throw invalid('/institutionId', 'a profile needs an institution or an account');
    }
    const v1: MappingProfileVersion = Object.freeze({
      id: input.id,
      version: 1,
      workspaceId: input.workspaceId,
      institutionId: input.institutionId,
      accountId: input.accountId,
      name: validName(input.name),
      format: input.format,
      options: parseProfileOptions(input.format, input.options),
      createdBy: input.createdBy,
      createdAt: input.now,
    });
    return new MappingProfile({
      id: input.id,
      workspaceId: input.workspaceId,
      archivedAt: null,
      versions: Object.freeze([v1]),
    });
  }

  static rehydrate(state: MappingProfileState): MappingProfile {
    if (state.versions.length === 0) throw new DomainError('VALIDATION_FAILED', 'a profile has a version');
    return new MappingProfile(state);
  }

  get state(): MappingProfileState {
    return this.current;
  }

  get latest(): MappingProfileVersion {
    return this.current.versions[this.current.versions.length - 1] as MappingProfileVersion;
  }

  version(n: number): MappingProfileVersion | null {
    return this.current.versions.find((v) => v.version === n) ?? null;
  }

  /** Versión N+1 con los cambios indicados; el formato y el alcance (institución/cuenta) no cambian. */
  newVersion(input: {
    readonly name?: string | undefined;
    readonly options?: unknown;
    readonly createdBy: string;
    readonly now: string;
  }): MappingProfileVersion {
    if (this.current.archivedAt !== null) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'an archived profile cannot be edited');
    }
    const prev = this.latest;
    const next: MappingProfileVersion = Object.freeze({
      ...prev,
      version: prev.version + 1,
      name: input.name === undefined ? prev.name : validName(input.name),
      options: input.options === undefined ? prev.options : parseProfileOptions(prev.format, input.options),
      createdBy: input.createdBy,
      createdAt: input.now,
    });
    this.current = { ...this.current, versions: Object.freeze([...this.current.versions, next]) };
    return next;
  }

  archive(now: string): void {
    if (this.current.archivedAt !== null) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'the profile is already archived');
    }
    this.current = { ...this.current, archivedAt: now };
  }
}
