import { isDomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityService } from './identity.service.js';
import type { VerifiedIdentity } from './ports/index.js';
import { InMemoryIdentity } from './testing/in-memory.js';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return isDomainError(err) ? err.code : `NOT_DOMAIN_ERROR: ${String(err)}`;
  }
  return undefined;
}

const ISS = 'http://keycloak.test/realms/pfos';
const identity = (over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  issuer: ISS,
  subject: 'kc-0001',
  email: 'nuevo@demo.pfos.test',
  emailVerified: true,
  displayName: 'Nuevo',
  ...over,
});

describe('ProvisionUserFromIdentity', () => {
  let mem: InMemoryIdentity;
  let svc: IdentityService;
  beforeEach(() => {
    mem = new InMemoryIdentity();
    svc = new IdentityService(mem.deps());
  });

  it('[TC-IDENTITY-AUTH-007] provisiona exactamente un usuario, actualiza el email y rechaza emails no verificados', async () => {
    const first = await svc.provision(identity());
    const second = await svc.provision(identity());
    expect(second.userId).toBe(first.userId);
    const third = await svc.provision(identity({ email: 'nuevo2@demo.pfos.test' }));
    expect(third.userId).toBe(first.userId);
    expect(mem.users.size).toBe(1);
    expect(mem.users.get(first.userId)?.email).toBe('nuevo2@demo.pfos.test');

    expect(await codeOf(svc.provision(identity({ subject: 'kc-0002', emailVerified: false })))).toBe(
      'UNAUTHENTICATED',
    );
    expect(mem.users.size).toBe(1);
  });

  it('[TC-IDENTITY-WORKSPACE-001] el primer login crea el workspace personal (BOB, America/La_Paz, OWNER) con WorkspaceCreated PERSONAL_DEFAULT', async () => {
    const { userId, createdWorkspaceId } = await svc.provision(identity());
    expect(createdWorkspaceId).not.toBeNull();
    const ws = mem.workspaces.get(createdWorkspaceId as string);
    expect(ws?.settings.baseCurrency.code).toBe('BOB');
    expect(ws?.settings.timeZone.value).toBe('America/La_Paz');
    expect(ws?.settings.locale.value).toBe('es-BO');
    expect(ws?.settings.fiscalMonthStartDay).toBe(1);
    expect(ws?.settings.minimumLiquidityReserve).toBeNull();
    expect(ws?.memberships).toEqual([{ userId, role: 'OWNER', status: 'ACTIVE' }]);
    expect(ws?.personalOfUserId).toBe(userId);
    expect(mem.outboxEvents).toHaveLength(1);
    expect(mem.outboxEvents[0]).toMatchObject({
      eventType: 'identity.WorkspaceCreated',
      eventVersion: 1,
      aggregateType: 'Workspace',
      aggregateVersion: 1,
      payload: {
        origin: 'PERSONAL_DEFAULT',
        baseCurrency: 'BOB',
        ownerUserId: userId,
        fiscalMonthStartDay: 1,
      },
    });
    expect(mem.auditEntries.map((a) => a.action)).toEqual([
      'identity.workspace.created',
      'identity.user.provisioned',
    ]);
    // La transacción fija el workspace nuevo como contexto RLS antes de insertarlo.
    expect(mem.contexts).toContainEqual({ userId, workspaceId: createdWorkspaceId });
  });

  it('[TC-IDENTITY-WORKSPACE-001] un usuario que ya es miembro (viewer de W1) no recibe workspace personal', async () => {
    const owner = mem.addUser('owner@demo.pfos.test');
    const viewer = mem.addUser('viewer@demo.pfos.test', 'kc-viewer');
    const w1 = mem.addWorkspace('Personal Demo', [
      [owner, 'OWNER'],
      [viewer, 'VIEWER'],
    ]);
    const result = await svc.provision(identity({ subject: 'kc-viewer', email: 'viewer@demo.pfos.test' }));
    expect(result).toEqual({ userId: viewer.id, createdWorkspaceId: null });
    expect((await svc.listMyWorkspaces(viewer.id)).map((w) => w.id)).toEqual([w1.id]);
    expect(mem.outboxEvents).toHaveLength(0);
  });

  it('[TC-IDENTITY-WORKSPACE-002] logins repetidos no crean un segundo workspace personal ni otro evento', async () => {
    await svc.provision(identity());
    await svc.provision(identity());
    await svc.provision(identity());
    expect(mem.workspaces.size).toBe(1);
    expect(mem.outboxEvents.filter((e) => e.eventType === 'identity.WorkspaceCreated')).toHaveLength(1);
  });
});

