import type { AuditPort } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  Institution,
  type InstitutionFields,
  type InstitutionKind,
  type InstitutionState,
} from '../domain/index.js';
import type { AccountsDeps } from './ports/index.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `institution ${id} not found`);

export interface CreateInstitutionCommand extends InstitutionFields {
  readonly workspaceId: string;
  readonly id?: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * Casos de uso de instituciones (accounts/institutions): crear, editar y archivar, con auditoría en la misma unidad de
 * trabajo. Sin eventos en Phase 1 (design.md decisión 11: sin consumidores). Nunca se eliminan (sin DELETE).
 */
export class InstitutionsService {
  constructor(
    private readonly deps: Pick<AccountsDeps, 'uow' | 'institutions' | 'ids' | 'clock'>,
    private readonly audit: AuditPort,
  ) {}

  createInstitution(cmd: CreateInstitutionCommand): Promise<InstitutionState> {
    return this.deps.uow.run(cmd.workspaceId, async () => {
      const institution = Institution.create({ ...cmd, id: cmd.id ?? this.deps.ids.next() });
      await this.deps.institutions.insert(institution);
      const s = institution.snapshot;
      await this.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'accounts.institution.created',
        aggregateType: 'Institution',
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: (['name', 'kind', 'countryCode', 'website', 'icon', 'color', 'notes'] as const)
          .filter((f) => s[f] !== null)
          .map((field) => ({ field, before: null, after: s[field] })),
      });
      return s;
    });
  }

  updateInstitution(
    workspaceId: string,
    id: string,
    expectedVersion: number,
    changes: InstitutionFields,
  ): Promise<InstitutionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const institution = await this.load(workspaceId, id, expectedVersion);
      const before = institution.snapshot;
      const changed = institution.update(changes);
      if (changed.length === 0) return before;
      if (!(await this.deps.institutions.update(institution))) throw preconditionFailed();
      const after = institution.snapshot;
      await this.audit.append({
        workspaceId,
        action: 'accounts.institution.updated',
        aggregateType: 'Institution',
        aggregateId: id,
        aggregateVersion: after.version,
        changes: changed.map((field) => ({ field, before: before[field], after: after[field] })),
      });
      return after;
    });
  }

  /** Archivar no toca las cuentas vinculadas (conservan `institution_id`, TC-ACCOUNTS-INSTITUTION-004). */
  archiveInstitution(workspaceId: string, id: string, expectedVersion: number): Promise<InstitutionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const institution = await this.load(workspaceId, id, expectedVersion);
      if (!institution.archive(this.deps.clock.now().toString())) return institution.snapshot;
      if (!(await this.deps.institutions.update(institution))) throw preconditionFailed();
      const s = institution.snapshot;
      await this.audit.append({
        workspaceId,
        action: 'accounts.institution.archived',
        aggregateType: 'Institution',
        aggregateId: id,
        aggregateVersion: s.version,
        changes: [{ field: 'archivedAt', before: null, after: s.archivedAt }],
      });
      return s;
    });
  }

  getInstitution(workspaceId: string, id: string): Promise<InstitutionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const institution = await this.deps.institutions.findById(workspaceId, id);
      if (!institution) throw notFound(id);
      return institution.snapshot;
    });
  }

  listInstitutions(query: {
    readonly workspaceId: string;
    readonly includeArchived?: boolean;
    readonly kinds?: readonly InstitutionKind[];
    readonly q?: string;
  }): Promise<InstitutionState[]> {
    return this.deps.uow.run(query.workspaceId, async () =>
      (
        await this.deps.institutions.list(query.workspaceId, {
          includeArchived: query.includeArchived ?? false,
          ...(query.kinds ? { kinds: query.kinds } : {}),
          ...(query.q ? { query: query.q } : {}),
        })
      ).map((i) => i.snapshot),
    );
  }

  private async load(workspaceId: string, id: string, expectedVersion: number): Promise<Institution> {
    const institution = await this.deps.institutions.findById(workspaceId, id);
    if (!institution) throw notFound(id);
    if (institution.version !== expectedVersion) throw preconditionFailed(institution.version);
    return institution;
  }
}

/** 412 con la versión vigente (`currentVersion`, docs/10 §6) cuando se conoce. */
function preconditionFailed(currentVersion?: number): DomainError {
  return new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });
}
