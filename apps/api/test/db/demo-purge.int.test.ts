import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx, rlsCatalogViolations, sqlState } from '../support/db.js';
import {
  createWorkspaceRow,
  demoPurgeCatalogViolations,
  provisionUser,
  purgeTables,
  rowsByTable,
  seedBusinessRows,
  unbalancedEntries,
} from '../support/demo-db.js';

const deps = inject('deps');

/**
 * Barreras de base de datos de ADR-0026 (openspec add-demo-data, tareas 4.1–4.3; suite de seguridad): marca demo
 * inmutable, `platform.purge_demo_workspace()` acotada a workspaces demo en limpieza e invocable solo por
 * `pf_worker`, nueva versión de `platform.forbid_mutation()` y catálogo completo de tablas acotadas por workspace.
 */
describe('purga de workspaces demo (ADR-0026, security)', () => {
  let migrator: Client;
  let app: Client;
  let worker: Client;
  let owner: string;
  const real = randomUUID();
  const demo = randomUUID();

  /** Pasa el demo a CLEANING + ARCHIVED con el rol de la app (lo que hace `CleanupDemoData`). */
  async function markCleaning(workspaceId: string): Promise<void> {
    await inTx(
      app,
      { userId: owner, workspaceId },
      async () => {
        await app.query(`UPDATE iam.workspace SET demo_status = 'READY' WHERE id = $1`, [workspaceId]);
        await app.query(
          `UPDATE iam.workspace SET demo_status = 'CLEANING', status = 'ARCHIVED', archived_at = now() WHERE id = $1`,
          [workspaceId],
        );
      },
      true,
    );
  }

  async function workerPurge(workspaceId: string): Promise<Record<string, number>> {
    const { rows } = await worker.query<{ r: Record<string, number> }>(
      'SELECT platform.purge_demo_workspace($1) AS r',
      [workspaceId],
    );
    return rows[0]!.r;
  }

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    worker = await connect(deps.workerDatabaseUrl);
    owner = await provisionUser(migrator, 'demo-owner');
    await createWorkspaceRow(app, { id: real, owner, name: 'W1 Personal Demo' });
    await seedBusinessRows(app, { userId: owner, workspaceId: real }, '1500.00');
    await createWorkspaceRow(app, { id: demo, owner, name: 'Demo — Finanzas de Valeria', demoOf: real });
    await seedBusinessRows(app, { userId: owner, workspaceId: demo }, '12000.00');
  });

  afterAll(async () => {
    await worker?.end();
    await app?.end();
    await migrator?.end();
  });

  it('[TC-IDENTITY-DEMO-005] la marca demo es inmutable para el rol de la app y para el de migraciones (PF003)', async () => {
    // pf_app con el contexto de cada workspace.
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: real }, () =>
          app.query('UPDATE iam.workspace SET is_demo = true WHERE id = $1', [real]),
        ),
      ),
    ).toBe('PF003');
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: demo }, () =>
          app.query('UPDATE iam.workspace SET is_demo = false WHERE id = $1', [demo]),
        ),
      ),
    ).toBe('PF003');
    // El origen tampoco puede reapuntarse (la purga usa la marca y el origen como evidencia).
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: demo }, () =>
          app.query('UPDATE iam.workspace SET demo_origin_workspace_id = $2 WHERE id = $1', [demo, demo]),
        ),
      ),
    ).toBe('PF003');
    // pf_migrator (dueño): con RLS forzada solo ve la fila apuntada por la GUC de purga; aun así el trigger rechaza.
    for (const [id, value] of [
      [real, true],
      [demo, false],
    ] as const) {
      await migrator.query('BEGIN');
      try {
        await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [id]);
        expect(
          await sqlState(() =>
            migrator.query('UPDATE iam.workspace SET is_demo = $2 WHERE id = $1', [id, value]),
          ),
        ).toBe('PF003');
      } finally {
        await migrator.query('ROLLBACK');
      }
    }
    // Un estado demo inválido también se rechaza (LOADING → CLEANING sin pasar por READY/FAILED).
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: demo }, () =>
          app.query(`UPDATE iam.workspace SET demo_status = 'CLEANING' WHERE id = $1`, [demo]),
        ),
      ),
    ).toBe('PF003');
    const { rows } = await migrator.query<{ id: string; is_demo: boolean }>(
      `SELECT w.id::text, w.is_demo FROM iam.workspace w WHERE w.id = ANY ($1::uuid[])`,
      [[real, demo]],
    );
    // Sin GUC, el dueño no ve filas (RLS forzada): la verificación se hace con la app.
    expect(rows).toEqual([]);
    const flags = await inTx(app, { userId: owner }, async () =>
      Object.fromEntries(
        (
          await app.query<{ id: string; is_demo: boolean }>(
            'SELECT id::text, is_demo FROM iam.workspace WHERE id = ANY ($1::uuid[])',
            [[real, demo]],
          )
        ).rows.map((r) => [r.id, r.is_demo]),
      ),
    );
    expect(flags).toEqual({ [real]: false, [demo]: true });
  });

  it('[TC-IDENTITY-DEMO-006] la purga directa se rechaza para un workspace real, un demo sin limpieza y llamadores distintos de pf_worker', async () => {
    const before = await rowsByTable(migrator, real);
    expect(before['ledger.posting']).toBe(2);
    expect(before['audit.audit_log']).toBe(1);

    // pf_worker sobre el workspace real ⇒ PF006.
    expect(await sqlState(() => workerPurge(real))).toBe('PF006');
    // pf_worker sobre un demo que no está en limpieza (LOADING) ⇒ PF006.
    expect(await sqlState(() => workerPurge(demo))).toBe('PF006');
    // Workspace inexistente o nulo ⇒ PF006.
    expect(await sqlState(() => workerPurge(randomUUID()))).toBe('PF006');
    expect(await sqlState(() => worker.query('SELECT platform.purge_demo_workspace(NULL)'))).toBe('PF006');
    // pf_app no tiene EXECUTE (ni fijando la GUC ni asumiendo pf_maintenance).
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: real }, async () => {
          await app.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [real]);
          await app.query('SELECT platform.purge_demo_workspace($1)', [real]);
        }),
      ),
    ).toBe('42501');
    // El dueño puede ejecutarla (es su función) pero la guarda de sesión lo rechaza: solo el worker purga.
    expect(await sqlState(() => migrator.query('SELECT platform.purge_demo_workspace($1)', [real]))).toBe(
      'PF006',
    );

    // DELETE directo con la GUC fijada: pf_app y pf_worker (y los roles que pueden asumir) no tienen grant.
    const attempts: [Client, string | null][] = [
      [app, null],
      [app, 'pf_maintenance'],
      [worker, null],
      [worker, 'pf_ledger_maintenance'],
      [worker, 'pf_maintenance'],
      [worker, 'pf_workspace_directory'],
    ];
    for (const [client, role] of attempts) {
      for (const table of ['ledger.posting', 'ledger.journal_entry', 'audit.audit_log']) {
        const state = await sqlState(() =>
          inTx(client, { userId: owner, workspaceId: real }, async () => {
            await client.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [real]);
            if (role) await client.query(`SET LOCAL ROLE ${role}`);
            await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [real]);
          }),
        );
        expect(state, `${table} ${role ?? 'login'}`).toBe('42501');
      }
    }
    // El dueño con la GUC del workspace real ve las filas pero el trigger las protege (no es demo) ⇒ PF003.
    await migrator.query('BEGIN');
    try {
      await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [real]);
      expect(
        await sqlState(() => migrator.query('DELETE FROM ledger.posting WHERE workspace_id = $1', [real])),
      ).toBe('PF003');
    } finally {
      await migrator.query('ROLLBACK');
    }

    expect(await rowsByTable(migrator, real)).toEqual(before);
    expect(await unbalancedEntries(migrator, real)).toEqual([]);
  });

  it('[TC-IDENTITY-DEMO-006] forbid_mutation() permite DELETE solo al dueño, con la GUC del mismo workspace demo en limpieza', async () => {
    // Tabla de prueba con la misma protección que las append-only (en una transacción que se revierte).
    const other = randomUUID();
    await createWorkspaceRow(app, {
      id: other,
      owner: await provisionUser(migrator, 'x'),
      name: 'Otro real',
    });
    const cleaning = randomUUID();
    const cleaningOwner = await provisionUser(migrator, 'cleaning');
    const cleaningOrigin = randomUUID();
    await createWorkspaceRow(app, { id: cleaningOrigin, owner: cleaningOwner, name: 'Origen' });
    await createWorkspaceRow(app, {
      id: cleaning,
      owner: cleaningOwner,
      name: 'Demo en limpieza',
      demoOf: cleaningOrigin,
    });
    await inTx(
      app,
      { userId: cleaningOwner, workspaceId: cleaning },
      async () => {
        await app.query(`UPDATE iam.workspace SET demo_status = 'READY' WHERE id = $1`, [cleaning]);
        await app.query(
          `UPDATE iam.workspace SET demo_status = 'CLEANING', status = 'ARCHIVED' WHERE id = $1`,
          [cleaning],
        );
      },
      true,
    );

    const tryDelete = async (guc: string | null, rowWorkspace: string) => {
      await migrator.query('BEGIN');
      try {
        await migrator.query('CREATE TABLE platform.fm_probe (workspace_id uuid NOT NULL)');
        await migrator.query(
          'CREATE TRIGGER fm_probe_immutable BEFORE UPDATE OR DELETE ON platform.fm_probe ' +
            'FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation()',
        );
        await migrator.query('INSERT INTO platform.fm_probe VALUES ($1)', [rowWorkspace]);
        if (guc !== null)
          await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [guc]);
        return await sqlState(() => migrator.query('DELETE FROM platform.fm_probe'));
      } finally {
        await migrator.query('ROLLBACK');
      }
    };
    // Sin GUC, con GUC de otro workspace, sobre un workspace real o con un demo que no está en limpieza ⇒ PF003.
    expect(await tryDelete(null, cleaning)).toBe('PF003');
    expect(await tryDelete(other, cleaning)).toBe('PF003');
    expect(await tryDelete(other, other)).toBe('PF003');
    expect(await tryDelete(demo, demo)).toBe('PF003'); // `demo` sigue en LOADING
    expect(await tryDelete('', cleaning)).toBe('PF003');
    // UPDATE siempre prohibido, incluso en la condición de purga.
    await migrator.query('BEGIN');
    try {
      await migrator.query('CREATE TABLE platform.fm_probe (workspace_id uuid NOT NULL)');
      await migrator.query(
        'CREATE TRIGGER fm_probe_immutable BEFORE UPDATE OR DELETE ON platform.fm_probe ' +
          'FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation()',
      );
      await migrator.query('INSERT INTO platform.fm_probe VALUES ($1)', [cleaning]);
      await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [cleaning]);
      expect(
        await sqlState(() => migrator.query('UPDATE platform.fm_probe SET workspace_id = workspace_id')),
      ).toBe('PF003');
    } finally {
      await migrator.query('ROLLBACK');
    }
    // La única combinación permitida: dueño + GUC = workspace de la fila + demo en CLEANING.
    expect(await tryDelete(cleaning, cleaning)).toBeUndefined();

    // Un rol que no es el dueño, aun con grant DELETE y la GUC correcta, choca con el trigger.
    await migrator.query('BEGIN');
    try {
      await migrator.query('CREATE TABLE platform.fm_probe_app (workspace_id uuid NOT NULL)');
      await migrator.query(
        'CREATE TRIGGER fm_probe_immutable BEFORE UPDATE OR DELETE ON platform.fm_probe_app ' +
          'FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation()',
      );
      await migrator.query('INSERT INTO platform.fm_probe_app VALUES ($1)', [cleaning]);
      await migrator.query('GRANT SELECT, DELETE ON platform.fm_probe_app TO pf_app');
      await migrator.query('GRANT pf_app TO pf_migrator WITH INHERIT FALSE, SET TRUE');
      await migrator.query('SET LOCAL ROLE pf_app');
      await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [cleaning]);
      expect(await sqlState(() => migrator.query('DELETE FROM platform.fm_probe_app'))).toBe('PF003');
    } finally {
      await migrator.query('ROLLBACK');
    }
  });

  it('[TC-IDENTITY-DEMO-011] la purga borra todas las filas del demo de toda tabla registrada y deja la lápida; el real no cambia', async () => {
    // Filas del demo también en tablas del worker (inbox, dead-letter, versión derivada de reporting).
    await inTx(
      worker,
      { userId: owner, workspaceId: demo },
      async () => {
        const eventId = randomUUID();
        await worker.query(
          `INSERT INTO platform.inbox (consumer, event_id, workspace_id) VALUES ('reporting.data-version', $1, $2)`,
          [eventId, demo],
        );
        await worker.query(
          `INSERT INTO platform.dead_letter (consumer, event_id, workspace_id, event_type, envelope, error, attempts)
           VALUES ('reporting.data-version', $1, $2, 'ledger.JournalEntryPosted', '{}'::jsonb, 'x', 6)`,
          [randomUUID(), demo],
        );
        await worker.query(
          `INSERT INTO reporting.workspace_data_version (workspace_id, version) VALUES ($1, 3)`,
          [demo],
        );
      },
      true,
    );
    const realBefore = await rowsByTable(migrator, real);
    const demoBefore = await rowsByTable(migrator, demo);
    expect(demoBefore['ledger.posting']).toBe(2);
    expect(demoBefore['platform.inbox']).toBe(1);
    expect(demoBefore['iam.workspace_membership']).toBe(1);

    await markCleaning(demo);
    const deleted = await workerPurge(demo);
    const tables = await purgeTables(migrator);
    expect(Object.keys(deleted).sort()).toEqual([...tables].sort());
    for (const t of tables) expect(deleted[t], t).toBe(demoBefore[t]);

    const after = await rowsByTable(migrator, demo);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    // Lápida y evidencia (consultadas por el solicitante: la app con su usuario).
    const tomb = await inTx(app, { userId: owner }, async () => ({
      run: (
        await app.query<{ purged: boolean; rows_deleted: Record<string, number> }>(
          `SELECT purged_at IS NOT NULL AS purged, rows_deleted FROM platform.demo_workspace_run WHERE workspace_id = $1`,
          [demo],
        )
      ).rows[0],
    }));
    expect(tomb.run?.purged).toBe(true);
    expect(tomb.run?.rows_deleted).toEqual(deleted);
    await migrator.query('BEGIN');
    try {
      await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [demo]);
      const { rows } = await migrator.query(
        `SELECT status, demo_status, min_liquidity_reserve_amount, is_demo FROM iam.workspace WHERE id = $1`,
        [demo],
      );
      expect(rows).toEqual([
        { status: 'PURGED', demo_status: 'PURGED', min_liquidity_reserve_amount: null, is_demo: true },
      ]);
    } finally {
      await migrator.query('ROLLBACK');
    }
    // El workspace real (origen) no cambió y su ledger sigue cuadrado.
    expect(await rowsByTable(migrator, real)).toEqual(realBefore);
    expect(await unbalancedEntries(migrator, real)).toEqual([]);
    // Purgar de nuevo: el demo ya no está en CLEANING ⇒ PF006, sin efectos.
    expect(await sqlState(() => workerPurge(demo))).toBe('PF006');
    // Un demo purgado libera el cupo: el usuario puede pedir otro (índice único parcial).
    const next = randomUUID();
    await createWorkspaceRow(app, { id: next, owner, name: 'Otro demo', demoOf: real });
    // …pero no dos vigentes a la vez.
    expect(
      await sqlState(() =>
        createWorkspaceRow(app, { id: randomUUID(), owner, name: 'Tercero', demoOf: real }),
      ),
    ).toBe('23505');
  });

  it('[TC-SECURITY-RLS-004] el catálogo de purga cubre toda tabla con workspace_id en orden de FKs y falla con una tabla nueva sin registrar', async () => {
    expect(await demoPurgeCatalogViolations(migrator)).toEqual([]);
    expect(await rlsCatalogViolations(migrator)).toEqual([]);
    // add-lifecycle-timeline: el recorrido (append-only, acotado por workspace) también se purga.
    expect(await purgeTables(migrator)).toContain('audit.lifecycle_transition');
    await migrator.query('BEGIN');
    try {
      await migrator.query('CREATE SCHEMA IF NOT EXISTS purgefixture');
      await migrator.query(
        'CREATE TABLE purgefixture.sin_registrar (id uuid PRIMARY KEY, workspace_id uuid NOT NULL)',
      );
      await migrator.query(
        `INSERT INTO platform.workspace_scoped_table VALUES ('purgefixture', 'fantasma', 5, 'DELETE')`,
      );
      // Una hija registrada DESPUÉS de su padre rompe el orden de purga.
      await migrator.query(`UPDATE platform.workspace_scoped_table SET purge_order = 75
                             WHERE schema_name = 'ledger' AND table_name = 'posting'`);
      expect(await demoPurgeCatalogViolations(migrator)).toEqual([
        'sin registrar: purgefixture.sin_registrar',
        'registrada y no existe: purgefixture.fantasma',
        'orden de purga: ledger.posting -> ledger.journal_entry',
        'orden de purga: ledger.posting -> ledger.ledger_account',
      ]);
    } finally {
      await migrator.query('ROLLBACK');
    }
    expect(await demoPurgeCatalogViolations(migrator)).toEqual([]);
    // pf_app y pf_worker no leen ni modifican el catálogo de purga.
    for (const c of [app, worker]) {
      expect(await sqlState(() => c.query('SELECT * FROM platform.workspace_scoped_table'))).toBe('42501');
    }
  });
});
