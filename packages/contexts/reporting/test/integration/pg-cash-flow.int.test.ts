import { randomUUID } from 'node:crypto';
import { PgUnitOfWork } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { ShortfallEpisode } from '../../src/application/ports/index.js';
import {
  PgShortfallEpisodeRepository,
  PgSpendableSettingsRepository,
} from '../../src/infrastructure/pg-cash-flow.js';
import { PgReportingUnitOfWork } from '../../src/infrastructure/pg-reporting.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `reporting.spendable_setting`, `reporting.spendable_essential_category` y `reporting.cash_flow_shortfall_episode`
// (openspec add-cash-flow-forecast, tarea 4.2) contra PostgreSQL real con RLS forzada.
describe('reporting: ajustes del disponible y episodios de riesgo (PG real)', () => {
  let app: Pool;
  let worker: Pool;
  let migrator: Pool;
  let user: string;
  const w1 = randomUUID();
  const w2 = randomUUID();
  const settings = new PgSpendableSettingsRepository();
  const episodes = new PgShortfallEpisodeRepository();
  const catA = randomUUID();
  const catB = randomUUID();

  beforeAll(async () => {
    app = new Pool({ connectionString: deps.databaseUrl, max: 2 });
    worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
    migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/cff', $1, $2, 'cff') AS id`,
      [`sub-${randomUUID()}`, `cff-${randomUUID()}@demo.pfos.test`],
    );
    user = rows[0]!.id;
    for (const ws of [w1, w2]) {
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
          [user, ws],
        );
        await client.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W', 'BOB', 'America/La_Paz', 'es-BO')`,
          [ws],
        );
        await client.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    await app?.end();
    await worker?.end();
    await migrator?.end();
  });

  const asApp = <T>(ws: string, fn: () => Promise<T>) =>
    new PgReportingUnitOfWork(app).run({ userId: user, workspaceId: ws }, fn);
  const asWorker = <T>(ws: string, fn: () => Promise<T>) =>
    new PgUnitOfWork(worker).run({ userId: null, workspaceId: ws }, fn);

  it('[TC-REPORTING-FORECAST-027] los ajustes se guardan con versión: la primera escritura da la 2 y una versión vencida no escribe', async () => {
    expect(await asApp(w1, () => settings.read(w1))).toBeNull();
    const first = await asApp(w1, () =>
      settings.write(
        w1,
        { horizonMode: 'NEXT_INCOME', subtractEssentials: true, essentialCategoryIds: [catB, catA] },
        1,
      ),
    );
    expect(first).toMatchObject({ horizonMode: 'NEXT_INCOME', subtractEssentials: true, version: 2 });
    const read = await asApp(w1, () => settings.read(w1));
    expect(read).toEqual({
      horizonMode: 'NEXT_INCOME',
      subtractEssentials: true,
      essentialCategoryIds: [catA, catB].sort(),
      version: 2,
    });
    // Escribir con la versión 1 otra vez (fila ya creada) y con una vencida no cambia nada.
    expect(
      await asApp(w1, () =>
        settings.write(
          w1,
          { horizonMode: 'FINANCIAL_PERIOD', subtractEssentials: false, essentialCategoryIds: [] },
          1,
        ),
      ),
    ).toBeNull();
    const second = await asApp(w1, () =>
      settings.write(
        w1,
        { horizonMode: 'FINANCIAL_PERIOD', subtractEssentials: false, essentialCategoryIds: [catA] },
        2,
      ),
    );
    expect(second).toMatchObject({ version: 3, essentialCategoryIds: [catA] });
    expect(
      await asApp(w1, () =>
        settings.write(
          w1,
          { horizonMode: 'NEXT_INCOME', subtractEssentials: true, essentialCategoryIds: [] },
          2,
        ),
      ),
    ).toBeNull();
    expect((await asApp(w1, () => settings.read(w1)))?.essentialCategoryIds).toEqual([catA]);
  });

  it('[TC-SECURITY-ISOLATION-001] los ajustes de un workspace son invisibles desde otro y el worker puede leerlos', async () => {
    expect(await asApp(w2, () => settings.read(w2))).toBeNull();
    expect(await asApp(w2, () => settings.read(w1))).toBeNull();
    expect((await asWorker(w1, () => settings.read(w1)))?.version).toBe(3);
    expect(await asWorker(w2, () => settings.read(w1))).toBeNull();
  });

  const episode = (ws: string, currency: string, over: Partial<ShortfallEpisode> = {}): ShortfallEpisode => ({
    id: randomUUID(),
    workspaceId: ws,
    currency,
    openedAt: '2026-10-20T12:25:00.000Z',
    closedAt: null,
    firstShortfallDate: '2026-11-01',
    lowestAmount: '-679.00',
    lowestDate: '2026-11-01',
    thresholdAmount: '1500.00',
    belowZero: true,
    lastEvaluatedAt: '2026-10-20T12:25:00.000Z',
    lastLowestAmount: '-679.00',
    ...over,
  });

  it('[TC-REPORTING-FORECAST-018] solo puede haber un episodio abierto por moneda y dos aperturas simultáneas publican una vez', async () => {
    const ws = w1;
    const results = await Promise.all([
      asWorker(ws, () => episodes.open(episode(ws, 'BOB'))),
      asWorker(ws, () => episodes.open(episode(ws, 'BOB'))),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await asWorker(ws, () => episodes.open(episode(ws, 'USD')))).toBe(true);
    const open = await asWorker(ws, () => episodes.listOpen(ws));
    expect(open.map((e) => e.currency)).toEqual(['BOB', 'USD']);
    expect(open[0]).toMatchObject({
      workspaceId: ws,
      lowestAmount: '-679.00',
      thresholdAmount: '1500.00',
      belowZero: true,
      firstShortfallDate: '2026-11-01',
      closedAt: null,
    });
  });

  it('[TC-REPORTING-FORECAST-019] el episodio se sostiene, se cierra una vez y permite abrir otro nuevo', async () => {
    const ws = w1;
    const [bob] = await asWorker(ws, () => episodes.listOpen(ws));
    await asWorker(ws, () =>
      episodes.touch(bob!.id, { evaluatedAt: '2026-10-20T13:25:00.000Z', lowestAmount: '-650.00' }),
    );
    const touched = (await asWorker(ws, () => episodes.listOpen(ws))).find((e) => e.id === bob!.id)!;
    expect(touched).toMatchObject({
      lastLowestAmount: '-650.00',
      lastEvaluatedAt: '2026-10-20T13:25:00.000Z',
    });
    expect(await asWorker(ws, () => episodes.close(bob!.id, '2026-10-21T12:25:00.000Z'))).toBe(true);
    expect(await asWorker(ws, () => episodes.close(bob!.id, '2026-10-21T12:26:00.000Z'))).toBe(false);
    expect((await asWorker(ws, () => episodes.listOpen(ws))).map((e) => e.currency)).toEqual(['USD']);
    expect(await asWorker(ws, () => episodes.open(episode(ws, 'BOB')))).toBe(true);
  });

  it('[TC-SECURITY-ISOLATION-001] los episodios de un workspace son invisibles desde otro y pf_app no puede escribirlos', async () => {
    expect(await asWorker(w2, () => episodes.listOpen(w2))).toEqual([]);
    // pf_app solo lee: la inserción se rechaza por permisos.
    await expect(asApp(w1, () => episodes.open(episode(w1, 'EUR')))).rejects.toMatchObject({ code: '42501' });
    // Una fila de otro workspace no pasa la política de pf_worker.
    await expect(asWorker(w2, () => episodes.open(episode(w1, 'EUR')))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('[TC-REPORTING-FORECAST-019] la purga borra los episodios cerrados antes del corte y deja los abiertos', async () => {
    const ws = w2;
    const old = episode(ws, 'BOB', { openedAt: '2024-01-01T00:00:00.000Z' });
    await asWorker(ws, () => episodes.open(old));
    await asWorker(ws, () => episodes.close(old.id, '2024-01-02T00:00:00.000Z'));
    expect(await asWorker(ws, () => episodes.open(episode(ws, 'BOB')))).toBe(true);
    const purged = await asWorker(ws, () => episodes.purgeClosedBefore('2025-01-01T00:00:00.000Z'));
    expect(purged).toBe(1);
    expect((await asWorker(ws, () => episodes.listOpen(ws))).map((e) => e.currency)).toEqual(['BOB']);
  });
});
