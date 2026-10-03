import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityService } from './identity.service.js';
import { InMemoryIdentity } from './testing/in-memory.js';

/**
 * Integración de IDENTITY con `AuditPort` (openspec add-audit-trail): cada mutación audita en la misma unidad de
 * trabajo, con diff campo a campo, y un fallo de la auditoría revierte el cambio, su evento y su auditoría.
 */
describe('IDENTITY audita sus mutaciones con AuditPort', () => {
  let mem: InMemoryIdentity;
  let svc: IdentityService;
  let owner: ReturnType<InMemoryIdentity['addUser']>;
  let lonely: ReturnType<InMemoryIdentity['addUser']>;
  let w1: string;
  let w2: string;

  beforeEach(() => {
    mem = new InMemoryIdentity();
    svc = new IdentityService(mem.deps());
    owner = mem.addUser('owner@demo.pfos.test');
    lonely = mem.addUser('lonely@demo.pfos.test');
    w1 = mem.addWorkspace('Personal Demo', [[owner, 'OWNER']]).id;
    w2 = mem.addWorkspace('Other Demo', [[owner, 'OWNER']]).id;
  });

  it('[TC-AUDIT-ATOMIC-001] cambio de configuración auditado: zona America/La_Paz → UTC con antes/después y versión', async () => {
    await svc.updateWorkspaceSettings(owner.id, w1, 1, { timezone: 'UTC' });
    expect(mem.auditEntries).toEqual([
      {
        workspaceId: w1,
        action: 'identity.workspace.settings_changed',
        aggregateType: 'Workspace',
        aggregateId: w1,
        aggregateVersion: 2,
        changes: [{ field: 'timeZone', before: 'America/La_Paz', after: 'UTC' }],
        actor: { type: 'USER', userId: owner.id },
      },
    ]);
  });

  it('[TC-AUDIT-ATOMIC-001] si la auditoría falla, ni la configuración, ni el evento, ni la auditoría persisten', async () => {
    const deps = mem.deps();
    const failing = new IdentityService({
      ...deps,
      audit: {
        append: async () => {
          throw new Error('audit store unavailable (fault injected)');
        },
      },
    });
    await expect(failing.updateWorkspaceSettings(owner.id, w1, 1, { timezone: 'UTC' })).rejects.toThrow(
      'fault injected',
    );
    const ws = (await svc.getWorkspace(owner.id, w1)).workspace;
    expect(ws.settings.timeZone.value).toBe('America/La_Paz');
    expect(ws.version).toBe(1);
    expect(mem.outboxEvents).toHaveLength(0);
    expect(mem.auditEntries).toHaveLength(0);
  });

  it('[TC-AUDIT-ATOMIC-001] un comando rechazado (zona inválida) no deja registro de auditoría', async () => {
    await expect(
      svc.updateWorkspaceSettings(owner.id, w1, 1, { timezone: 'Mars/Olympus' }),
    ).rejects.toThrow();
    expect(mem.auditEntries).toHaveLength(0);
  });

  it('crear un workspace audita su creación y la membresía OWNER del creador', async () => {
    const { workspace } = await svc.createWorkspace(owner.id, {
      name: 'Hogar',
      baseCurrency: 'BOB',
      timezone: 'America/La_Paz',
      locale: 'es-BO',
    });
    expect(mem.auditEntries.map((a) => [a.action, a.workspaceId])).toEqual([
      ['identity.workspace.created', workspace.id],
      ['identity.workspace.member_added', workspace.id],
    ]);
    expect(mem.auditEntries[0]?.changes).toContainEqual({ field: 'name', before: null, after: 'Hogar' });
    expect(mem.auditEntries[1]?.changes).toEqual([
      { field: 'memberUserId', before: null, after: owner.id },
      { field: 'memberRole', before: null, after: 'OWNER' },
    ]);
  });

  it('PATCH /me audita el diff del perfil en el workspace hogar del usuario', async () => {
    await svc.updateMyPreferences(owner.id, 1, { locale: 'en-US', timezone: 'America/Sao_Paulo' });
    expect(mem.auditEntries).toEqual([
      {
        workspaceId: [w1, w2].sort()[0],
        action: 'identity.user.preferences_changed',
        aggregateType: 'User',
        aggregateId: owner.id,
        aggregateVersion: 2,
        changes: [
          { field: 'locale', before: 'es-BO', after: 'en-US' },
          { field: 'timeZone', before: null, after: 'America/Sao_Paulo' },
        ],
        actor: { type: 'USER', userId: owner.id },
      },
    ]);
    // Sin cambios efectivos no hay auditoría.
    await svc.updateMyPreferences(owner.id, 2, { locale: 'en-US' });
    expect(mem.auditEntries).toHaveLength(1);
  });

  it('[TC-AUDIT-SESSION-001] inicio y cierre de sesión se auditan en el workspace activo (o el hogar); sin workspaces se omiten', async () => {
    expect(await svc.recordSessionEvent(owner.id, 'STARTED', w2)).toBe(w2);
    expect(await svc.recordSessionEvent(owner.id, 'ENDED', null)).toBe([w1, w2].sort()[0]);
    // Un workspace activo del que ya no es miembro cae al hogar.
    const foreign = mem.addWorkspace('Ajeno', [[lonely, 'OWNER']]).id;
    expect(await svc.recordSessionEvent(owner.id, 'STARTED', foreign)).toBe([w1, w2].sort()[0]);
    expect(mem.auditEntries.map((a) => [a.action, a.aggregateType, a.aggregateId])).toEqual([
      ['identity.session.started', 'User', owner.id],
      ['identity.session.ended', 'User', owner.id],
      ['identity.session.started', 'User', owner.id],
    ]);
    const nobody = mem.addUser('nobody@demo.pfos.test');
    expect(await svc.recordSessionEvent(nobody.id, 'STARTED', null)).toBeNull();
    expect(mem.auditEntries).toHaveLength(3);
  });
});
