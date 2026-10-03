import type { AuditPort } from '@pf/audit/contracts';
import type { Clock, Currency } from '@pf/shared-kernel';
import type { Role } from '../../domain/role.js';
import type { User } from '../../domain/user.js';
import type { Workspace } from '../../domain/workspace.js';

/** Contexto RLS de la transacción (`app.user_id` / `app.workspace_id`, ADR-0023). */
export interface RlsContext {
  readonly userId: string | null;
  readonly workspaceId: string | null;
}

/**
 * Unidad de trabajo: una transacción con contexto RLS. `bind` re-fija el contexto dentro de la transacción en
 * curso (la provisión conoce el `userId` y el workspace nuevo solo después del alta de la identidad).
 */
export interface UnitOfWork {
  run<T>(ctx: RlsContext, fn: () => Promise<T>): Promise<T>;
  bind(ctx: RlsContext): Promise<void>;
}

/** Identidad verificada del token (claims ya validados por `JwtAuthGuard`). */
export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
}

export interface UserRepository {
  /** Alta/actualización idempotente por (iss, sub) (`iam.provision_user`); devuelve el id. */
  provision(identity: VerifiedIdentity): Promise<string>;
  findById(id: string): Promise<User | null>;
  /** Guarda preferencias con control optimista (`expectedVersion`); `false` si la versión cambió. */
  savePreferences(user: User, expectedVersion: number): Promise<boolean>;
}

export interface WorkspacePageRequest {
  readonly afterId?: string;
  readonly limit?: number;
}

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly baseCurrency: string;
}

export interface WorkspaceRepository {
  /** Serializa la provisión del workspace personal por usuario (`pg_advisory_xact_lock`). */
  lockProvisioning(userId: string): Promise<void>;
  countActiveMemberships(userId: string): Promise<number>;
  insert(workspace: Workspace): Promise<void>;
  findById(id: string): Promise<Workspace | null>;
  /** Guarda configuración y membresías con control optimista; `false` si la versión cambió. */
  update(workspace: Workspace, expectedVersion: number): Promise<boolean>;
  /** Membresías activas del usuario ordenadas por id de workspace (keyset `id > afterId`, máx. `limit`). */
  listForUser(userId: string, page?: WorkspacePageRequest): Promise<readonly WorkspaceSummary[]>;
}

/** Membresía activa por request (sin caché: una revocación tiene efecto inmediato). */
export interface MembershipReader {
  activeRole(userId: string, workspaceId: string): Promise<Role | null>;
}

/** Catálogo de monedas (`fx.currency`); `null` si el código no existe o no está activo. */
export interface CurrencyCatalogPort {
  find(code: string): Promise<Currency | null>;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: 'identity.WorkspaceCreated' | 'identity.WorkspaceSettingsChanged';
  readonly eventVersion: 1;
  readonly aggregateType: 'Workspace';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly workspaceId: string;
  readonly occurredAt: string;
  /** Quién originó el cambio (envelope v1 `actor`). */
  readonly actor: { readonly type: 'USER'; readonly id: string };
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Outbox transaccional (`platform.outbox`, openspec add-event-outbox): se escribe en la misma transacción que el
 * cambio; el adapter completa el envelope (`correlationId`, `causationId`) y lo valida contra contracts/events.
 */
export interface OutboxPort {
  append(event: OutboxEvent): Promise<void>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

/** Defaults del workspace personal (configuración, nunca hardcodeados en dominio). */
export interface WorkspaceDefaults {
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly personalWorkspaceName: string;
}

/**
 * Gancho síncrono al crear un workspace (openspec add-classification, design §6): otros contextos provisionan sus
 * datos iniciales (categorías de sistema y catálogo sugerido) DENTRO de la misma unidad de trabajo. Lo cablea el
 * composition root; IDENTITY no conoce a sus implementadores.
 */
export interface WorkspaceCreatedHook {
  onWorkspaceCreated(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly seedDefaultCategories: boolean;
  }): Promise<void>;
}

export interface IdentityDeps {
  readonly uow: UnitOfWork;
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipReader;
  readonly currencies: CurrencyCatalogPort;
  readonly outbox: OutboxPort;
  /** Auditoría síncrona de AUDIT (`@pf/audit/contracts`): misma transacción que el comando (INV-029). */
  readonly audit: AuditPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly defaults: WorkspaceDefaults;
  /** Provisión síncrona de otros contextos al crear un workspace (opcional). */
  readonly onWorkspaceCreated?: WorkspaceCreatedHook;
}

export type { AuditPort };
