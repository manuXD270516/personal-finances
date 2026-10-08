import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, DomainError, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Reconciliation, Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import { PgReconciliationRepository } from '../../src/infrastructure/pg-reconciliations.js';
import { PgTransactionRepository } from '../../src/infrastructure/pg-transactions.js';

// Repositorio de sesiones de reconciliación contra PostgreSQL real (Testcontainers + `migrate` real; openspec
// add-reconciliation, tarea 4.1–4.2): RLS por workspace, una sola sesión en curso por cuenta (índice único parcial),
// CHECKs de coherencia, consultas agregadas de saldo confirmado, bloqueo `FOR UPDATE` de las incluidas, anotación de la
// des-reconciliación posterior y el relleno de las RECONCILED de Phase 1 como "sin extracto" (D77).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const bankA = randomUUID();
const cash = randomUUID();
const transactions = new PgTransactionRepository();
const repo = new PgReconciliationRepository(transactions);

const inWs = <T>(workspaceId: string, fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId }, fn);

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    return (err as { code?: string }).code;
  }
  return undefined;
}

const record = (workspaceId: string, over: Partial<RecordTransactionInput> = {}) => {
  const tx = Transaction.record({
    id: randomUUID(),
    workspaceId,
    kind: 'EXPENSE',
    businessDate: '2026-03-05',
    accountId: bankA,
    accountNature: 'ASSET',
    accountCurrency: 'BOB',
    amount: bob('150.00'),
    description: 'G',
    status: 'CLEARED',
    defaultCategoryId: randomUUID(),
    defaultSplitId: randomUUID(),
    ...over,
  });
  if (tx.needsEntry) tx.attachEntry(randomUUID());
  return tx;
};

