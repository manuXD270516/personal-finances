import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { IdentityService } from '../../src/application/identity.service.js';
import type { AuditEntry, OutboxEvent, VerifiedIdentity } from '../../src/application/ports/index.js';
import { pgIdentityDeps } from '../../src/infrastructure/pg-identity.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string };
  }
}

const deps = inject('deps');
const ISS = 'https://idp.test/realms/pfos';

describe('Repositorios PostgreSQL de IDENTITY (tareas 6.1 y 6.2)', () => {
  let pool: Pool;
  let migrator: Pool;
  let svc: IdentityService;
  const events: OutboxEvent[] = [];
  const audits: AuditEntry[] = [];

  const identity = (subject: string, over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
    issuer: ISS,
    subject,
    email: `${subject}@demo.pfos.test`,
    emailVerified: true,
    displayName: subject,
    ...over,
  });

  beforeAll(() => {
    pool = new Pool({ connectionString: deps.databaseUrl, max: 6 });
    migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
    svc = new IdentityService(
      pgIdentityDeps({
        pool,
        outbox: { append: async (e) => void events.push(e) },
        audit: { record: async (a) => void audits.push(a) },
        clock: new FixedClock(Instant.parse('2026-10-02T12:00:00Z')),
        defaults: {
          baseCurrency: 'BOB',
          timeZone: 'America/La_Paz',
          locale: 'es-BO',
          personalWorkspaceName: 'Personal',
        },
      }),
    );
  });

  /** Consulta como pf_app con contexto RLS (el owner tampoco ve filas de tablas con RLS FORZADA). */
  async function asApp(
    ctx: { userId: string; workspaceId?: string },
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [ctx.userId, ctx.workspaceId ?? ''],
      );
      const res = await client.query(text, values);
      await client.query('COMMIT');
      return res;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    await pool?.end();
    await migrator?.end();
  });

  it('[TC-IDENTITY-AUTH-007] el alta JIT es idempotente por (iss, sub), actualiza el email y no crea usuarios sin email verificado', async () => {
    const sub = `kc-0001-${randomUUID()}`;
    const first = await svc.provision(identity(sub));
    const second = await svc.provision(identity(sub));
    expect(second.userId).toBe(first.userId);
    await svc.provision(identity(sub, { email: `nuevo2-${sub}@demo.pfos.test` }));
    const { rows } = await migrator.query(
      'SELECT id, email FROM iam."user" WHERE idp_issuer = $1 AND idp_subject = $2',
      [ISS, sub],
    );
    expect(rows).toEqual([{ id: first.userId, email: `nuevo2-${sub}@demo.pfos.test` }]);

    const unverified = `kc-0002-${randomUUID()}`;
    await expect(svc.provision(identity(unverified, { emailVerified: false }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const none = await migrator.query('SELECT 1 FROM iam."user" WHERE idp_subject = $1', [unverified]);
    expect(none.rowCount).toBe(0);
  });

  it('[TC-IDENTITY-WORKSPACE-002] dos primeros logins concurrentes crean un único workspace personal y un único evento', async () => {
    const sub = `kc-race-${randomUUID()}`;
    const before = events.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => svc.provision(identity(sub))));
    const userIds = new Set(results.map((r) => r.userId));
    expect(userIds.size).toBe(1);
    const created = results.filter((r) => r.createdWorkspaceId !== null);
    expect(created).toHaveLength(1);
    const userId = [...userIds][0] as string;
    const ws = await asApp({ userId }, 'SELECT id FROM iam.workspace WHERE personal_of_user_id = $1', [
      userId,
    ]);
    expect(ws.rowCount).toBe(1);
    const owners = await asApp(
      { userId },
      `SELECT role FROM iam.workspace_membership WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    expect(owners.rows).toEqual([{ role: 'OWNER' }]);
    expect(events.slice(before).filter((e) => e.eventType === 'identity.WorkspaceCreated')).toHaveLength(1);
    // Un tercer login no crea nada.
    expect((await svc.provision(identity(sub))).createdWorkspaceId).toBeNull();
  });

  it('[TC-IDENTITY-WORKSPACE-005] la reserva mínima se guarda y se lee como string decimal exacto en la escala de su moneda', async () => {
    const { userId, createdWorkspaceId } = await svc.provision(identity(`kc-reserve-${randomUUID()}`));
    const wsId = createdWorkspaceId as string;
    await svc.updateWorkspaceSettings(userId, wsId, 1, {
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
      fiscalMonthStartDay: 25,
      baseCurrency: 'USD',
    });
    await expect(
      svc.updateWorkspaceSettings(userId, wsId, 2, {
        minimumLiquidityReserve: { amount: '1500.005', currency: 'BOB' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_SCALE_EXCEEDED' });
    await expect(svc.updateWorkspaceSettings(userId, wsId, 1, { name: 'stale' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const { workspace } = await svc.getWorkspace(userId, wsId);
    expect(workspace.version).toBe(2);
    expect(workspace.settings.baseCurrency).toEqual({ code: 'USD', scale: 2 });
    expect(workspace.settings.fiscalMonthStartDay).toBe(25);
    expect(workspace.settings.minimumLiquidityReserve?.toJSON()).toEqual({
      amount: '1500.00',
      currency: 'BOB',
    });
    const raw = await asApp(
      { userId, workspaceId: wsId },
      'SELECT min_liquidity_reserve_amount AS amount FROM iam.workspace WHERE id = $1',
      [wsId],
    );
    expect(typeof raw.rows[0]?.amount).toBe('string');
  });

  it('[TC-IDENTITY-MEMBERSHIP-001] un no miembro recibe WORKSPACE_ACCESS_DENIED y su listado no incluye el workspace ajeno', async () => {
    const a = await svc.provision(identity(`kc-a-${randomUUID()}`));
    const b = await svc.provision(identity(`kc-b-${randomUUID()}`));
    await expect(svc.getWorkspace(b.userId, a.createdWorkspaceId as string)).rejects.toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
    });
    await expect(
      svc.updateWorkspaceSettings(b.userId, a.createdWorkspaceId as string, 1, { name: 'Hack' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ACCESS_DENIED' });
    expect((await svc.listMyWorkspaces(b.userId)).map((w) => w.id)).toEqual([b.createdWorkspaceId]);
  });

  it('[TC-IDENTITY-WORKSPACE-007] crear un workspace adicional deja al creador como OWNER; moneda inexistente → REFERENCE_NOT_FOUND', async () => {
    const { userId } = await svc.provision(identity(`kc-hogar-${randomUUID()}`));
    const { workspace } = await svc.createWorkspace(userId, {
      name: 'Hogar',
      baseCurrency: 'BOB',
      timezone: 'America/La_Paz',
      locale: 'es-BO',
    });
    const list = await svc.listMyWorkspaces(userId);
    expect(list.filter((w) => w.name === 'Hogar')).toEqual([
      { id: workspace.id, name: 'Hogar', role: 'OWNER', baseCurrency: 'BOB' },
    ]);
    await expect(
      svc.createWorkspace(userId, { name: 'X', baseCurrency: 'XYZ', timezone: 'UTC', locale: 'es-BO' }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });

  it('la BD exige al menos un OWNER activo (constraint trigger diferido)', async () => {
    const { userId, createdWorkspaceId } = await svc.provision(identity(`kc-owner-${randomUUID()}`));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [userId, createdWorkspaceId],
      );
      await client.query(`UPDATE iam.workspace_membership SET role = 'EDITOR' WHERE workspace_id = $1`, [
        createdWorkspaceId,
      ]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      client.release();
    }
  });
});
