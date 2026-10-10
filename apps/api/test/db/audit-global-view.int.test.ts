import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx } from '../support/db.js';

// Soporte de base de datos de la vista global del log de auditoría (openspec add-global-audit-view 3.3 y 4.1):
// `iam.workspace_exists` (existencia sin filtrar filas) y los planes de ejecución de los filtros nuevos sobre un
// volumen grande de `audit.audit_log`, con los índices `audit_log_correlation_idx` y `audit_log_action_idx`.
const deps = inject('deps');

describe('audit.audit_log: índices de la vista global y planes (EXPLAIN)', () => {
  let migrator: Client;
  let app: Client;
  let owner: string;
  const ws = randomUUID();
  const actor = randomUUID();
  const operation = randomUUID();
  const ROWS = 300_000;

  async function provision(label: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/gaudit', $1, $2, $3) AS id`,
      [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
    );
    return rows[0]?.id as string;
  }

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    owner = await provision('owner');
    await inTx(
      app,
      { userId: owner, workspaceId: ws },
      async () => {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W gaudit', 'BOB', 'America/La_Paz', 'es-BO')`,
          [ws],
        );
        await app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, owner],
        );
        // Tipo `Budget` (sin máquina de estados): el job `audit.lifecycle-backfill` del worker de otros tests no recorre
        // estos agregados sintéticos (con `Transaction` tardaría minutos y bloquearía el cierre de esos workers).
        // Volumen "large": 300 000 registros a lo largo de 12 meses (la DEFAULT y las particiones mensuales), con 50
        // actores, 14 acciones (2 de seguridad, 0,1 %) y 6 000 operaciones; una operación concreta de 4 registros.
        await app.query(
          `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
             aggregate_type, aggregate_id, origin, correlation_id)
           SELECT gen_random_uuid(),
                  timestamptz '2026-01-01T00:00:00Z' + (g * interval '105 seconds'),
                  $1, 'USER',
                  ('00000000-0000-7000-8000-' || lpad((g % 50)::text, 12, '0'))::uuid,
                  CASE g % 2000 WHEN 0 THEN 'identity.session.started' WHEN 1000 THEN 'security.authorization.denied'
                       ELSE (ARRAY['transactions.transaction.created','transactions.transaction.updated',
                         'transactions.transaction.voided','accounts.account.opened','accounts.account.archived',
                         'planning.budget.updated','planning.period.closed','classification.category.created',
                         'fx.exchange_rate.recorded','ledger.journal_entry.posted','identity.workspace.created',
                         'transactions.transaction.bulk_edited'])[1 + (g % 12)] END,
                  'Budget', gen_random_uuid(), 'ui',
                  ('10000000-0000-7000-8000-' || lpad((g % 6000)::text, 12, '0'))::uuid
             FROM generate_series(1, ${ROWS}) g`,
          [ws],
        );
        await app.query(
          `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
             aggregate_type, aggregate_id, origin, correlation_id)
           SELECT gen_random_uuid(), timestamptz '2026-06-15T12:00:00Z' + (g * interval '1 second'), $1, 'USER', $2,
                  'transactions.transaction.bulk_edited', 'Budget', gen_random_uuid(), 'ui', $3
             FROM generate_series(1, 4) g`,
          [ws, actor, operation],
        );
      },
      true,
    );
    // ANALYZE como pf_migrator (dueño): estadísticas reales para el planificador.
    await migrator.query('ANALYZE audit.audit_log');
  }, 300_000);

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  /** Plan (JSON) de la consulta con el contexto RLS del workspace; devuelve nodos y relaciones recorridas. */
  async function plan(sql: string, params: unknown[]): Promise<{ nodes: string[]; text: string }> {
    return inTx(app, { userId: owner, workspaceId: ws }, async () => {
      const { rows } = await app.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON) ${sql}`, params);
      const text = JSON.stringify(rows[0]?.['QUERY PLAN']);
      const nodes = [...text.matchAll(/"Node Type":"([^"]+)"/g)].map((m) => m[1]!);
      return { nodes, text };
    });
  }

  const SELECT = 'SELECT * FROM audit.audit_log a WHERE a.workspace_id = $1';
  // Catálogo SECURITY de packages/contexts/audit/src/domain/audit-action-category.ts (el SQL lo recibe como lista exacta).
  const SECURITY = [
    'identity.session.started',
    'identity.session.ended',
    'security.authorization.denied',
    'identity.workspace.settings_changed',
    'identity.workspace.restored',
    'planning.period.reopened',
    'audit.log.exported',
    'audit.lifecycle.exported',
  ];
  const ORDER = 'ORDER BY occurred_at DESC, id DESC LIMIT 51';

  it('[TC-AUDIT-GLOBAL-007] por correlación: índice (workspace_id, correlation_id), sin escaneo secuencial', async () => {
    const p = await plan(`${SELECT} AND a.correlation_id = $2 ${ORDER}`, [ws, operation]);
    expect(p.text).toMatch(/workspace_id_correlation_id_idx/);
    expect(p.nodes).not.toContain('Seq Scan');
  });

  it('[TC-AUDIT-GLOBAL-001] por actor y rango: índice por actor/recientes, sin escaneo secuencial', async () => {
    const p = await plan(
      `${SELECT} AND a.actor_user_id = $2 AND a.occurred_at >= $3 AND a.occurred_at < $4 ${ORDER}`,
      [ws, actor, '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z'],
    );
    expect(p.text).toMatch(/workspace_id_actor_user_id_occurred_at_idx/);
    expect(p.nodes).not.toContain('Seq Scan');
  });

  it('[TC-AUDIT-GLOBAL-006] por acción (eventos de seguridad): índice (workspace_id, action, occurred_at DESC)', async () => {
    const p = await plan(`${SELECT} AND a.action = ANY ($2::text[]) ${ORDER}`, [ws, SECURITY]);
    expect(p.text).toMatch(/workspace_id_action_occurred_at_idx/);
    expect(p.nodes).not.toContain('Seq Scan');
    const exact = await plan(`${SELECT} AND a.action = $2 ${ORDER}`, [ws, 'audit.log.exported']);
    expect(exact.text).toMatch(/workspace_id_action_occurred_at_idx/);
    expect(exact.nodes).not.toContain('Seq Scan');
  });

  it('por entidad: el índice existente (workspace_id, aggregate_type, aggregate_id)', async () => {
    const p = await plan(`${SELECT} AND a.aggregate_type = 'Budget' AND a.aggregate_id = $2 ${ORDER}`, [
      ws,
      randomUUID(),
    ]);
    expect(p.text).toMatch(/workspace_id_aggregate_type_aggregate_id/);
    expect(p.nodes).not.toContain('Seq Scan');
  });

  it('la consulta por correlación devuelve exactamente los 4 registros de la operación', async () => {
    const rows = await inTx(app, { userId: owner, workspaceId: ws }, async () =>
      app.query(`${SELECT} AND a.correlation_id = $2`, [ws, operation]),
    );
    expect(rows.rows).toHaveLength(4);
  });
});

describe('iam.workspace_exists (auditoría de rechazos de no miembros)', () => {
  let migrator: Client;
  let app: Client;
  let owner: string;
  let outsider: string;
  const real = randomUUID();
  const other = randomUUID();

  async function provision(label: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/gaudit', $1, $2, $3) AS id`,
      [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
    );
    return rows[0]?.id as string;
  }

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    owner = await provision('owner');
    outsider = await provision('outsider');
    for (const [user, id] of [
      [owner, real],
      [outsider, other],
    ] as const) {
      await inTx(
        app,
        { userId: user, workspaceId: id },
        async () => {
          await app.query(
            `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W', 'BOB', 'America/La_Paz', 'es-BO')`,
            [id],
          );
          await app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
            [id, user],
          );
        },
        true,
      );
    }
  });

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  const exists = (user: string, ctxWorkspace: string, probe: string) =>
    inTx(
      app,
      { userId: user, workspaceId: ctxWorkspace },
      async () =>
        (await app.query<{ e: boolean }>('SELECT iam.workspace_exists($1::uuid) AS e', [probe])).rows[0]!.e,
    );

  it('un no miembro sabe (solo el booleano) si el workspace existe; uno inventado devuelve false', async () => {
    // El contexto RLS es el del workspace OBJETIVO, como en el registrador de rechazos.
    expect(await exists(outsider, real, real)).toBe(true);
    expect(await exists(outsider, other, other)).toBe(true);
    expect(await exists(outsider, randomUUID(), randomUUID())).toBe(false);
  });

  it('no filtra filas: el no miembro sigue sin ver el workspace ajeno y fijar la GUC no le da acceso', async () => {
    const seen = await inTx(app, { userId: outsider, workspaceId: other }, async () => {
      await app.query(`SELECT set_config('pf.workspace_probe', $1, true)`, [real]);
      return (await app.query<{ id: string }>('SELECT id FROM iam.workspace')).rows.map((r) => r.id);
    });
    expect(seen).toEqual([other]);
  });

  it('el dueño de la tabla (migrador) sigue sin ver filas fuera de la función: la GUC no persiste', async () => {
    await migrator.query('BEGIN');
    try {
      await migrator.query('SELECT iam.workspace_exists($1::uuid)', [real]);
      const { rows } = await migrator.query('SELECT id FROM iam.workspace WHERE id = $1', [real]);
      expect(rows).toEqual([]);
    } finally {
      await migrator.query('ROLLBACK');
    }
  });
});

