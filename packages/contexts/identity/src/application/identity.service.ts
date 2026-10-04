import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, type Currency } from '@pf/shared-kernel';
import { roleGrants, type Permission, type Role } from '../domain/role.js';
import type { User, UserPreferenceChanges } from '../domain/user.js';
import { Workspace, type SettingsChange, type SettingsPatch } from '../domain/workspace.js';
import { persistNewWorkspace } from './workspace-creation.js';
import type {
  IdentityDeps,
  VerifiedIdentity,
  WorkspacePageRequest,
  WorkspaceSummary,
} from './ports/index.js';

export interface ProvisionResult {
  readonly userId: string;
  /** Workspace personal creado en esta llamada (o `null` si el usuario ya tenía membresías). */
  readonly createdWorkspaceId: string | null;
}

export interface WorkspaceView {
  readonly workspace: Workspace;
  readonly role: Role;
}

export interface ReservePatch {
  readonly amount: string;
  readonly currency: string;
}

export interface UpdateWorkspaceSettingsCommand {
  readonly name?: string;
  readonly baseCurrency?: string;
  readonly timezone?: string;
  readonly locale?: string;
  readonly fiscalMonthStartDay?: number;
  readonly minimumLiquidityReserve?: ReservePatch | null;
}

export interface CreateWorkspaceCommand {
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscalMonthStartDay?: number;
  /** Aplicar también el catálogo inicial de categorías (por defecto `true`; add-classification). */
  readonly seedDefaultCategories?: boolean;
}

const accessDenied = () =>
  new DomainError('WORKSPACE_ACCESS_DENIED', 'not an active member of the workspace');
const notFound = (what: string) => new DomainError('RESOURCE_NOT_FOUND', `${what} not found`);

/**
 * Casos de uso de IDENTITY (design §1, §4, §5). TypeScript plano: sin Nest ni SQL; todo efecto pasa por puertos
 * y dentro de la `UnitOfWork` con contexto RLS.
 */
export class IdentityService {
  constructor(private readonly deps: IdentityDeps) {}

  // ------------------------------------------------------------------ autorización

  /**
   * `AuthorizeAction`: membresía activa (consulta por request) y permiso del rol.
   * No miembro → `WORKSPACE_ACCESS_DENIED`; rol insuficiente → `INSUFFICIENT_ROLE` (docs/31 D2).
   */
  async authorize(userId: string, workspaceId: string, permission: Permission): Promise<Role> {
    const role = await this.deps.uow.run({ userId, workspaceId: null }, () =>
      this.deps.memberships.activeRole(userId, workspaceId),
    );
    if (role === null) throw accessDenied();
    if (!roleGrants(role, permission)) {
      throw new DomainError('INSUFFICIENT_ROLE', `role ${role} does not grant ${permission}`);
    }
    return role;
  }

  // ------------------------------------------------------------------ provisión JIT

  /**
   * `ProvisionUserFromIdentity`: alta idempotente del usuario y, si no tiene membresías activas, su workspace
   * personal (moneda/zona/locale por configuración) con OWNER, `identity.WorkspaceCreated.v1` y auditoría, todo en
   * una transacción. El lock por usuario + el índice único parcial garantizan un solo workspace personal.
   */
  async provision(identity: VerifiedIdentity): Promise<ProvisionResult> {
    if (!identity.emailVerified) {
      throw new DomainError('UNAUTHENTICATED', 'email not verified');
    }
    const { uow, users, workspaces, ids, defaults } = this.deps;
    return uow.run({ userId: null, workspaceId: null }, async () => {
      const userId = await users.provision(identity);
      await uow.bind({ userId, workspaceId: null });
      await workspaces.lockProvisioning(userId);
      if ((await workspaces.countActiveMemberships(userId)) > 0) {
        return { userId, createdWorkspaceId: null };
      }
      const baseCurrency = await this.currency(defaults.baseCurrency);
      const workspace = Workspace.create({
        id: ids.next(),
        name: defaults.personalWorkspaceName,
        baseCurrency,
        timeZone: defaults.timeZone,
        locale: defaults.locale,
        ownerUserId: userId,
        personal: true,
      });
      await this.persistNewWorkspace(workspace, userId, 'PERSONAL_DEFAULT');
      await this.deps.audit.append({
        workspaceId: workspace.id,
        action: 'identity.user.provisioned',
        aggregateType: 'User',
        aggregateId: userId,
        changes: [{ field: 'displayName', before: null, after: identity.displayName }],
        actor: { type: 'USER', userId },
      });
      return { userId, createdWorkspaceId: workspace.id };
    });
  }

  // ------------------------------------------------------------------ /me

  async getMe(userId: string): Promise<{ user: User; workspaces: readonly WorkspaceSummary[] }> {
    return this.deps.uow.run({ userId, workspaceId: null }, async () => {
      const user = await this.deps.users.findById(userId);
      if (!user) throw notFound('user');
      return { user, workspaces: await this.deps.workspaces.listForUser(userId) };
    });
  }

