import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext, PgUnitOfWork } from '@pf/platform/api';
import { IMPORT_ROW_NAMESPACE, type ImportedTransactionRowDto } from '@pf/transactions/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import { asAdmin, money, startHarness, type Harness, type User } from '../support/portability.js';

// Registro en lote de transacciones importadas contra el stack real (openspec add-bulk-imported-transactions,
// TC-TRANSACTIONS-BULKIMPORT-001..004): `RecordImportedTransactions` con los repositorios, el ledger, la auditoría, el
// recorrido y el outbox reales sobre PostgreSQL con RLS y todos los disparadores de integridad activos.
const deps = inject('deps');
const JOB = randomUUID();
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

let h: Harness;
let owner: User;
let runtime: ReturnType<typeof demoQueryRuntimes>;
let pool: Pool;
let uow: PgUnitOfWork;

async function createAccount(name: string, opening = '4000.00'): Promise<string> {
  const reply = await h.call('POST', `${W(owner)}/accounts`, {
    token: owner.token,
    body: {
      name,
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money(opening), date: '2026-07-01' },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body['id'] as string;
}

const row = (ref: string, over: Partial<ImportedTransactionRowDto> = {}): ImportedTransactionRowDto => ({
  rowRef: `row-${ref}`,
  date: '2026-10-02',
  direction: 'OUT',
  amount: { amount: '25.00', currency: 'BOB' },
  description: `COMPRA ${ref}`,
  externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${ref}` },
  ...over,
});

/** Un lote como lo ejecuta el consumidor `imports.persist`: usuario que aprobó, origen import, unidad de trabajo propia. */
function recordBatch(accountId: string, rows: ImportedTransactionRowDto[]) {
  return runWithRequestContext({ actor: { type: 'USER', userId: owner.id }, origin: 'import' }, () =>
    uow.run({ userId: owner.id, workspaceId: owner.ws }, () =>
      runtime.r.transactions.imported.recordBatch({
        workspaceId: owner.ws,
        accountId,
        importJobId: JOB,
        actorUserId: owner.id,
        rows,
      }),
    ),
  );
}

const balanceOf = (accountId: string) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });

const one = async (sql: string, params: unknown[]): Promise<number> =>
  asAdmin(h, async (c) => Number((await c.query<{ n: string }>(sql, params)).rows[0]!.n));

beforeAll(async () => {
  h = await startHarness({});
  owner = await h.user(`kc-bulk-owner-${randomUUID()}`);
  runtime = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-10-20' });
  pool = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  uow = new PgUnitOfWork(pool);
}, 300_000);

afterAll(async () => {
  await Promise.all([h?.close(), runtime?.close(), pool?.end()]);
});

describe('Registro en lote de transacciones importadas (PostgreSQL real)', () => {
  it('[TC-TRANSACTIONS-BULKIMPORT-001] un lote de 200 filas crea 200 transacciones con asientos cuadrados, auditoría con origen import y 600 eventos', async () => {
    const account = await createAccount('Banco BOB lote');
    const rows = [
      ...Array.from({ length: 150 }, (_, i) => row(`a${i}`)),
      ...Array.from({ length: 50 }, (_, i) =>
        row(`b${i}`, { direction: 'IN', amount: { amount: '100.00', currency: 'BOB' } }),
      ),
    ];
    const result = await recordBatch(account, rows);
    expect(result.created).toHaveLength(200);
    expect(result.alreadyExisting).toEqual([]);
    // 4000.00 − 150 × 25.00 + 50 × 100.00 = 5250.00
    expect(await balanceOf(account)).toBe('5250.00');
    const ids = result.created.map((c) => c.transactionId);
    expect(
      await one(
        `SELECT count(*) AS n FROM txn.transaction WHERE id = ANY($1::uuid[]) AND status = 'POSTED' AND source = 'IMPORT' AND import_job_id = $2::uuid`,
        [ids, JOB],
      ),
    ).toBe(200);
    // 200 asientos vinculados, cada uno con suma 0.00 y al menos 2 movimientos.
    expect(
      await one(
        `SELECT count(*) AS n FROM txn.transaction_journal_link WHERE transaction_id = ANY($1::uuid[])`,
        [ids],
      ),
    ).toBe(200);
    expect(
      await one(
        `SELECT count(*) AS n FROM (
           SELECT p.journal_entry_id FROM ledger.posting p
             JOIN txn.transaction_journal_link l ON l.journal_entry_id = p.journal_entry_id
            WHERE l.transaction_id = ANY($1::uuid[])
            GROUP BY p.journal_entry_id HAVING sum(p.amount) <> 0 OR count(*) < 2) bad`,
        [ids],
      ),
    ).toBe(0);
    expect(
      await one(
        `SELECT count(*) AS n FROM audit.audit_log
          WHERE aggregate_id = ANY($1::uuid[]) AND action = 'transactions.transaction.created'
            AND origin = 'import' AND actor_user_id = $2::uuid`,
        [ids, owner.id],
      ),
    ).toBe(200);
    expect(
      await one(`SELECT count(*) AS n FROM audit.lifecycle_transition WHERE aggregate_id = ANY($1::uuid[])`, [
        ids,
      ]),
    ).toBe(200);
    const events = await asAdmin(h, async (c) => {
      const { rows: r } = await c.query<{ event_type: string; n: string }>(
        `SELECT event_type, count(*)::text AS n FROM platform.outbox
          WHERE workspace_id = $1 AND (aggregate_id = ANY($2::uuid[])
             OR aggregate_id IN (SELECT journal_entry_id FROM txn.transaction_journal_link WHERE transaction_id = ANY($2::uuid[])))
          GROUP BY event_type ORDER BY event_type`,
        [owner.ws, ids],
      );
      return Object.fromEntries(r.map((x) => [x.event_type, Number(x.n)]));
    });
    expect(events).toEqual({
      'ledger.JournalEntryPosted': 200,
      'transactions.TransactionCreated': 200,
      'transactions.TransactionPosted': 200,
    });
  }, 120_000);

  it('[TC-TRANSACTIONS-BULKIMPORT-002] una fila en un periodo cerrado revierte el lote entero con PERIOD_CLOSED', async () => {
    const account = await createAccount('Banco BOB cerrado');
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
         VALUES ($1, '2026-08', '2026-08-01', '2026-08-31')`,
        [owner.ws],
      ),
    );
    try {
      const rows = [
        ...Array.from({ length: 199 }, (_, i) => row(`c${i}`)),
        row('c-closed', { date: '2026-08-15' }),
      ];
      await expect(recordBatch(account, rows)).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
      expect(
        await one(`SELECT count(*) AS n FROM txn.transaction WHERE account_id = $1 AND source = 'IMPORT'`, [
          account,
        ]),
      ).toBe(0);
      expect(await balanceOf(account)).toBe('4000.00');
    } finally {
      await asAdmin(h, (c) => c.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [owner.ws]));
    }
  }, 120_000);

  it('[TC-TRANSACTIONS-BULKIMPORT-003] 20 referencias ya registradas se informan como existentes y se crean 180', async () => {
    const account = await createAccount('Banco BOB reintento');
    const rows = Array.from({ length: 200 }, (_, i) => row(`d${i}`));
    const first = await recordBatch(account, rows.slice(0, 20));
    expect(first.created).toHaveLength(20);
    const second = await recordBatch(account, rows);
    expect(second.created).toHaveLength(180);
    expect(second.alreadyExisting.map((a) => a.transactionId).sort()).toEqual(
      first.created.map((c) => c.transactionId).sort(),
    );
    expect(await balanceOf(account)).toBe('-1000.00');
  }, 120_000);

  it('[TC-TRANSACTIONS-BULKIMPORT-004] dos lotes simultáneos con las mismas 200 referencias dejan una transacción viva por referencia', async () => {
    const account = await createAccount('Banco BOB concurrente');
    const rows = Array.from({ length: 200 }, (_, i) => row(`e${i}`));
    const [a, b] = await Promise.all([recordBatch(account, rows), recordBatch(account, rows)]);
    expect(a.created.length + b.created.length).toBe(200);
    expect(a.alreadyExisting.length + b.alreadyExisting.length).toBe(200);
    expect(
      await one(
        `SELECT count(*) AS n FROM (
           SELECT external_ref_id FROM txn.transaction
            WHERE account_id = $1 AND external_ref_namespace = $2 AND status <> 'VOIDED'
            GROUP BY external_ref_id HAVING count(*) = 1) uniq`,
        [account, IMPORT_ROW_NAMESPACE],
      ),
    ).toBe(200);
    expect(await balanceOf(account)).toBe('-1000.00');
  }, 120_000);
});