const session = (workspaceId: string, over: Partial<Parameters<typeof Reconciliation.start>[0]> = {}) =>
  Reconciliation.start({
    id: randomUUID(),
    workspaceId,
    accountId: bankA,
    statementDate: '2026-03-31',
    statementBalance: bob('3350.00'),
    today: '2026-04-05',
    lastCompletedStatementDate: null,
    startedBy: u1,
    ...over,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/rec', $1, $2, 'U1') AS id`,
    [`sub-rec-${randomUUID()}`, `rec-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await uow.run({ userId: u1, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Rec', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, u1],
      );
    });
  }
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgReconciliationRepository — sesiones', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-001] round-trip de la sesión y una sola sesión en curso por cuenta (índice único parcial)', async () => {
    const s = session(w1);
    await inWs(w1, () => repo.insert(s));
    const loaded = (await inWs(w1, () => repo.findById(w1, s.id)))!;
    expect(loaded.snapshot).toMatchObject({
      status: 'IN_PROGRESS',
      accountId: bankA,
      statementDate: '2026-03-31',
      version: 1,
      clearedBalance: null,
      difference: null,
    });
    expect(loaded.snapshot.statementBalance.toFixed()).toBe('3350.00');
    expect(loaded.snapshot.startedAt).not.toBeNull();
    expect((await inWs(w1, () => repo.findInProgress(w1, bankA)))?.id).toBe(s.id);
    // Otra sesión en curso para la misma cuenta ⇒ 23505 (RECONCILIATION_IN_PROGRESS se decide antes en la aplicación).
    expect(await pgError(inWs(w1, () => repo.insert(session(w1))))).toBe('23505');
    // Otra cuenta sí; y cancelada la primera, la cuenta admite una nueva.
    await inWs(w1, () => repo.insert(session(w1, { accountId: cash })));
    const cancelling = (await inWs(w1, () => repo.findById(w1, s.id)))!;
    cancelling.cancel({ cancelledBy: u1, at: '2026-04-05T14:00:00.000Z' });
    expect(await inWs(w1, () => repo.update(cancelling))).toBe(true);
    await inWs(w1, () => repo.insert(session(w1)));
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-013] optimistic locking: el segundo escritor con la misma versión pierde', async () => {
    const s = session(w1, { accountId: randomUUID() });
    await inWs(w1, () => repo.insert(s));
    const a = (await inWs(w1, () => repo.findById(w1, s.id)))!;
    const b = (await inWs(w1, () => repo.findById(w1, s.id)))!;
    a.touch();
    b.touch();
    expect(await inWs(w1, () => repo.update(a))).toBe(true);
    expect(await inWs(w1, () => repo.update(b))).toBe(false);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-006] los CHECK de coherencia: COMPLETED exige saldo confirmado congelado y diferencia 0', async () => {
    const s = session(w1, { accountId: randomUUID() });
    await inWs(w1, () => repo.insert(s));
    const run = (sql: string) =>
      pgError(
        inWs(w1, () =>
          requireSqlExecutor()
            .query(sql, [s.id])
            .then(() => undefined),
        ),
      );
    expect(await run(`UPDATE txn.reconciliation SET status = 'COMPLETED' WHERE id = $1`)).toBe('23514');
    expect(
      await run(
        `UPDATE txn.reconciliation SET status = 'COMPLETED', completed_at = now(), completed_by = started_by,
                cleared_balance = 3349.00, difference = 1.00 WHERE id = $1`,
      ),
    ).toBe('23514');
    expect(await run(`UPDATE txn.reconciliation SET status = 'CANCELLED' WHERE id = $1`)).toBe('23514');
    // Sin DELETE para la aplicación (las sesiones se conservan).
    expect(await run(`DELETE FROM txn.reconciliation WHERE id = $1`)).toBe('42501');
  });

  it('[TC-SECURITY-RLS-004] aislamiento entre workspaces: w2 no ve ni escribe sesiones ni ítems de w1', async () => {
    const s = session(w1, { accountId: randomUUID() });
    await inWs(w1, () => repo.insert(s));
    const tx = record(w1);
    await inWs(w1, () => transactions.insert(tx));
    await inWs(w1, () =>
      repo.insertItems(w1, [
        { reconciliationId: s.id, transactionId: tx.id, verifiedWithoutStatement: false },
      ]),
    );
    expect(await inWs(w2, () => repo.findById(w2, s.id))).toBeNull();
    expect(await inWs(w2, () => repo.findById(w1, s.id))).toBeNull();
    expect(await inWs(w2, () => repo.itemsOf(w1, s.id))).toEqual([]);
    expect(await inWs(w1, () => repo.itemsOf(w1, s.id))).toHaveLength(1);
    // Escribir una sesión de w1 estando en el contexto de w2 viola la política (WITH CHECK).
    expect(await pgError(inWs(w2, () => repo.insert(session(w1))))).toBe('42501');
  });
});

describe('PgReconciliationRepository — saldo confirmado y bloqueo', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-003] la consulta agregada suma los legs vigentes de la cuenta de las cleared/reconciled hasta el extracto', async () => {
    const account = randomUUID();
    const other = randomUUID();
    const cleared = record(w1, { accountId: account, amount: bob('150.00'), businessDate: '2026-03-05' });
    const income = record(w1, {
      accountId: account,
      kind: 'INCOME',
      amount: bob('2500.00'),
      businessDate: '2026-03-10',
    });
    const posted = record(w1, {
      accountId: account,
      amount: bob('45.90'),
      businessDate: '2026-03-20',
      status: 'POSTED',
    });
    const later = record(w1, { accountId: account, amount: bob('200.00'), businessDate: '2026-04-02' });
    const foreign = record(w1, { accountId: other, amount: bob('999.00'), businessDate: '2026-03-06' });
    for (const t of [cleared, income, posted, later, foreign]) await inWs(w1, () => transactions.insert(t));
    // Una reconciliada y una anulada (void ⇒ nunca suma).
    const reconciled = record(w1, { accountId: account, amount: bob('10.00'), businessDate: '2026-03-07' });
    reconciled.reconcile(randomUUID());
    await inWs(w1, () => transactions.insert(reconciled));
    const voided = record(w1, {
      accountId: account,
      amount: bob('77.00'),
      businessDate: '2026-03-08',
      status: 'PENDING',
    });
    await inWs(w1, () => transactions.insert(voided));

    const both = await inWs(w1, () =>
      repo.confirmedLegsTotal({
        workspaceId: w1,
        accountId: account,
        currency: 'BOB',
        through: '2026-03-31',
        statuses: ['CLEARED', 'RECONCILED'],
      }),
    );
    // −150.00 + 2500.00 − 10.00 = 2340.00 (la posted del 03-20, la del 04-02 y la pendiente no suman).
    expect(both.total.toFixed()).toBe('2340.00');
    expect(both.count).toBe(3);
    const onlyReconciled = await inWs(w1, () =>
      repo.confirmedLegsTotal({
        workspaceId: w1,
        accountId: account,
        currency: 'BOB',
        through: '2026-03-31',
        statuses: ['RECONCILED'],
      }),
    );
    expect(onlyReconciled.total.toFixed()).toBe('-10.00');
    // `lockClearedThrough` devuelve exactamente las cleared incluidas (aggregates hidratados) por fecha.
    const locked = await inWs(w1, () => repo.lockClearedThrough(w1, account, '2026-03-31'));
    expect(locked.map((t) => t.id)).toEqual([cleared.id, income.id]);
    expect(locked.every((t) => t.status === 'CLEARED')).toBe(true);
    // Sin transacciones: total 0 en la escala de la moneda.
    const empty = await inWs(w1, () =>
      repo.confirmedLegsTotal({
        workspaceId: w1,
        accountId: randomUUID(),
        currency: 'BOB',
        through: '2026-03-31',
        statuses: ['CLEARED', 'RECONCILED'],
      }),
    );
    expect(empty.total.toFixed()).toBe('0.00');
    expect(empty.count).toBe(0);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-015] la des-reconciliación posterior se anota en el ítem de la sesión sin alterarla; las de Phase 1 no tienen sesión', async () => {
    const s = session(w1, { accountId: randomUUID() });
    await inWs(w1, () => repo.insert(s));
    const tx = record(w1, { accountId: s.snapshot.accountId });
    await inWs(w1, () => transactions.insert(tx));
    await inWs(w1, () =>
      repo.insertItems(w1, [
        { reconciliationId: s.id, transactionId: tx.id, verifiedWithoutStatement: false },
      ]),
    );
    const marked = await inWs(w1, () =>
      repo.markUnreconciled({ workspaceId: w1, transactionId: tx.id, reason: 'duplicado en extracto' }),
    );
    expect(marked).toEqual({ reconciliationId: s.id });
    const items = await inWs(w1, () => repo.itemsOf(w1, s.id));
    expect(items[0]).toMatchObject({ transactionId: tx.id, unreconcileReason: 'duplicado en extracto' });
    expect(items[0]?.unreconciledAt).not.toBeNull();
    // Ya anotado, o sin sesión (reconciliada en Phase 1 / sin extracto) ⇒ null.
    expect(
      await inWs(w1, () =>
        repo.markUnreconciled({ workspaceId: w1, transactionId: tx.id, reason: 'otra vez' }),
      ),
    ).toBeNull();
    expect(
      await inWs(w1, () =>
        repo.markUnreconciled({ workspaceId: w1, transactionId: randomUUID(), reason: 'x' }),
      ),
    ).toBeNull();
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-020] los conteos del estado por cuenta: posted, cleared, conciliadas sin extracto en el rango y después del extracto', async () => {
    const account = randomUUID();
    const posted = record(w1, { accountId: account, status: 'POSTED', businessDate: '2026-03-20' });
    const cleared = record(w1, { accountId: account, businessDate: '2026-03-21' });
    const without = record(w1, { accountId: account, businessDate: '2026-03-12' });
    without.reconcileWithoutStatement('WITHOUT_STATEMENT');
    const verified = record(w1, { accountId: account, businessDate: '2026-03-13' });
    verified.reconcile(randomUUID());
    const beyond = record(w1, { accountId: account, status: 'POSTED', businessDate: '2026-04-10' });
    for (const t of [posted, cleared, without, verified, beyond])
      await inWs(w1, () => transactions.insert(t));
    const counts = await inWs(w1, () =>
      repo.coverageCounts({
        workspaceId: w1,
        accountId: account,
        from: '2026-03-01',
        through: '2026-03-31',
        afterDate: '2026-03-10',
      }),
    );
    expect(counts).toEqual({
      unreconciledPostedCount: 1,
      unreconciledClearedCount: 1,
      withoutStatementInRange: 1,
      withoutStatementAfterLastStatement: true,
    });
    const none = await inWs(w1, () =>
      repo.coverageCounts({
        workspaceId: w1,
        accountId: account,
        from: '2026-03-13',
        through: '2026-03-31',
        afterDate: '2026-03-12',
      }),
    );
    expect(none.withoutStatementInRange).toBe(0);
    expect(none.withoutStatementAfterLastStatement).toBe(false);
  });
});

describe('Migración txn_reconciliation (docs/33 D77)', () => {
  const migration = readFileSync(
    new URL('../../../../../apps/api/db/migrations/20261008140000_txn_reconciliation.sql', import.meta.url),
    'utf8',
  );
  /** Relleno de las RECONCILED de Phase 1 tal cual lo ejecuta la migración (desde el NO FORCE hasta el VALIDATE). */
  const backfill = migration.slice(
    migration.indexOf('ALTER TABLE txn.transaction NO FORCE ROW LEVEL SECURITY;'),
    migration.indexOf('-- Filtro `systemFlag=RECONCILED_WITHOUT_STATEMENT`'),
  );

  it('[TC-TRANSACTIONS-RECONCILIATION-023] una RECONCILED de Phase 1 pasa a WITHOUT_STATEMENT sin cambiar su estado, versión ni historia; es idempotente', async () => {
    const legacy = randomUUID();
    const open = randomUUID();
    const client = await migrator.connect();
    try {
      await client.query('BEGIN');
      // Estado previo a la migración: sin el CHECK del modo. Todo dentro de una transacción que se revierte.
      await client.query('ALTER TABLE txn.transaction DROP CONSTRAINT transaction_reconciliation_mode_ck');
      await client.query('ALTER TABLE txn.transaction NO FORCE ROW LEVEL SECURITY');
      const insert = (id: string, status: string) =>
        client.query(
          `INSERT INTO txn.transaction (id, workspace_id, kind, status, transaction_date, account_id, amount, currency,
                                        adjustment_direction, adjustment_reason, active_entry_id, version, revision)
           VALUES ($1, $2, 'ADJUSTMENT', $3, '2026-03-05', $4, 150.00, 'BOB', 'INCREASE', 'Phase 1', $5, 4, 1)`,
          [id, w1, status, bankA, randomUUID()],
        );
      await insert(legacy, 'RECONCILED');
      await insert(open, 'CLEARED');
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE txn.transaction FORCE ROW LEVEL SECURITY');

      await client.query(backfill);

      await client.query('ALTER TABLE txn.transaction NO FORCE ROW LEVEL SECURITY');
      const read = () =>
        client.query<{ id: string; status: string; mode: string | null; version: number }>(
          `SELECT id, status, reconciliation_mode AS mode, version FROM txn.transaction WHERE id = ANY($1)`,
          [[legacy, open]],
        );
      const byId = new Map((await read()).rows.map((r) => [r.id, r]));
      expect(byId.get(legacy)).toMatchObject({ status: 'RECONCILED', mode: 'WITHOUT_STATEMENT', version: 4 });
      expect(byId.get(open)).toMatchObject({ status: 'CLEARED', mode: null, version: 4 });
      // Idempotente: una segunda ejecución del relleno no cambia nada.
      const again = await client.query(
        `UPDATE txn.transaction SET reconciliation_mode = 'WITHOUT_STATEMENT'
          WHERE status = 'RECONCILED' AND reconciliation_mode IS NULL`,
      );
      expect(again.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-016] el CHECK impide una RECONCILED sin modo y un modo en una no reconciliada', async () => {
    const tx = record(w1);
    await inWs(w1, () => transactions.insert(tx));
    const run = (sql: string) =>
      pgError(
        inWs(w1, () =>
          requireSqlExecutor()
            .query(sql, [tx.id])
            .then(() => undefined),
        ),
      );
    expect(await run(`UPDATE txn.transaction SET status = 'RECONCILED' WHERE id = $1`)).toBe('23514');
    expect(
      await run(`UPDATE txn.transaction SET reconciliation_mode = 'WITHOUT_STATEMENT' WHERE id = $1`),
    ).toBe('23514');
    expect(
      await run(
        `UPDATE txn.transaction SET status = 'RECONCILED', reconciliation_mode = 'OTRO' WHERE id = $1`,
      ),
    ).toBe('23514');
    expect(
      await run(
        `UPDATE txn.transaction SET status = 'RECONCILED', reconciliation_mode = 'WITHOUT_STATEMENT' WHERE id = $1`,
      ),
    ).toBeUndefined();
  });
});