  /** `UpdateMyPreferences` con `If-Match` (versión esperada); zona inválida → `INVALID_TIMEZONE`. */
  async updateMyPreferences(
    userId: string,
    expectedVersion: number,
    changes: {
      readonly displayName?: string;
      readonly locale?: string;
      readonly timezone?: string | null;
      readonly preferences?: Readonly<Record<string, unknown>>;
    },
  ): Promise<User> {
    return this.deps.uow.run({ userId, workspaceId: null }, async () => {
      const user = await this.deps.users.findById(userId);
      if (!user) throw notFound('user');
      if (user.version !== expectedVersion) throw preconditionFailed();
      const before = profileOf(user);
      const prefs: UserPreferenceChanges = {
        ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
        ...(changes.locale === undefined ? {} : { locale: changes.locale }),
        ...(changes.timezone === undefined ? {} : { timeZone: changes.timezone }),
        ...(changes.preferences === undefined ? {} : { preferences: changes.preferences }),
      };
      if (!user.updatePreferences(prefs)) return user;
      if (!(await this.deps.users.savePreferences(user, expectedVersion))) throw preconditionFailed();
      const after = profileOf(user);
      const diff = PROFILE_FIELDS.filter((f) => before[f] !== after[f]).map((field) => ({
        field,
        before: before[field],
        after: after[field],
      }));
      // `preferences` (JSON libre) no se copia: la allow-list de `User` no lo incluye. El perfil no pertenece a un
      // workspace: se audita en el workspace hogar del usuario (design.md, decisiones de implementación).
      await this.auditInHomeWorkspace(userId, null, {
        action: 'identity.user.preferences_changed',
        aggregateType: 'User',
        aggregateId: userId,
        aggregateVersion: user.version,
        changes: diff,
      });
      return user;
    });
  }

  // ------------------------------------------------------------------ workspaces

  /**
   * `ListMyWorkspaces`: membresías activas en orden estable por id de workspace (UUIDv7). Con `page`, keyset
   * `id > afterId` y como máximo `limit` filas (el llamador pide `limit + 1` para saber si hay más).
   */
  async listMyWorkspaces(userId: string, page?: WorkspacePageRequest): Promise<readonly WorkspaceSummary[]> {
    return this.deps.uow.run({ userId, workspaceId: null }, () =>
      this.deps.workspaces.listForUser(userId, page),
    );
  }

  /** `CreateWorkspace`: el creador queda como OWNER; `identity.WorkspaceCreated.v1` con origin `USER_CREATED`. */
  async createWorkspace(userId: string, cmd: CreateWorkspaceCommand): Promise<WorkspaceView> {
    const id = this.deps.ids.next();
    return this.deps.uow.run({ userId, workspaceId: id }, async () => {
      const baseCurrency = await this.currency(cmd.baseCurrency, '/baseCurrency');
      const workspace = Workspace.create({
        id,
        name: cmd.name,
        baseCurrency,
        timeZone: cmd.timezone,
        locale: cmd.locale,
        ...(cmd.fiscalMonthStartDay === undefined ? {} : { fiscalMonthStartDay: cmd.fiscalMonthStartDay }),
        ownerUserId: userId,
        personal: false,
      });
      await this.persistNewWorkspace(workspace, userId, 'USER_CREATED', cmd.seedDefaultCategories ?? true);
      return { workspace, role: 'OWNER' as const };
    });
  }

  async getWorkspace(userId: string, workspaceId: string): Promise<WorkspaceView> {
    const role = await this.authorize(userId, workspaceId, 'finance:read');
    return this.deps.uow.run({ userId, workspaceId }, async () => {
      const workspace = await this.deps.workspaces.findById(workspaceId);
      if (!workspace) throw accessDenied();
      return { workspace, role };
    });
  }