describe('iam.audit_actor_names (nombre visible de los actores del log, fix-phase-2-gaps)', () => {
  let migrator: Client;
  let app: Client;
  let owner: string;
  let actor: string;
  let stranger: string;
  const ws = randomUUID();
  const other = randomUUID();

  async function provision(label: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/gaudit', $1, $2, $3) AS id`,
      [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, `Nombre ${label}`],
    );
    return rows[0]?.id as string;
  }

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    owner = await provision('owner');
    actor = await provision('actor');
    stranger = await provision('stranger');
    for (const id of [ws, other]) {
      await inTx(
        app,
        { userId: owner, workspaceId: id },
        async () => {
          await app.query(
            `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W', 'BOB', 'America/La_Paz', 'es-BO')`,
            [id],
          );
          await app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
            [id, owner],
          );
        },
        true,
      );
    }
    await inTx(
      app,
      { userId: owner, workspaceId: ws },
      async () => {
        await app.query(
          `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
             aggregate_type, aggregate_id, origin, correlation_id)
           VALUES ($1, now(), $2, 'USER', $3, 'transactions.transaction.created', 'Transaction', $4, 'ui', $5)`,
          [randomUUID(), ws, actor, randomUUID(), randomUUID()],
        );
      },
      true,
    );
  });

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  const names = (ctxWorkspace: string, asked: string, ids: string[]) =>
    inTx(
      app,
      { userId: owner, workspaceId: ctxWorkspace },
      async () =>
        (
          await app.query<{ user_id: string; display_name: string }>(
            'SELECT user_id, display_name FROM iam.audit_actor_names($1::uuid, $2::uuid[])',
            [asked, ids],
          )
        ).rows,
    );

  it('[TC-AUDIT-GLOBAL-008] devuelve el nombre solo de los usuarios de la lista que son actores del log del workspace', async () => {
    const rows = await names(ws, ws, [actor, stranger, owner]);
    expect(rows).toEqual([{ user_id: actor, display_name: 'Nombre actor' }]);
  });

  it('exige que el contexto RLS sea el del workspace pedido y no filtra filas de audit.audit_log al dueño', async () => {
    await expect(names(other, ws, [actor])).rejects.toMatchObject({ code: '42501' });
    await migrator.query('BEGIN');
    try {
      await migrator.query('SELECT set_config($1, $2, true)', ['app.workspace_id', ws]);
      await migrator.query('SELECT * FROM iam.audit_actor_names($1::uuid, $2::uuid[])', [ws, [actor]]);
      const { rows } = await migrator.query('SELECT 1 FROM audit.audit_log WHERE workspace_id = $1', [ws]);
      expect(rows).toEqual([]);
    } finally {
      await migrator.query('ROLLBACK');
    }
  });

  it('fijar la GUC de sondeo no da a pf_app acceso a filas de otro workspace', async () => {
    const seen = await inTx(app, { userId: owner, workspaceId: other }, async () => {
      await app.query(`SELECT set_config('pf.audit_actor_probe', $1, true)`, [ws]);
      return (await app.query('SELECT 1 FROM audit.audit_log')).rows;
    });
    expect(seen).toEqual([]);
  });
});
