import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CardActivityService } from '../../src/application/card-activity.handler.js';
import { CardDailyService } from '../../src/application/card-daily.runner.js';
import type { CardDeps } from '../../src/application/card-ports.js';
import { CardsQueries } from '../../src/application/cards.queries.js';
import { CardsService, type RegisterCardCommand } from '../../src/application/cards.service.js';
import { CardWorld } from '../../src/application/testing/card-world.js';
import {
  PgCardRepository,
  PgInstallmentPlanRepository,
  PgReminderRepository,
  PgStatementRepository,
  PgUtilizationRepository,
} from '../../src/infrastructure/pg-cards.js';
import { PgDebtUnitOfWork, uuidV7Ids } from '../../src/infrastructure/pg-debt.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `debt.*` de tarjetas contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-credit-cards, tarea 4.1):
// aislamiento entre workspaces (TC-DEBT-CARD-028), una tarjeta ACTIVA por cuenta, una sola emisión por (cuenta, cierre)
// y un solo recordatorio por cierre con ejecuciones CONCURRENTES del job (TC-DEBT-CARD-013 y -019), un solo cruce de
// umbral con consumidores concurrentes (TC-DEBT-CARD-021), tablas append-only (`forbid_mutation`) y versiones de los
// términos del calendario (TC-DEBT-CARD-026). Los puertos de otros contextos (ledger, movimientos, definiciones
// recurrentes) son los dobles del `CardWorld`; los repositorios y la unidad de trabajo son los de PostgreSQL.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
const uow = () => new PgDebtUnitOfWork(app);
const cardsRepo = new PgCardRepository();

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow().run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function inCtx<T>(pool: Pool, ws: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      ws,
    ]);
    const result = await fn(c);
    await c.query('ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const count = (ws: string, sqlText: string, params: unknown[] = []) =>
  inCtx(app, ws, async (c) => Number((await c.query<{ n: string }>(sqlText, params)).rows[0]!.n));

const rule = (floor: string) => ({ type: 'PERCENT', percent: '5.00', floor });

/** Mundo con repositorios y unidad de trabajo reales de PostgreSQL y el resto de los puertos en memoria. */
function setup(ws: string, now: string) {
  const world = new CardWorld(now);
  const real: CardDeps = {
    ...world.deps,
    uow: uow(),
    cards: cardsRepo,
    statements: new PgStatementRepository(),
    plans: new PgInstallmentPlanRepository(),
    utilization: new PgUtilizationRepository(),
    reminders: new PgReminderRepository(),
    ids: uuidV7Ids,
  };
  const cardAccount = (name: string, currency = 'BOB') => {
    const id = randomUUID();
    world.addAccount(id, name, 'CREDIT_CARD', currency);
    return id;
  };
  const register = (accountId: string, over: Partial<RegisterCardCommand> = {}): RegisterCardCommand => ({
    workspaceId: ws,
    userId: user,
    name: `Visa ${randomUUID().slice(0, 8)}`,
    accounts: [{ accountId, creditLimit: { amount: '10000.00' }, minimumRule: rule('50.00') }],
    statementDay: 25,
    dueDay: 15,
    ...over,
  });
  return {
    world,
    deps: real,
    svc: new CardsService(real),
    queries: new CardsQueries(real),
    daily: new CardDailyService(real),
    activity: new CardActivityService(real),
    cardAccount,
    register,
    run: <T>(fn: () => Promise<T>) => asUser(fn),
  };
}

const issuedEvents = (world: CardWorld) =>
  world.outbox.filter((e) => e.eventType === 'debt.CardStatementIssued');

const journalEvent = (ws: string, accountId: string) => ({
  workspaceId: ws,
  eventType: 'ledger.JournalEntryPosted',
  eventId: randomUUID(),
  payload: { postings: [{ accountId }] },
});

/** Workspace propio por prueba (el job recorre todas las tarjetas del workspace). */
async function freshWorkspace(): Promise<string> {
  const ws = randomUUID();
  await new PgUnitOfWork(app).run({ userId: user, workspaceId: ws }, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Cards', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, user],
    );
  });
  return ws;
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 12 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/debt-cards', $1, $2, 'U1') AS id`,
    [`sub-cards-${randomUUID()}`, `cards-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setupUow = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setupUow.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Cards', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('aislamiento y unicidad de la cuenta', () => {
  it('[TC-DEBT-CARD-028] otro workspace no ve, lista ni modifica una tarjeta ajena (RLS)', async () => {
    const s = setup(w1, '2026-10-20T14:00:00.000Z');
    const account = s.cardAccount('Visa Oro BOB');
    const command = s.register(account);
    const { id } = await s.run(() => s.svc.register(command));
    expect((await inWs(w1, () => cardsRepo.findById(w1, id)))?.snapshot.name).toBe(command.name);
    expect(await inWs(w2, () => cardsRepo.findById(w2, id))).toBeNull();
    expect(await inWs(w2, () => cardsRepo.list(w2, {}))).toEqual([]);
    expect(await inWs(w2, () => cardsRepo.activeAccountIndex(w2))).toEqual(new Map());
    for (const table of ['credit_card', 'credit_card_account', 'credit_card_terms']) {
      expect(await count(w2, `SELECT count(*) AS n FROM debt.${table}`)).toBe(0);
    }
    const touched = await inCtx(
      app,
      w2,
      async (c) => (await c.query(`UPDATE debt.credit_card SET name = 'x' WHERE id = $1`, [id])).rowCount,
    );
    expect(touched).toBe(0);
    // Escribir con otro workspace de contexto viola la política (WITH CHECK).
    expect(
      await sqlState(() =>
        inCtx(app, w2, (c) =>
          c.query(
            `INSERT INTO debt.card_reminder (workspace_id, card_account_id, closing_date, due_date, emitted_at, event_id)
             VALUES ($1, $2, '2026-10-25', '2026-11-15', now(), $3)`,
            [w1, randomUUID(), randomUUID()],
          ),
        ),
      ),
    ).toBeDefined();
    expect((await inWs(w1, () => cardsRepo.findById(w1, id)))?.snapshot.name).toBe(command.name);
  });

  it('una cuenta pertenece a una sola tarjeta ACTIVA, también bajo registros concurrentes; archivada, la libera', async () => {
    const s = setup(w1, '2026-10-20T14:00:00.000Z');
    const account = s.cardAccount('Visa Plata BOB');
    const attempts = await Promise.allSettled(
      [1, 2, 3].map((n) => s.run(() => s.svc.register(s.register(account, { name: `Visa Plata ${n}` })))),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const codes = attempts
      .filter((a): a is PromiseRejectedResult => a.status === 'rejected')
      .map((a) => (a.reason as { code?: string }).code);
    // O lo atrapa la validación (IN_USE) o el índice único parcial (23505) en la carrera.
    expect(codes.every((c) => c === 'CREDIT_CARD_ACCOUNT_IN_USE' || c === '23505')).toBe(true);
    const active = await inWs(w1, () => cardsRepo.activeCardsOfAccounts(w1, [account]));
    expect(active).toHaveLength(1);
    const cardId = active[0]!.cardId;
    const version = (await inWs(w1, () => cardsRepo.findById(w1, cardId)))!.version;
    await s.run(() => s.svc.archive({ workspaceId: w1, userId: user, cardId, expectedVersion: version }));
    expect(await inWs(w1, () => cardsRepo.activeCardsOfAccounts(w1, [account]))).toEqual([]);
    // Archivada, la cuenta queda libre para otra tarjeta activa.
    const again = await s.run(() => s.svc.register(s.register(account, { name: 'Visa Plata Nueva' })));
    expect(await inWs(w1, () => cardsRepo.activeCardsOfAccounts(w1, [account]))).toEqual([
      { accountId: account, cardId: again.id },
    ]);
    // La fila archivada conserva su cuenta (el índice único solo cubre las activas).
    expect(
      await count(w1, `SELECT count(*) AS n FROM debt.credit_card_account WHERE account_id = $1`, [account]),
    ).toBe(2);
  });
});

describe('emisión y recordatorio únicos bajo ejecuciones concurrentes', () => {
  it('[TC-DEBT-CARD-013] [TC-DEBT-CARD-019] cuatro corridas simultáneas emiten una vez y recuerdan una vez; los días siguientes no repiten', async () => {
    const ws = await freshWorkspace();
    const s = setup(ws, '2026-10-20T16:00:00.000Z');
    const account = s.cardAccount('Visa Oro BOB');
    s.world.addEntry({ accountId: account, date: '2026-09-01', cls: 'OTHER', amount: '1000.00' });
    s.world.addEntry({ accountId: account, date: '2026-10-12', cls: 'PURCHASE', amount: '120.50' });
    const { id } = await s.run(() => s.svc.register(s.register(account)));
    const cardAccountId = (await inWs(ws, () => cardsRepo.findById(ws, id)))!.snapshot.accounts[0]!.id;

    s.world.setNow('2026-10-26T16:00:00.000Z');
    const runs = await Promise.all([1, 2, 3, 4].map(() => s.run(() => s.daily.runWorkspace(ws))));
    expect(runs.flatMap((r) => r.failed)).toEqual([]);
    expect(runs.reduce((acc, r) => acc + r.issued, 0)).toBe(1);
    expect(
      await count(ws, `SELECT count(*) AS n FROM debt.card_statement WHERE card_account_id = $1`, [
        cardAccountId,
      ]),
    ).toBe(1);
    expect(issuedEvents(s.world)).toHaveLength(1);
    const stored = (
      await inWs(ws, () => new PgStatementRepository().listForAccounts(ws, [cardAccountId]))
    ).find((r) => r.closingDate === '2026-10-25')!;
    expect(stored).toMatchObject({ billedBalance: '1120.50', dueDate: '2026-11-15', minimumDue: '56.02' });
    // Una compra posterior no reescribe lo emitido y la emisión no se repite.
    s.world.addEntry({ accountId: account, date: '2026-10-24', cls: 'PURCHASE', amount: '45.00' });
    await Promise.all([1, 2].map(() => s.run(() => s.daily.runWorkspace(ws))));
    expect(issuedEvents(s.world)).toHaveLength(1);
    expect((await inWs(ws, () => new PgStatementRepository().find(ws, stored.id)))?.billedBalance).toBe(
      '1120.50',
    );

    // Recordatorio: ventana de 3 días antes del 2026-11-15.
    s.world.setNow('2026-11-12T16:00:00.000Z');
    const reminders = await Promise.all([1, 2, 3, 4].map(() => s.run(() => s.daily.runWorkspace(ws))));
    expect(reminders.reduce((acc, r) => acc + r.reminders, 0)).toBe(1);
    s.world.setNow('2026-11-13T16:00:00.000Z');
    await Promise.all([1, 2].map(() => s.run(() => s.daily.runWorkspace(ws))));
    expect(s.world.outbox.filter((e) => e.eventType === 'debt.CardPaymentDue')).toHaveLength(1);
    expect(
      await count(ws, `SELECT count(*) AS n FROM debt.card_reminder WHERE card_account_id = $1`, [
        cardAccountId,
      ]),
    ).toBe(1);
  }, 60_000);
});

describe('umbrales de utilización bajo consumidores concurrentes', () => {
  it('[TC-DEBT-CARD-021] una compra de 650.00 USD publica UN hecho de 80.00 % con 30.00 % cruzado; sube y baja con un solo hecho por cruce', async () => {
    const ws = await freshWorkspace();
    const s = setup(ws, '2026-10-20T16:00:00.000Z');
    const account = s.cardAccount('Visa Oro USD', 'USD');
    s.world.addEntry({ accountId: account, date: '2026-10-01', cls: 'PURCHASE', amount: '200.00' });
    const { id } = await s.run(() =>
      s.svc.register({
        ...s.register(account),
        accounts: [{ accountId: account, creditLimit: { amount: '1000.00' }, minimumRule: rule('10.00') }],
      }),
    );
    const crossings = () =>
      count(ws, `SELECT count(*) AS n FROM debt.card_utilization_crossing WHERE card_id = $1`, [id]);
    const events = () =>
      s.world.outbox.filter((e) => e.eventType === 'debt.CreditUtilizationThresholdReached');
    expect(events()).toHaveLength(0);

    // 20.00 % → 85.00 %: seis consumidores concurrentes ven el mismo cambio.
    s.world.addEntry({ accountId: account, date: '2026-10-20', cls: 'PURCHASE', amount: '650.00' });
    await Promise.all(
      Array.from({ length: 6 }, () => s.run(() => s.activity.onEvent(journalEvent(ws, account)))),
    );
    expect(events()).toHaveLength(1);
    expect(events()[0]?.payload).toMatchObject({ threshold: '80.00', alsoCrossed: ['30.00'] });
    expect(await crossings()).toBe(2);
    const states = await inWs(ws, () => new PgUtilizationRepository().states(id));
    expect(states.map((x) => [x.threshold, x.armed, x.crossingNo]).sort()).toEqual([
      ['30.00', false, 1],
      ['80.00', false, 1],
    ]);

    // Sigue arriba: no repite. Baja a 10 % (rearma sin hecho) y vuelve a subir: un hecho más.
    await Promise.all([1, 2, 3].map(() => s.run(() => s.activity.onEvent(journalEvent(ws, account)))));
    expect(events()).toHaveLength(1);
    s.world.setNow('2026-10-21T16:00:00.000Z');
    s.world.addEntry({ accountId: account, date: '2026-10-21', cls: 'PAYMENT', amount: '-750.00' });
    await Promise.all([1, 2].map(() => s.run(() => s.activity.onEvent(journalEvent(ws, account)))));
    expect(events()).toHaveLength(1);
    s.world.setNow('2026-10-22T16:00:00.000Z');
    s.world.addEntry({ accountId: account, date: '2026-10-22', cls: 'PURCHASE', amount: '750.00' });
    await Promise.all([1, 2, 3, 4].map(() => s.run(() => s.activity.onEvent(journalEvent(ws, account)))));
    expect(events()).toHaveLength(2);
    expect(events()[1]?.payload).toMatchObject({ threshold: '80.00' });
    expect(await crossings()).toBe(4);
    expect(
      await count(
        ws,
        `SELECT count(*) AS n FROM debt.card_utilization_crossing WHERE card_id = $1 AND crossing_no = 2`,
        [id],
      ),
    ).toBe(2);
    // Cada hecho sube la versión del agregado (el outbox exige una versión por hecho).
    const versions = s.world.outbox.map((e) => e.aggregateVersion);
    expect(new Set(versions).size).toBe(versions.length);
  }, 60_000);
});

describe('tablas append-only y versiones de los términos', () => {
  it('credit_card_terms, card_utilization_crossing y card_reminder no admiten UPDATE, DELETE ni TRUNCATE', async () => {
    const ws = await freshWorkspace();
    const s = setup(ws, '2026-10-20T16:00:00.000Z');
    const account = s.cardAccount('Visa Oro BOB');
    s.world.addEntry({ accountId: account, date: '2026-09-01', cls: 'OTHER', amount: '1000.00' });
    s.world.addEntry({ accountId: account, date: '2026-10-12', cls: 'PURCHASE', amount: '100.00' });
    await s.run(() => s.svc.register(s.register(account)));
    s.world.setNow('2026-10-26T16:00:00.000Z');
    await s.run(() => s.daily.runWorkspace(ws));
    s.world.setNow('2026-11-12T16:00:00.000Z');
    await s.run(() => s.daily.runWorkspace(ws));
    for (const [table, update] of [
      ['credit_card_terms', `UPDATE debt.credit_card_terms SET statement_day = 1`],
      ['card_utilization_crossing', `UPDATE debt.card_utilization_crossing SET utilization = 0`],
      ['card_reminder', `UPDATE debt.card_reminder SET due_date = due_date`],
    ] as const) {
      expect(
        await count(ws, `SELECT count(*) AS n FROM debt.${table}`),
        `la tabla ${table} del escenario no tiene filas`,
      ).toBeGreaterThanOrEqual(table === 'card_utilization_crossing' ? 0 : 1);
      // pf_app no tiene UPDATE/DELETE (42501); el dueño de la tabla topa con el trigger (PF003) y TRUNCATE es de
      // sentencia: no depende de las políticas RLS.
      for (const sql of [update, `DELETE FROM debt.${table}`]) {
        expect(await sqlState(() => inCtx(app, ws, (c) => c.query(sql)))).toBe('42501');
      }
      expect(await sqlState(() => inCtx(migrator, ws, (c) => c.query(`TRUNCATE debt.${table}`)))).toBe(
        'PF003',
      );
    }
  });

  it('[TC-DEBT-CARD-026] cambiar el día de cierre agrega una versión de términos, no toca los estados emitidos y mueve el ciclo abierto', async () => {
    const ws = await freshWorkspace();
    const s = setup(ws, '2026-10-20T16:00:00.000Z');
    const account = s.cardAccount('Visa Oro BOB');
    s.world.addEntry({ accountId: account, date: '2026-09-01', cls: 'OTHER', amount: '1000.00' });
    s.world.addEntry({ accountId: account, date: '2026-10-12', cls: 'PURCHASE', amount: '120.50' });
    const { id } = await s.run(() => s.svc.register(s.register(account)));
    s.world.setNow('2026-10-26T16:00:00.000Z');
    await s.run(() => s.daily.runWorkspace(ws));
    const cardAccountId = (await inWs(ws, () => cardsRepo.findById(ws, id)))!.snapshot.accounts[0]!.id;
    const emitted = (
      await inWs(ws, () => new PgStatementRepository().listForAccounts(ws, [cardAccountId]))
    ).find((r) => r.closingDate === '2026-10-25')!;

    // Emitido el 2026-10-25 y hoy 2026-10-27: el día 20 aplica desde el ciclo que cierra el 2026-11-20.
    s.world.setNow('2026-10-27T16:00:00.000Z');
    const current = (await inWs(ws, () => cardsRepo.findById(ws, id)))!;
    const view = await s.run(() =>
      s.svc.update({
        workspaceId: ws,
        userId: user,
        cardId: id,
        expectedVersion: current.version,
        edit: { statementDay: 20 },
      }),
    );
    expect(view.statementDay).toBe(20);
    expect(view.accounts[0]?.openCycle.closingDate).toBe('2026-11-20');
    const versions = await inCtx(
      app,
      ws,
      async (c) =>
        (
          await c.query<{ seq: number; statement_day: number; effective_from: string }>(
            `SELECT seq, statement_day, effective_from::text FROM debt.credit_card_terms WHERE card_id = $1 ORDER BY seq`,
            [id],
          )
        ).rows,
    );
    expect(versions.map((v) => v.statement_day)).toEqual([25, 20]);
    // Rige desde max(día siguiente al último cierre emitido, hoy).
    expect(versions[1]!.effective_from).toBe('2026-10-27');
    // El estado emitido conserva sus fechas y cifras.
    const after = await inWs(ws, () => new PgStatementRepository().find(ws, emitted.id));
    expect(after).toMatchObject({
      closingDate: '2026-10-25',
      dueDate: emitted.dueDate,
      billedBalance: emitted.billedBalance,
    });
    // Recargada desde PostgreSQL la tarjeta reconstruye el calendario con ambas versiones.
    const reloaded = (await inWs(ws, () => cardsRepo.findById(ws, id)))!;
    expect(reloaded.snapshot.terms.map((t) => t.statementDay)).toEqual([25, 20]);
  });
});

describe('purga demo', () => {
  it('las nueve tablas de tarjetas están registradas con hijas antes que padres', async () => {
    const { rows } = await migrator.query<{ table_name: string; purge_order: number }>(
      `SELECT table_name, purge_order FROM platform.workspace_scoped_table WHERE schema_name = 'debt' AND table_name LIKE ANY (ARRAY['card\\_%', 'credit\\_card%'])`,
    );
    const order = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.purge_order)]));
    expect(Object.keys(order).sort()).toEqual([
      'card_installment',
      'card_installment_plan',
      'card_reminder',
      'card_statement',
      'card_utilization_crossing',
      'card_utilization_state',
      'credit_card',
      'credit_card_account',
      'credit_card_terms',
    ]);
    const before = (child: string, parent: string) => expect(order[child]).toBeLessThan(order[parent]!);
    before('card_installment', 'card_installment_plan');
    before('card_installment_plan', 'credit_card_account');
    before('card_statement', 'credit_card_account');
    before('card_reminder', 'credit_card_account');
    before('credit_card_account', 'credit_card');
    before('credit_card_terms', 'credit_card');
    before('card_utilization_state', 'credit_card');
    before('card_utilization_crossing', 'credit_card');
  });
});