  /**
   * `UpdateWorkspaceSettings` (solo OWNER: `workspace:admin`). Cambiar la moneda base no toca datos históricos:
   * este caso de uso no depende de Ledger ni Transactions (tarea 4.3). Emite `identity.WorkspaceSettingsChanged.v1`.
   */
  async updateWorkspaceSettings(
    userId: string,
    workspaceId: string,
    expectedVersion: number,
    cmd: UpdateWorkspaceSettingsCommand,
  ): Promise<{ view: WorkspaceView; changes: readonly SettingsChange[] }> {
    const role = await this.authorize(userId, workspaceId, 'workspace:admin');
    return this.deps.uow.run({ userId, workspaceId }, async () => {
      const workspace = await this.deps.workspaces.findById(workspaceId);
      if (!workspace) throw accessDenied();
      if (workspace.version !== expectedVersion) throw preconditionFailed();
      const patch: {
        -readonly [K in keyof SettingsPatch]: SettingsPatch[K];
      } = {};
      if (cmd.name !== undefined) patch.name = cmd.name;
      if (cmd.timezone !== undefined) patch.timeZone = cmd.timezone;
      if (cmd.locale !== undefined) patch.locale = cmd.locale;
      if (cmd.fiscalMonthStartDay !== undefined) patch.fiscalMonthStartDay = cmd.fiscalMonthStartDay;
      if (cmd.baseCurrency !== undefined)
        patch.baseCurrency = await this.currency(cmd.baseCurrency, '/baseCurrency');
      if (cmd.minimumLiquidityReserve !== undefined) {
        patch.minimumLiquidityReserve =
          cmd.minimumLiquidityReserve === null
            ? null
            : {
                amount: cmd.minimumLiquidityReserve.amount,
                currency: await this.currency(
                  cmd.minimumLiquidityReserve.currency,
                  '/minimumLiquidityReserve/currency',
                ),
              };
      }
      const changes = workspace.updateSettings(patch);
      if (changes.length > 0) {
        if (!(await this.deps.workspaces.update(workspace, expectedVersion))) throw preconditionFailed();
        await this.deps.outbox.append({
          eventId: this.deps.ids.next(),
          eventType: 'identity.WorkspaceSettingsChanged',
          eventVersion: 1,
          aggregateType: 'Workspace',
          aggregateId: workspace.id,
          aggregateVersion: workspace.version,
          workspaceId: workspace.id,
          occurredAt: this.deps.clock.now().toString(),
          actor: { type: 'USER', id: userId },
          payload: { workspaceId: workspace.id, changes },
        });
        await this.deps.audit.append({
          workspaceId: workspace.id,
          action: 'identity.workspace.settings_changed',
          aggregateType: 'Workspace',
          aggregateId: workspace.id,
          aggregateVersion: workspace.version,
          changes: changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
          actor: { type: 'USER', userId },
        });
      }
      return { view: { workspace, role }, changes };
    });
  }

  // ------------------------------------------------------------------ sesión (FR-AUDIT-005)

  /**
   * `RecordSessionEvent`: audita el inicio (`STARTED`) o el cierre (`ENDED`) de una sesión del BFF en el workspace
   * activo de la sesión (o el hogar del usuario). User agent y HMAC de la IP los completa AUDIT desde el contexto de
   * la petición; nunca tokens ni cookies. Devuelve el workspace donde quedó (o `null` si se omitió).
   */
  async recordSessionEvent(
    userId: string,
    event: 'STARTED' | 'ENDED',
    activeWorkspaceId: string | null,
  ): Promise<string | null> {
    return this.deps.uow.run({ userId, workspaceId: null }, () =>
      this.auditInHomeWorkspace(userId, activeWorkspaceId, {
        action: event === 'STARTED' ? 'identity.session.started' : 'identity.session.ended',
        aggregateType: 'User',
        aggregateId: userId,
      }),
    );
  }

  // ------------------------------------------------------------------ helpers

  private async currency(code: string, pointer = ''): Promise<Currency> {
    const found = await this.deps.currencies.find(code);
    if (!found) {
      const err = new DomainError('REFERENCE_NOT_FOUND', `currency '${code}' not found`);
      throw pointer ? err.at(pointer) : err;
    }
    return found;
  }

  private persistNewWorkspace(
    workspace: Workspace,
    userId: string,
    origin: 'PERSONAL_DEFAULT' | 'USER_CREATED',
    seedDefaultCategories = true,
  ): Promise<void> {
    return persistNewWorkspace(this.deps, workspace, userId, origin, seedDefaultCategories);
  }

  /**
   * Audita un evento del usuario que no pertenece a un workspace (perfil, sesión): en `preferred` si el usuario es
   * miembro activo; si no, en su workspace hogar (la membresía activa más antigua, UUIDv7). Sin workspaces no hay
   * dónde registrarlo (`audit_log.workspace_id` es obligatorio): se omite (design §6). Devuelve el workspace usado.
   */
  private async auditInHomeWorkspace(
    userId: string,
    preferred: string | null,
    entry: Omit<AuditEntry, 'workspaceId' | 'actor'>,
  ): Promise<string | null> {
    let target: string | null = null;
    if (preferred !== null && (await this.deps.memberships.activeRole(userId, preferred)) !== null) {
      target = preferred;
    }
    target ??= (await this.deps.workspaces.listForUser(userId, { limit: 1 }))[0]?.id ?? null;
    if (target === null) return null;
    await this.deps.uow.bind({ userId, workspaceId: target });
    await this.deps.audit.append({ ...entry, workspaceId: target, actor: { type: 'USER', userId } });
    return target;
  }
}

const PROFILE_FIELDS = ['displayName', 'locale', 'timeZone'] as const;

/** Campos del perfil que se auditan (allow-list `User` de IDENTITY_AUDIT_POLICY). */
function profileOf(user: User): Record<(typeof PROFILE_FIELDS)[number], string | null> {
  return { displayName: user.displayName, locale: user.locale.value, timeZone: user.timeZone?.value ?? null };
}

function preconditionFailed(): DomainError {
  return new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version');
}
