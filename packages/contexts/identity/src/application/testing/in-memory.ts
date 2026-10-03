import { FixedClock, Instant, currency, type Currency } from '@pf/shared-kernel';
import { LocaleTag } from '../../domain/locale-tag.js';
import type { Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { Workspace } from '../../domain/workspace.js';
import type { AuditEntry } from '@pf/audit/contracts';
import type {
  IdentityDeps,
  OutboxEvent,
  RlsContext,
  VerifiedIdentity,
  WorkspaceSummary,
} from '../ports/index.js';

/**
 * Fakes en memoria de los puertos de IDENTITY para tests de aplicación. La "transacción" hace snapshot del estado
 * y lo restaura si `fn` lanza (todo o nada, como la UnitOfWork real).
 */
export class InMemoryIdentity {
  readonly users = new Map<string, User>();
  readonly workspaces = new Map<string, Workspace>();
  readonly outboxEvents: OutboxEvent[] = [];
  readonly auditEntries: AuditEntry[] = [];
  readonly contexts: RlsContext[] = [];
  readonly catalog = new Map<string, Currency>(
    [
      currency('BOB', 2),
      currency('USD', 2),
      currency('USDT', 6),
      currency('BTC', 8),
      currency('ETH', 18),
    ].map((c) => [c.code, c]),
  );
  private seq = 0;
  /** Unidades de trabajo abiertas y contexto RLS vigente (la auditoría exige ambos, como el adapter real). */
  private depth = 0;
  private current: RlsContext | null = null;
  readonly clock = new FixedClock(Instant.parse('2026-10-02T12:00:00Z'));

  nextId(): string {
    this.seq += 1;
    return `0190a000-0000-7000-8000-${this.seq.toString(16).padStart(12, '0')}`;
  }

  addUser(email: string, subject = email): User {
    const user = User.restore({
      id: this.nextId(),
      idpIssuer: 'http://keycloak.test/realms/pfos',
      idpSubject: subject,
      email,
      displayName: email.split('@')[0] ?? email,
      locale: LocaleTag.of('es-BO'),
      timeZone: null,
      status: 'ACTIVE',
      version: 1,
    });
    this.users.set(user.id, user);
    return user;
  }

  addWorkspace(name: string, members: ReadonlyArray<readonly [User, Role]>): Workspace {
    const [first, ...rest] = members;
    if (!first) throw new Error('at least one member');
    const ws = Workspace.create({
      id: this.nextId(),
      name,
      baseCurrency: currency('BOB', 2),
      timeZone: 'America/La_Paz',
      locale: 'es-BO',
      ownerUserId: first[0].id,
      personal: false,
    });
    for (const [u, role] of rest) ws.addMember(u.id, role);
    const restored = Workspace.restore({ ...ws.snapshot(), version: 1 });
    this.workspaces.set(restored.id, restored);
    return restored;
  }

  /** Clona el agregado (simula leer de la BD: los cambios no persisten sin `update`). */
  private load(id: string): Workspace | null {
    const ws = this.workspaces.get(id);
    return ws ? Workspace.restore(ws.snapshot()) : null;
  }

  deps(): IdentityDeps {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- los fakes son objetos literales que cierran sobre el estado
    const self = this;
    return {
      uow: {
        async run(ctx, fn) {
          const snapshot = {
            users: new Map(self.users),
            workspaces: new Map(self.workspaces),
            outbox: self.outboxEvents.length,
            audit: self.auditEntries.length,
          };
          self.contexts.push(ctx);
          const previous = self.current;
          self.depth += 1;
          self.current = ctx;
          try {
            return await fn();
          } catch (err) {
            self.users.clear();
            for (const [k, v] of snapshot.users) self.users.set(k, v);
            self.workspaces.clear();
            for (const [k, v] of snapshot.workspaces) self.workspaces.set(k, v);
            self.outboxEvents.length = snapshot.outbox;
            self.auditEntries.length = snapshot.audit;
            throw err;
          } finally {
            self.depth -= 1;
            self.current = previous;
          }
        },
        async bind(ctx) {
          self.contexts.push(ctx);
          self.current = ctx;
        },
      },
      users: {
        async provision(identity: VerifiedIdentity) {
          const existing = [...self.users.values()].find(
            (u) => u.idpIssuer === identity.issuer && u.idpSubject === identity.subject,
          );
          const user = User.restore({
            id: existing?.id ?? self.nextId(),
            idpIssuer: identity.issuer,
            idpSubject: identity.subject,
            email: identity.email,
            displayName: identity.displayName,
            locale: existing?.locale ?? LocaleTag.of('es-BO'),
            timeZone: existing?.timeZone ?? null,
            status: 'ACTIVE',
            version: existing?.version ?? 1,
          });
          self.users.set(user.id, user);
          return user.id;
        },
        async findById(id) {
          const u = self.users.get(id);
          return u ? User.restore(u.snapshot()) : null;
        },
        async savePreferences(user, expectedVersion) {
          if (self.users.get(user.id)?.version !== expectedVersion) return false;
          self.users.set(user.id, User.restore(user.snapshot()));
          return true;
        },
      },
      workspaces: {
        async lockProvisioning() {},
        async countActiveMemberships(userId) {
          return [...self.workspaces.values()].filter((w) => w.roleOf(userId) !== null).length;
        },
        async insert(ws) {
          if (ws.personalOfUserId) {
            for (const other of self.workspaces.values()) {
              if (other.personalOfUserId === ws.personalOfUserId) throw new Error('unique violation');
            }
          }
          self.workspaces.set(ws.id, Workspace.restore(ws.snapshot()));
        },
        async findById(id) {
          return self.load(id);
        },
        async update(ws, expectedVersion) {
          if (self.workspaces.get(ws.id)?.version !== expectedVersion) return false;
          self.workspaces.set(ws.id, Workspace.restore(ws.snapshot()));
          return true;
        },
        async listForUser(userId, page) {
          return [...self.workspaces.values()]
            .filter((w) => w.roleOf(userId) !== null)
            .filter((w) => page?.afterId === undefined || w.id > page.afterId)
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, page?.limit ?? Number.MAX_SAFE_INTEGER)
            .map((w): WorkspaceSummary => ({
              id: w.id,
              name: w.settings.name,
              role: w.roleOf(userId) as Role,
              baseCurrency: w.settings.baseCurrency.code,
            }));
        },
      },
      memberships: {
        async activeRole(userId, workspaceId) {
          return self.workspaces.get(workspaceId)?.roleOf(userId) ?? null;
        },
      },
      currencies: {
        async find(code) {
          return self.catalog.get(code) ?? null;
        },
      },
      outbox: {
        async append(event) {
          self.outboxEvents.push(event);
        },
      },
      audit: {
        async append(entry) {
          if (self.depth === 0) throw new Error('AUDIT_OUTSIDE_UNIT_OF_WORK');
          if (self.current?.workspaceId !== entry.workspaceId)
            throw new Error('RLS: audit workspace mismatch');
          self.auditEntries.push(entry);
        },
      },
      ids: { next: () => self.nextId() },
      clock: self.clock,
      defaults: {
        baseCurrency: 'BOB',
        timeZone: 'America/La_Paz',
        locale: 'es-BO',
        personalWorkspaceName: 'Personal',
      },
    };
  }
}
