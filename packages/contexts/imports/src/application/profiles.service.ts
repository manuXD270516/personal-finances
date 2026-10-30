import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  MappingProfile,
  serializeProfileMapping,
  serializeProfileOptions,
  type MappingProfileVersion,
  type StatementFormat,
} from '../domain/index.js';
import type { ImportsDeps, StoredProfileVersion } from './ports/index.js';

/** Perfil como lo devuelve la API (`ImportProfile`): la versión pedida (o la vigente) y el historial. */
export interface ProfileView {
  readonly id: string;
  readonly name: string;
  readonly format: StatementFormat;
  readonly institutionId: string | null;
  readonly accountId: string | null;
  readonly version: number;
  readonly options: Record<string, unknown>;
  readonly optionsSchemaVersion: number;
  readonly archivedAt: string | null;
  readonly versions: readonly {
    readonly version: number;
    readonly createdAt: string;
    readonly createdBy: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `import profile ${id} not found`);

function toView(versions: readonly StoredProfileVersion[], wanted?: number): ProfileView {
  const latest = versions.at(-1) as StoredProfileVersion;
  const shown = (wanted === undefined ? latest : versions.find((v) => v.version === wanted)) ?? latest;
  const first = versions[0] as StoredProfileVersion;
  return {
    id: shown.id,
    name: shown.name,
    format: shown.format,
    institutionId: shown.institutionId,
    accountId: shown.accountId,
    version: shown.version,
    options: serializeProfileOptions(shown.options),
    optionsSchemaVersion: 1,
    archivedAt: latest.archivedAt,
    versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, createdBy: v.createdBy })),
    createdAt: first.createdAt,
    updatedAt: latest.createdAt,
  };
}

const auditChanges = (v: MappingProfileVersion, archived: boolean): AuditChangeInput[] => [
  { field: 'name', before: null, after: v.name },
  { field: 'format', before: null, after: v.format },
  { field: 'institutionId', before: null, after: v.institutionId ?? '' },
  { field: 'accountId', before: null, after: v.accountId ?? '' },
  { field: 'version', before: null, after: v.version },
  { field: 'archived', before: null, after: archived },
];

/**
 * Perfiles de mapeo por institución (openspec add-import-pipeline decisión 6; FR-IMPORTS-005): crear (versión 1, desde
 * opciones o desde el mapeo de una importación), versionar (la versión es inmutable; la importación conserva la que
 * usó), archivar (no se sugiere ni se aplica a importaciones nuevas) y consultar. Cada versión y el archivo se auditan
 * con el actor en la misma unidad de trabajo.
 */
export class ProfilesService {
  constructor(private readonly deps: ImportsDeps) {}