describe('Me, workspaces y autorización', () => {
  let mem: InMemoryIdentity;
  let svc: IdentityService;
  let owner: ReturnType<InMemoryIdentity['addUser']>;
  let editor: ReturnType<InMemoryIdentity['addUser']>;
  let viewer: ReturnType<InMemoryIdentity['addUser']>;
  let outsider: ReturnType<InMemoryIdentity['addUser']>;
  let w1: string;
  let w2: string;

  beforeEach(() => {
    mem = new InMemoryIdentity();
    svc = new IdentityService(mem.deps());
    owner = mem.addUser('owner@demo.pfos.test');
    editor = mem.addUser('editor@demo.pfos.test');
    viewer = mem.addUser('viewer@demo.pfos.test');
    outsider = mem.addUser('outsider@demo.pfos.test');
    w1 = mem.addWorkspace('Personal Demo', [
      [owner, 'OWNER'],
      [editor, 'EDITOR'],
      [viewer, 'VIEWER'],
    ]).id;
    w2 = mem.addWorkspace('Other Demo', [
      [outsider, 'OWNER'],
      [owner, 'OWNER'],
    ]).id;
  });

  it('[TC-IDENTITY-AUTH-006] getMe devuelve el perfil y solo las membresías activas', async () => {
    const me = await svc.getMe(owner.id);
    expect(me.user.email).toBe('owner@demo.pfos.test');
    expect(me.user.locale.value).toBe('es-BO');
    expect(me.workspaces.map((w) => [w.name, w.role])).toEqual([
      ['Personal Demo', 'OWNER'],
      ['Other Demo', 'OWNER'],
    ]);
  });

  it('[TC-IDENTITY-AUTH-008] actualiza locale y zona horaria; una zona inválida → INVALID_TIMEZONE sin cambios', async () => {
    const updated = await svc.updateMyPreferences(owner.id, 1, {
      locale: 'en-US',
      timezone: 'America/Sao_Paulo',
    });
    expect(updated.version).toBe(2);
    expect(await codeOf(svc.updateMyPreferences(owner.id, 2, { timezone: 'Mars/Olympus' }))).toBe(
      'INVALID_TIMEZONE',
    );
    expect(await codeOf(svc.updateMyPreferences(owner.id, 1, { locale: 'es-BO' }))).toBe(
      'PRECONDITION_FAILED',
    );
    const me = await svc.getMe(owner.id);
    expect(me.user.timeZone?.value).toBe('America/Sao_Paulo');
    expect(me.user.locale.value).toBe('en-US');
  });

  it('[TC-IDENTITY-WORKSPACE-003] el OWNER configura el workspace; valores inválidos se rechazan sin cambios', async () => {
    const { view, changes } = await svc.updateWorkspaceSettings(owner.id, w1, 1, {
      name: 'Casa',
      timezone: 'America/Sao_Paulo',
      fiscalMonthStartDay: 25,
    });
    expect(view.workspace.version).toBe(2);
    expect(changes.map((c) => c.field)).toEqual(['name', 'timeZone', 'fiscalMonthStartDay']);
    expect(mem.outboxEvents.at(-1)).toMatchObject({
      eventType: 'identity.WorkspaceSettingsChanged',
      aggregateVersion: 2,
    });

    expect(await codeOf(svc.updateWorkspaceSettings(owner.id, w1, 2, { timezone: 'Mars/Olympus' }))).toBe(
      'INVALID_TIMEZONE',
    );
    expect(await codeOf(svc.updateWorkspaceSettings(owner.id, w1, 2, { fiscalMonthStartDay: 29 }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(svc.updateWorkspaceSettings(owner.id, w1, 2, { baseCurrency: 'XYZ' }))).toBe(
      'REFERENCE_NOT_FOUND',
    );
    const after = await svc.getWorkspace(owner.id, w1);
    expect(after.workspace.version).toBe(2);
    expect(after.workspace.settings.name).toBe('Casa');
    expect(mem.outboxEvents.filter((e) => e.eventType === 'identity.WorkspaceSettingsChanged')).toHaveLength(
      1,
    );
  });

  it('[TC-IDENTITY-WORKSPACE-004] cambiar la moneda base solo cambia la configuración del workspace', async () => {
    const { changes } = await svc.updateWorkspaceSettings(owner.id, w1, 1, { baseCurrency: 'USD' });
    expect(changes).toEqual([{ field: 'baseCurrency', before: 'BOB', after: 'USD' }]);
    expect((await svc.getWorkspace(owner.id, w1)).workspace.settings.baseCurrency).toEqual({
      code: 'USD',
      scale: 2,
    });
  });

  it('[TC-IDENTITY-WORKSPACE-005] la reserva mínima respeta la escala de su moneda', async () => {
    await svc.updateWorkspaceSettings(owner.id, w1, 1, {
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
    });
    expect(
      await codeOf(
        svc.updateWorkspaceSettings(owner.id, w1, 2, {
          minimumLiquidityReserve: { amount: '1500.005', currency: 'BOB' },
        }),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    let ws = (await svc.getWorkspace(owner.id, w1)).workspace;
    expect(ws.settings.minimumLiquidityReserve?.toJSON()).toEqual({ amount: '1500.00', currency: 'BOB' });
    await svc.updateWorkspaceSettings(owner.id, w1, 2, { minimumLiquidityReserve: null });
    ws = (await svc.getWorkspace(owner.id, w1)).workspace;
    expect(ws.settings.minimumLiquidityReserve).toBeNull();
  });

  it('[TC-IDENTITY-WORKSPACE-006] el listado muestra solo las membresías activas del usuario', async () => {
    expect((await svc.listMyWorkspaces(owner.id)).map((w) => w.name)).toEqual([
      'Personal Demo',
      'Other Demo',
    ]);
    expect((await svc.listMyWorkspaces(outsider.id)).map((w) => w.name)).toEqual(['Other Demo']);
  });

  it('[TC-IDENTITY-WORKSPACE-007] crear un workspace deja al creador como OWNER con WorkspaceCreated USER_CREATED', async () => {
    const { workspace, role } = await svc.createWorkspace(viewer.id, {
      name: 'Hogar',
      baseCurrency: 'BOB',
      timezone: 'America/La_Paz',
      locale: 'es-BO',
    });
    expect(role).toBe('OWNER');
    expect(workspace.personalOfUserId).toBeNull();
    expect(mem.outboxEvents.at(-1)?.payload).toMatchObject({ origin: 'USER_CREATED', name: 'Hogar' });
    expect((await svc.listMyWorkspaces(viewer.id)).filter((w) => w.name === 'Hogar')).toHaveLength(1);
    expect(
      await codeOf(
        svc.createWorkspace(viewer.id, { name: 'X', baseCurrency: 'XYZ', timezone: 'UTC', locale: 'es-BO' }),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-SECURITY-RBAC-001] VIEWER lee pero no puede escribir: INSUFFICIENT_ROLE', async () => {
    expect(await svc.authorize(viewer.id, w1, 'finance:read')).toBe('VIEWER');
    expect(await codeOf(svc.authorize(viewer.id, w1, 'finance:write'))).toBe('INSUFFICIENT_ROLE');
    expect(await svc.authorize(editor.id, w1, 'finance:write')).toBe('EDITOR');
  });

  it('[TC-SECURITY-RBAC-003] EDITOR no puede modificar la configuración: INSUFFICIENT_ROLE sin cambios ni evento', async () => {
    expect(await codeOf(svc.updateWorkspaceSettings(editor.id, w1, 1, { baseCurrency: 'USD' }))).toBe(
      'INSUFFICIENT_ROLE',
    );
    const ws = (await svc.getWorkspace(owner.id, w1)).workspace;
    expect(ws.settings.baseCurrency.code).toBe('BOB');
    expect(ws.version).toBe(1);
    expect(mem.outboxEvents).toHaveLength(0);
  });

  it('[TC-IDENTITY-MEMBERSHIP-001] un no miembro recibe WORKSPACE_ACCESS_DENIED en lectura y escritura', async () => {
    expect(await codeOf(svc.getWorkspace(outsider.id, w1))).toBe('WORKSPACE_ACCESS_DENIED');
    expect(await codeOf(svc.updateWorkspaceSettings(outsider.id, w1, 1, { name: 'Hack' }))).toBe(
      'WORKSPACE_ACCESS_DENIED',
    );
    expect((await svc.getWorkspace(owner.id, w1)).workspace.settings.name).toBe('Personal Demo');
    expect((await svc.listMyWorkspaces(outsider.id)).map((w) => w.id)).toEqual([w2]);
  });
});
