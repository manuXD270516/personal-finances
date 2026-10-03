import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSchemaRegistry,
  EventSubscriptions,
  PgOutboxWriter,
  buildEnvelope,
} from '@pf/platform/events';
import { createLogger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { runWithCorrelation, uuidv7 } from '@pf/platform/logging';
import { FixedClock, Instant, systemClock } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { AuditEntry, AuditPort } from '../../src/contracts/index.js';
import {
  createAuditRuntime,
  ensureAuditPartitions,
  type AuditRuntime,
} from '../../src/interface/audit.module.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const HMAC_KEY = `test:${'k'.repeat(40)}`;
const C1 = '0190a000-0000-7000-8000-0000000000c1';
const POLICIES = [
  {
    Transaction: { amount: 'money', description: 'plain' },
    Account: { name: 'plain', accountNumberLast4: 'last4', openingBalance: 'money' },
  },
] as const;

let app: Pool;
let worker: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let runtime: AuditRuntime;
let outbox: PgOutboxWriter;
let clock: FixedClock;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const bankA = randomUUID();
const usdSavings = randomUUID();

/** SQLSTATE del error (42501 sin privilegio/RLS, PF002 sin contexto, PF003 mutación prohibida, 23514 check). */
async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

/** Consulta en una transacción con contexto RLS LOCAL (rollback salvo `commit`). */
async function inCtx<T>(
  pool: Pool,
  ctx: { userId?: string; workspaceId?: string },
  fn: (c: PoolClient) => Promise<T>,
  commit = false,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      ctx.userId ?? '',
      ctx.workspaceId ?? '',
    ]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

/** Ejecuta como si fuera una petición de la UI de U1 con correlación C1 (contexto ambiental de la plataforma). */
const asUi = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithCorrelation({ correlationId: C1, requestId: C1 }, () =>
    runWithRequestContext(
      {
        actor: { type: 'USER', userId: u1 },
        origin: 'ui',
        userAgent: 'Mozilla/5.0 (PFOS integration)',
        clientIp: '203.0.113.7',
      },
      fn,
    ),
  );

/**
 * `FakeMutatingCommand` (design §Dependencias): registra un gasto sobre tablas de fixture con el mismo flujo de unidad
 * de trabajo que tendrá RecordExpense: valida, persiste gasto + efecto en el saldo, publica en el outbox y audita al
 * final. Hasta que exista add-transaction-recording, sustituye al comando real en TC-AUDIT-ATOMIC-001.
 */
async function recordExpense(
  port: AuditPort,
  accountId: string,
  amount: string,
  currencyCode: string,
): Promise<string> {
  return asUi(() =>
    uow.run({ userId: u1, workspaceId: w1 }, async () => {
      const tx = requireSqlExecutor();
      const { rows } = await tx.query('SELECT currency FROM audit_fixture.account WHERE id = $1 FOR UPDATE', [
        accountId,
      ]);
      const account = (rows as { currency: string }[])[0];
      if (!account) throw new Error('RESOURCE_NOT_FOUND');
      if (account.currency !== currencyCode) throw new Error('CURRENCY_MISMATCH');
      const id = uuidv7();
      await tx.query(
        'INSERT INTO audit_fixture.expense (id, workspace_id, account_id, amount) VALUES ($1, $2, $3, $4)',
        [id, w1, accountId, amount],
      );
      await tx.query('UPDATE audit_fixture.account SET balance = balance - $2::numeric WHERE id = $1', [
        accountId,
        amount,
      ]);
      await outbox.append({
        eventId: uuidv7(),
        eventType: 'identity.WorkspaceSettingsChanged',
        eventVersion: 1,
        workspaceId: w1,
        aggregateType: 'Workspace',
        aggregateId: id,
        aggregateVersion: 1,
        occurredAt: clock.now().toString(),
        actor: { type: 'USER', id: u1 },
        payload: { workspaceId: w1, changes: [{ field: 'name', before: 'a', after: 'b' }] },
      });
      await port.append({
        workspaceId: w1,
        action: 'transactions.transaction.recorded',
        aggregateType: 'Transaction',
        aggregateId: id,
        aggregateVersion: 1,
        changes: [{ field: 'amount', before: null, after: { amount, currency: currencyCode } }],
      });
      return id;
    }),
  );
}

const auditRows = (ws: string, where = 'true', values: unknown[] = []) =>
  inCtx(
    app,
    { workspaceId: ws },
    async (c) => (await c.query(`SELECT * FROM audit.audit_log WHERE ${where}`, values)).rows,
  );

const balanceOf = (id: string) =>
  inCtx(app, { workspaceId: w1 }, async (c) =>
    String(
      (await c.query('SELECT balance::text AS b FROM audit_fixture.account WHERE id = $1', [id])).rows[0]?.b,
    ),
  );

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
  runtime = createAuditRuntime({
    pool: app,
    clock,
    ipHmacKeys: HMAC_KEY,
    policies: POLICIES,
    timeZones: { timeZoneOf: async () => 'America/La_Paz' },
  });
  outbox = new PgOutboxWriter(
    EventSchemaRegistry.fromDirectory(
      fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url)),
    ),
  );
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/audit', $1, $2, 'U1') AS id`,
    [`sub-audit-${randomUUID()}`, `audit-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  // Tablas de fixture del comando de prueba (RLS forzada como cualquier tabla de negocio); se borran al final.
  await migrator.query(`
    CREATE SCHEMA audit_fixture;
    GRANT USAGE ON SCHEMA audit_fixture TO pf_app;
    CREATE TABLE audit_fixture.account (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL,
      currency text NOT NULL, balance numeric(20,2) NOT NULL);
    CREATE TABLE audit_fixture.expense (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
      amount numeric(20,2) NOT NULL);
    ALTER TABLE audit_fixture.account ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_fixture.account FORCE ROW LEVEL SECURITY;
    ALTER TABLE audit_fixture.expense ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_fixture.expense FORCE ROW LEVEL SECURITY;
    CREATE POLICY ws ON audit_fixture.account TO pf_app USING (workspace_id = platform.current_workspace_id())
      WITH CHECK (workspace_id = platform.current_workspace_id());
    CREATE POLICY ws ON audit_fixture.expense TO pf_app USING (workspace_id = platform.current_workspace_id())
      WITH CHECK (workspace_id = platform.current_workspace_id());
    GRANT SELECT, INSERT, UPDATE ON audit_fixture.account, audit_fixture.expense TO pf_app;
  `);
  await inCtx(
    app,
    { workspaceId: w1 },
    async (c) => {
      await c.query(`INSERT INTO audit_fixture.account VALUES ($1, $2, 'Bank A', 'BOB', 1000.00)`, [
        bankA,
        w1,
      ]);
      await c.query(`INSERT INTO audit_fixture.account VALUES ($1, $2, 'USD Savings', 'USD', 500.00)`, [
        usdSavings,
        w1,
      ]);
    },
    true,
  );
});

afterAll(async () => {
  await migrator?.query('DROP SCHEMA IF EXISTS audit_fixture CASCADE');
  await Promise.all([app?.end(), worker?.end(), migrator?.end()]);
});

describe('[TC-AUDIT-ATOMIC-001] auditoría, gasto, saldo y outbox se confirman o se revierten juntos', () => {
  it('normal: gasto, saldo 925.00, exactamente un registro de auditoría y su evento en el outbox', async () => {
    const id = await recordExpense(runtime.port, bankA, '75.00', 'BOB');
    expect(await balanceOf(bankA)).toBe('925.00');
    const rows = await auditRows(w1, 'aggregate_id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'transactions.transaction.recorded', origin: 'ui' });
    const events = await inCtx(
      worker,
      {},
      async (c) => (await c.query('SELECT 1 FROM platform.outbox WHERE aggregate_id = $1', [id])).rows,
    );
    expect(events).toHaveLength(1);
  });

  it('falla de la auditoría (INSERT rechazado por la BD): nada del gasto persiste y el saldo sigue en 925.00', async () => {
    const before = await auditRows(w1);
    // El adapter real intenta escribir en otro workspace: la BD lo rechaza (RLS WITH CHECK) y la transacción aborta.
    const failing: AuditPort = { append: (e: AuditEntry) => runtime.port.append({ ...e, workspaceId: w2 }) };
    await expect(recordExpense(failing, bankA, '75.00', 'BOB')).rejects.toMatchObject({ code: '42501' });
    expect(await balanceOf(bankA)).toBe('925.00');
    expect(await auditRows(w1)).toHaveLength(before.length);
    const expenses = await inCtx(
      app,
      { workspaceId: w1 },
      async (c) => (await c.query('SELECT count(*)::int AS n FROM audit_fixture.expense')).rows[0]?.n,
    );
    expect(expenses).toBe(1);
    const events = await inCtx(
      worker,
      {},
      async (c) =>
        (await c.query(`SELECT count(*)::int AS n FROM platform.outbox WHERE workspace_id = $1`, [w1]))
          .rows[0]?.n,
    );
    expect(events).toBe(1);
  });

  it('comando rechazado (gasto en BOB sobre USD Savings): sin registro de auditoría', async () => {
    const before = (await auditRows(w1)).length;
    await expect(recordExpense(runtime.port, usdSavings, '50.00', 'BOB')).rejects.toThrow(
      'CURRENCY_MISMATCH',
    );
    expect(await auditRows(w1)).toHaveLength(before);
    expect(await balanceOf(usdSavings)).toBe('500.00');
  });

  it('fuera de una unidad de trabajo AuditPort.append falla con AUDIT_OUTSIDE_UNIT_OF_WORK', async () => {
    await expect(
      asUi(() =>
        runtime.port.append({
          workspaceId: w1,
          action: 'transactions.transaction.recorded',
          aggregateType: 'Transaction',
          aggregateId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUDIT_OUTSIDE_UNIT_OF_WORK' });
  });
});

describe('contenido, actor y redacción persistidos', () => {
  const t1 = randomUUID();

  it('[TC-AUDIT-CONTENT-001] la fila guarda actor, montos como string decimal + moneda, instante, correlación C1 y origen ui', async () => {
    await asUi(() =>
      uow.run({ userId: u1, workspaceId: w1 }, () =>
        runtime.port.append({
          workspaceId: w1,
          action: 'transactions.transaction.amended',
          aggregateType: 'Transaction',
          aggregateId: t1,
          aggregateVersion: 2,
          changes: [
            {
              field: 'amount',
              before: { amount: '120.00', currency: 'BOB' },
              after: { amount: '102.00', currency: 'BOB' },
            },
          ],
        }),
      ),
    );
    const [row] = await auditRows(w1, 'aggregate_id = $1', [t1]);
    expect(row).toMatchObject({
      workspace_id: w1,
      actor_type: 'USER',
      actor_user_id: u1,
      actor_process: null,
      action: 'transactions.transaction.amended',
      aggregate_type: 'Transaction',
      aggregate_version: 2,
      correlation_id: C1,
      request_id: C1,
      origin: 'ui',
      user_agent: 'Mozilla/5.0 (PFOS integration)',
      changes: [
        {
          field: 'amount',
          before: { amount: '120.00', currency: 'BOB' },
          after: { amount: '102.00', currency: 'BOB' },
        },
      ],
    });
    expect((row?.['occurred_at'] as Date).toISOString()).toBe('2026-03-15T14:00:00.000Z');
    const types = await inCtx(
      app,
      { workspaceId: w1 },
      async (c) =>
        (
          await c.query(
            `SELECT jsonb_typeof(changes->0->'after'->'amount') AS t FROM audit.audit_log WHERE aggregate_id = $1`,
            [t1],
          )
        ).rows[0]?.t,
    );
    expect(types).toBe('string');
  });

  it('[TC-AUDIT-ACTOR-001] proceso interno: actor SYSTEM sin usuario con la correlación de la solicitud; la BD rechaza actores ambiguos', async () => {
    const ledgerAccount = randomUUID();
    await runWithCorrelation({ correlationId: '0190a000-0000-7000-8000-0000000000c7' }, () =>
      runWithRequestContext(
        { actor: { type: 'SYSTEM', process: 'ledger.system-accounts' }, origin: 'system' },
        () =>
          uow.run({ userId: u1, workspaceId: w1 }, () =>
            runtime.port.append({
              workspaceId: w1,
              action: 'ledger.ledger_account.created',
              aggregateType: 'LedgerAccount',
              aggregateId: ledgerAccount,
              aggregateVersion: 1,
            }),
          ),
      ),
    );
    const [row] = await auditRows(w1, 'aggregate_id = $1', [ledgerAccount]);
    expect(row).toMatchObject({
      actor_type: 'SYSTEM',
      actor_user_id: null,
      actor_process: 'ledger.system-accounts',
      correlation_id: '0190a000-0000-7000-8000-0000000000c7',
      origin: 'system',
    });
    const insert = (actorType: string, userId: string | null, process: string | null) =>
      sqlState(() =>
        inCtx(app, { workspaceId: w1 }, (c) =>
          c.query(
            `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, actor_process, action,
               aggregate_type, aggregate_id, origin, correlation_id)
             VALUES ($1, now(), $2, $3, $4, $5, 'ledger.ledger_account.created', 'LedgerAccount', $1, 'system', $1)`,
            [randomUUID(), w1, actorType, userId, process],
          ),
        ),
      );
    expect(await insert('USER', null, null)).toBe('23514');
    expect(await insert('SYSTEM', null, null)).toBe('23514');
    expect(await insert('WORKER', u1, 'x')).toBe('23514');
  });

  it('[TC-AUDIT-REDACTION-001] canario: sin tokens, cookie, identificador completo ni IP en claro; IP como HMAC; monto USDT exacto', async () => {
    const account = randomUUID();
    await runWithCorrelation({ correlationId: C1 }, () =>
      runWithRequestContext(
        {
          actor: { type: 'USER', userId: u1 },
          origin: 'ui',
          userAgent: 'Mozilla/5.0',
          clientIp: '198.51.100.23',
        },
        () =>
          uow.run({ userId: u1, workspaceId: w1 }, async () => {
            await runtime.port.append({
              workspaceId: w1,
              action: 'accounts.account.updated',
              aggregateType: 'Account',
              aggregateId: account,
              aggregateVersion: 2,
              changes: [
                { field: 'accountNumberLast4', before: null, after: 'DEMO-000123456789' },
                { field: 'authorization', before: null, after: 'Bearer CANARY-TOKEN-123' },
                { field: 'cookie', before: null, after: '__Host-pfos_sid=CANARY-TOKEN-123' },
              ],
            });
            await runtime.port.append({
              workspaceId: w1,
              action: 'accounts.account.opened',
              aggregateType: 'Account',
              aggregateId: randomUUID(),
              aggregateVersion: 1,
              changes: [
                { field: 'name', before: null, after: 'USDT Wallet' },
                { field: 'openingBalance', before: null, after: { amount: '100.000000', currency: 'USDT' } },
              ],
            });
          }),
      ),
    );
    const dump = await inCtx(
      app,
      { workspaceId: w1 },
      async (c) =>
        (await c.query(`SELECT string_agg(to_jsonb(a)::text, '\n') AS t FROM audit.audit_log a`)).rows[0]
          ?.t as string,
    );
    for (const secret of [
      'CANARY-TOKEN-123',
      'DEMO-000123456789',
      '198.51.100.23',
      '203.0.113.7',
      'pfos_sid',
    ]) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).toContain('"after": "6789"');
    expect(dump).toContain('"amount": "100.000000", "currency": "USDT"');
    const [row] = await auditRows(w1, 'aggregate_id = $1', [account]);
    const expected = createHmac('sha256', 'k'.repeat(40)).update('198.51.100.23').digest();
    expect(Buffer.compare(row?.['client_ip_hash'] as Buffer, expected)).toBe(0);
    expect((row?.['changes'] as { field: string }[]).map((c) => c.field)).toEqual(['accountNumberLast4']);
  });
});

describe('[TC-AUDIT-ACTOR-001] los consumidores del worker auditan como su proceso con la correlación del evento', () => {
  it('actor WORKER = nombre del consumidor, origen system y correlationId del evento que lo originó (rol pf_worker)', async () => {
    const C7 = '0190a000-0000-7000-8000-0000000000c7';
    const target = randomUUID();
    const consumer = {
      consumer: 'ledger.system-accounts',
      events: [{ type: 'identity.WorkspaceSettingsChanged', version: 1 }],
      handler: async () => {
        await runtime.port.append({
          workspaceId: w1,
          action: 'ledger.ledger_account.created',
          aggregateType: 'LedgerAccount',
          aggregateId: target,
          aggregateVersion: 1,
        });
      },
    };
    const consumers = new EventConsumerRuntime({
      pool: worker,
      queue: {} as JobQueue,
      subscriptions: new EventSubscriptions([consumer]),
      logger: createLogger({ service: 'finance-worker', role: 'worker', environment: 'ci', level: 'warn' }),
    });
    const event = buildEnvelope({
      eventId: uuidv7(),
      eventType: 'identity.WorkspaceSettingsChanged',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      workspaceId: w1,
      aggregateType: 'Workspace',
      aggregateId: w1,
      aggregateVersion: 2,
      correlationId: C7,
      payload: { workspaceId: w1, changes: [{ field: 'name', before: 'a', after: 'b' }] },
    });
    expect(await consumers.deliver(consumer, event)).toBe('applied');
    const [row] = await auditRows(w1, 'aggregate_id = $1', [target]);
    expect(row).toMatchObject({
      actor_type: 'WORKER',
      actor_user_id: null,
      actor_process: 'ledger.system-accounts',
      origin: 'system',
      correlation_id: C7,
    });
  });
});

describe('[TC-AUDIT-IMMUTABLE-001] la auditoría es append-only para todos los roles', () => {
  const t1 = randomUUID();
  let original: Record<string, unknown>;

  beforeAll(async () => {
    const amend = (from: string, to: string) =>
      asUi(() =>
        uow.run({ userId: u1, workspaceId: w1 }, () =>
          runtime.port.append({
            workspaceId: w1,
            action: 'transactions.transaction.amended',
            aggregateType: 'Transaction',
            aggregateId: t1,
            changes: [
              {
                field: 'amount',
                before: { amount: from, currency: 'BOB' },
                after: { amount: to, currency: 'BOB' },
              },
            ],
          }),
        ),
      );
    await amend('120.00', '102.00');
    [original] = (await auditRows(w1, 'aggregate_id = $1', [t1])) as [Record<string, unknown>];
    clock.advance(60_000);
    await amend('102.00', '120.00');
  });

  it('UPDATE, DELETE y TRUNCATE como pf_app y UPDATE como pf_worker fallan por privilegios', async () => {
    const id = original['id'] as string;
    const asApp = (q: string) =>
      sqlState(() => inCtx(app, { workspaceId: w1 }, (c) => c.query(q, q.includes('$1') ? [id] : [])));
    expect(await asApp(`UPDATE audit.audit_log SET reason = 'x' WHERE id = $1`)).toBe('42501');
    expect(await asApp('DELETE FROM audit.audit_log WHERE id = $1')).toBe('42501');
    expect(await asApp('TRUNCATE audit.audit_log')).toBe('42501');
    expect(await asApp('DELETE FROM audit.audit_log_default')).toBe('42501');
    expect(
      await sqlState(() =>
        inCtx(worker, { workspaceId: w1 }, (c) =>
          c.query(`UPDATE audit.audit_log SET reason = 'x' WHERE id = $1`, [id]),
        ),
      ),
    ).toBe('42501');
  });

  it('ni siquiera el owner puede alterarla: RLS forzada lo deja sin filas y el trigger forbid_mutation responde PF003', async () => {
    const id = original['id'] as string;
    // RLS FORZADA: el owner tampoco ve filas (sin política para él) ⇒ UPDATE/DELETE no tocan nada.
    expect(
      (await migrator.query(`UPDATE audit.audit_log SET reason = 'x' WHERE id = $1`, [id])).rowCount,
    ).toBe(0);
    expect((await migrator.query('DELETE FROM audit.audit_log WHERE id = $1', [id])).rowCount).toBe(0);
    // TRUNCATE no pasa por RLS: lo frena el trigger de sentencia (padre y particiones).
    expect(await sqlState(() => migrator.query('TRUNCATE audit.audit_log'))).toBe('PF003');
    expect(await sqlState(() => migrator.query('TRUNCATE audit.audit_log_default'))).toBe('PF003');
    // Aun quitando la RLS forzada (dentro de una transacción que se revierte), el trigger de fila lo impide.
    const c = await migrator.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE audit.audit_log NO FORCE ROW LEVEL SECURITY');
      await c.query('SAVEPOINT s');
      expect(
        await sqlState(() => c.query(`UPDATE audit.audit_log SET reason = 'x' WHERE id = $1`, [id])),
      ).toBe('PF003');
      await c.query('ROLLBACK TO SAVEPOINT s');
      expect(await sqlState(() => c.query('DELETE FROM audit.audit_log WHERE id = $1', [id]))).toBe('PF003');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('el registro original no cambió y la corrección es un segundo registro en orden cronológico', async () => {
    const history = await runtime.queries.list({
      userId: u1,
      workspaceId: w1,
      aggregateType: 'Transaction',
      aggregateId: t1,
      limit: 10,
    });
    expect(history.map((r) => r.changes[0]?.after)).toEqual([
      { amount: '102.00', currency: 'BOB' },
      { amount: '120.00', currency: 'BOB' },
    ]);
    const [again] = await auditRows(w1, 'id = $1', [original['id']]);
    expect(again).toEqual(original);
  });
});

describe('[TC-AUDIT-ISOLATION-001] la auditoría está aislada por workspace (RLS fail-closed)', () => {
  it('desde W2 no se ve ninguna fila de W1; sin contexto la consulta falla con PF002; escribir en W1 desde W2 falla', async () => {
    expect((await auditRows(w1)).length).toBeGreaterThan(0);
    expect(await auditRows(w2)).toEqual([]);
    expect(await sqlState(() => inCtx(app, {}, (c) => c.query('SELECT * FROM audit.audit_log')))).toBe(
      'PF002',
    );
    expect(await sqlState(() => app.query('SELECT count(*) FROM audit.audit_log'))).toBe('PF002');
    expect(
      await sqlState(() =>
        asUi(() =>
          uow.run({ userId: u1, workspaceId: w2 }, () =>
            runtime.port.append({
              workspaceId: w1,
              action: 'accounts.account.renamed',
              aggregateType: 'Account',
              aggregateId: randomUUID(),
            }),
          ),
        ),
      ),
    ).toBe('42501');
  });
});

describe('particiones mensuales (tarea 4.3)', () => {
  it('el job crea las particiones siguientes con RLS forzada y política; avisa si la DEFAULT tiene filas', async () => {
    const result = await ensureAuditPartitions(worker, 4);
    expect(result.created).toBeGreaterThanOrEqual(2);
    expect(result.defaultRows).toBeGreaterThan(0); // los registros de 2026-03 (FixedClock) cayeron en DEFAULT
    expect((await ensureAuditPartitions(worker, 4)).created).toBe(0);
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const name = `audit_log_y${next.getUTCFullYear()}m${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
    const { rows } = await migrator.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              has_table_privilege('pf_app', c.oid, 'SELECT') AS app_select
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname = $1`,
      [name],
    );
    expect(rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
      policies: 1,
      app_select: false,
    });
  });

  it('una fila del mes actual va a su partición mensual, no a la DEFAULT', async () => {
    const live = createAuditRuntime({
      pool: app,
      clock: systemClock,
      ipHmacKeys: HMAC_KEY,
      policies: [],
      timeZones: { timeZoneOf: async () => 'UTC' },
    });
    const id = randomUUID();
    await asUi(() =>
      uow.run({ userId: u1, workspaceId: w1 }, () =>
        live.port.append({
          workspaceId: w1,
          action: 'accounts.account.renamed',
          aggregateType: 'Account',
          aggregateId: id,
        }),
      ),
    );
    const part = await inCtx(
      app,
      { workspaceId: w1 },
      async (c) =>
        (
          await c.query('SELECT tableoid::regclass::text AS p FROM audit.audit_log WHERE aggregate_id = $1', [
            id,
          ])
        ).rows[0]?.p,
    );
    expect(part).toMatch(/^audit\.audit_log_y\d{4}m\d{2}$/);
  });
});