  create(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly name: string;
    readonly format?: StatementFormat | undefined;
    readonly institutionId?: string | null | undefined;
    readonly accountId?: string | null | undefined;
    readonly options?: unknown;
    readonly fromImportId?: string | undefined;
  }): Promise<ProfileView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      let format = cmd.format;
      let institutionId = cmd.institutionId ?? null;
      let accountId = cmd.accountId ?? null;
      let options = cmd.options;
      if (cmd.fromImportId) {
        const job = await deps.jobs.findById(cmd.workspaceId, cmd.fromImportId);
        if (!job) throw new DomainError('REFERENCE_NOT_FOUND', 'import not found').at('/fromImportId');
        const s = job.state;
        const mapping = s.profileMapping;
        if (mapping === null) {
          throw new DomainError('IMPORT_MAPPING_INVALID', 'the import has no mapping to save').at(
            '/fromImportId',
          );
        }
        format = s.format ?? 'CSV';
        institutionId = await deps.institutions.institutionOf(cmd.workspaceId, s.accountId);
        accountId = institutionId === null ? s.accountId : null;
        options = { version: 'imports.profile.v1', mapping: serializeProfileMapping(mapping) };
      }
      if (!format) throw new DomainError('VALIDATION_FAILED', 'format is required').at('/format');
      if (accountId !== null) await deps.accounts.assertActive(cmd.workspaceId, accountId);

      const profile = MappingProfile.create({
        id: deps.ids.next(),
        workspaceId: cmd.workspaceId,
        institutionId,
        accountId,
        name: cmd.name,
        format,
        options,
        createdBy: cmd.userId,
        now: deps.clock.now().toString(),
      });
      const v1 = profile.latest;
      await deps.profiles.insertVersion(v1);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'imports.profile.created',
        aggregateType: 'ImportProfile',
        aggregateId: profile.state.id,
        aggregateVersion: v1.version,
        changes: auditChanges(v1, false),
      });
      return toView(await deps.profiles.versionsOf(cmd.workspaceId, profile.state.id));
    });
  }

  /** `If-Match` es la última versión del perfil (`412` con la vigente). */
  createVersion(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly profileId: string;
    readonly expectedVersion: number;
    readonly name?: string | undefined;
    readonly options?: unknown;
  }): Promise<ProfileView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const versions = await deps.profiles.versionsOf(cmd.workspaceId, cmd.profileId);
      if (versions.length === 0) throw notFound(cmd.profileId);
      const latest = versions.at(-1) as StoredProfileVersion;
      if (latest.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: latest.version },
        });
      }
      const profile = MappingProfile.rehydrate({
        id: cmd.profileId,
        workspaceId: cmd.workspaceId,
        archivedAt: latest.archivedAt,
        versions,
      });
      const next = profile.newVersion({
        name: cmd.name,
        options: cmd.options,
        createdBy: cmd.userId,
        now: deps.clock.now().toString(),
      });
      await deps.profiles.insertVersion(next);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'imports.profile.versioned',
        aggregateType: 'ImportProfile',
        aggregateId: cmd.profileId,
        aggregateVersion: next.version,
        changes: auditChanges(next, false),
      });
      return toView(await deps.profiles.versionsOf(cmd.workspaceId, cmd.profileId));
    });
  }

  archive(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly profileId: string;
    readonly expectedVersion: number;
  }): Promise<ProfileView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const versions = await deps.profiles.versionsOf(cmd.workspaceId, cmd.profileId);
      if (versions.length === 0) throw notFound(cmd.profileId);
      const latest = versions.at(-1) as StoredProfileVersion;
      if (latest.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: latest.version },
        });
      }
      const profile = MappingProfile.rehydrate({
        id: cmd.profileId,
        workspaceId: cmd.workspaceId,
        archivedAt: latest.archivedAt,
        versions,
      });
      profile.archive(deps.clock.now().toString());
      await deps.profiles.archive(cmd.workspaceId, cmd.profileId, deps.clock.now().toString());
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'imports.profile.archived',
        aggregateType: 'ImportProfile',
        aggregateId: cmd.profileId,
        aggregateVersion: latest.version,
        changes: [{ field: 'archived', before: false, after: true }],
      });
      return toView(await deps.profiles.versionsOf(cmd.workspaceId, cmd.profileId));
    });
  }

  get(workspaceId: string, profileId: string, version?: number): Promise<ProfileView> {
    return this.deps.uow.run(workspaceId, async () => {
      const versions = await this.deps.profiles.versionsOf(workspaceId, profileId);
      if (versions.length === 0) throw notFound(profileId);
      if (version !== undefined && !versions.some((v) => v.version === version)) throw notFound(profileId);
      return toView(versions, version);
    });
  }

  list(
    workspaceId: string,
    filter: {
      readonly institutionId?: string | undefined;
      readonly accountId?: string | undefined;
      readonly format?: StatementFormat | undefined;
      readonly includeArchived: boolean;
      readonly limit: number;
      readonly after?: readonly [string, string] | undefined;
    },
  ): Promise<readonly ProfileView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const latest = await this.deps.profiles.list(workspaceId, filter);
      const out: ProfileView[] = [];
      for (const l of latest) {
        out.push(toView(await this.deps.profiles.versionsOf(workspaceId, l.id)));
      }
      return out;
    });
  }
}
