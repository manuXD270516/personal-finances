import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext, PgUnitOfWork } from '@pf/platform/api';
import {
  importExternalNamespace,
  type ImportedTransactionRowDto,
  type ImportedTransactionsCommand,
} from '@pf/transactions/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import { asAdmin, money, startHarness, type Harness, type User } from '../support/portability.js';

// Tipos de movimiento importados y deshacer por conjunto contra el stack real (openspec add-import-pipeline, tareas
// 3.4–3.6): `RecordImportedTransactions` con transferencias y conversiones, `voidBatch` con la reversa exacta del
// ledger (`reverseJournalEntries`) y la idempotencia por identificador del banco.
const deps = inject('deps');
const OFX = importExternalNamespace('OFX');
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

let h: Harness;
let owner: User;
let runtime: ReturnType<typeof demoQueryRuntimes>;
let pool: Pool;
let uow: PgUnitOfWork;

async function createAccount(name: string, currency = 'BOB', opening = '4000.00'): Promise<string> {
  const reply = await h.call('POST', `${W(owner)}/accounts`, {
    token: owner.token,
    body: {
      name,
      type: 'BANK',
      currency,
      openingBalance: { amount: money(opening, currency), date: '2026-07-01' },
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
  externalRef: { namespace: OFX, id: `FIT-${ref}` },
  ...over,
});

const asImport = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: owner.id }, origin: 'import' }, () =>
    uow.run({ userId: owner.id, workspaceId: owner.ws }, fn),
  );

const recordBatch = (accountId: string, importJobId: string, rows: ImportedTransactionRowDto[]) =>
  asImport(() =>
    runtime.r.transactions.imported.recordBatch({
      workspaceId: owner.ws,
      accountId,
      importJobId,
      actorUserId: owner.id,
      rows,
    }),
  );

const voidBatch = (
  importJobId: string,
  transactionIds: string[],
  extra: Partial<Parameters<ImportedTransactionsCommand['voidBatch']>[0]> = {},
) =>
  asImport(() =>
    runtime.r.transactions.imported.voidBatch({
      workspaceId: owner.ws,
      importJobId,
      actorUserId: owner.id,
      transactionIds,
      reason: 'IMPORT_REVERTED',
      ...extra,
    }),
  );

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
  owner = await h.user(`kc-imported-movements-${randomUUID()}`);
  runtime = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-10-20' });
  pool = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  uow = new PgUnitOfWork(pool);
}, 300_000);

afterAll(async () => {
  await Promise.all([h?.close(), runtime?.close(), pool?.end()]);
});

describe('Tipos de movimiento importados y deshacer por conjunto (PostgreSQL real)', () => {
  it('[TC-IMPORTS-PIPELINE-044] una transferencia importada mueve ambas cuentas, queda con source IMPORT y es idempotente por identificador del banco', async () => {
    const bank = await createAccount('Banco BOB transf');
    const savings = await createAccount('Ahorro BOB transf', 'BOB', '0.00');
    const job = randomUUID();
    const transfer = row('t1', {
      kind: 'TRANSFER',
      amount: { amount: '1500.00', currency: 'BOB' },
      transfer: { counterAccountId: savings },
    });
    const result = await recordBatch(bank, job, [row('e1'), transfer]);
    expect(result.created).toHaveLength(2);
    expect(await balanceOf(bank)).toBe('2475.00');
    expect(await balanceOf(savings)).toBe('1500.00');
    const [, transferId] = result.created.map((c) => c.transactionId) as [string, string];
    expect(
      await one(
        `SELECT count(*) AS n FROM txn.transaction
          WHERE id = $1 AND kind = 'TRANSFER' AND source = 'IMPORT' AND import_job_id = $2::uuid
            AND external_ref_namespace = 'imports.ext:OFX' AND external_ref_id = 'FIT-t1'`,
        [transferId, job],
      ),
    ).toBe(1);
    // Reimportar el mismo archivo: nada nuevo, ni en la cuenta del import ni vista desde la contraparte.
    const again = await recordBatch(bank, randomUUID(), [row('e1'), transfer]);
    expect(again.created).toEqual([]);
    expect(again.alreadyExisting).toHaveLength(2);
    const fromSavings = await recordBatch(savings, randomUUID(), [
      row('t1', {
        direction: 'IN',
        kind: 'TRANSFER',
        amount: { amount: '1500.00', currency: 'BOB' },
        transfer: { counterAccountId: bank },
      }),
    ]);
    expect(fromSavings.created).toEqual([]);
    expect(await balanceOf(bank)).toBe('2475.00');
  }, 60_000);

  it('[TC-IMPORTS-PIPELINE-059] voidBatch anula el import con reversa exacta de cada asiento y devuelve los saldos originales', async () => {
    const bank = await createAccount('Banco BOB deshacer');
    const savings = await createAccount('Ahorro BOB deshacer', 'BOB', '0.00');
    const job = randomUUID();
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(`d${i}`, { amount: { amount: '10.50', currency: 'BOB' } })),
      row('din', { direction: 'IN', amount: { amount: '200.00', currency: 'BOB' } }),
      row('dtr', {
        kind: 'TRANSFER',
        amount: { amount: '300.00', currency: 'BOB' },
        transfer: { counterAccountId: savings },
      }),
    ];
    const created = await recordBatch(bank, job, rows);
    const ids = created.created.map((c) => c.transactionId);
    expect(await balanceOf(bank)).toBe(String((4000 - 30 * 10.5 + 200 - 300).toFixed(2)));
    expect(await balanceOf(savings)).toBe('300.00');

    const voided = await voidBatch(job, ids);
    expect([...voided.voided].sort()).toEqual([...ids].sort());
    expect(voided.blocked).toEqual([]);
    expect(await balanceOf(bank)).toBe('4000.00');
    expect(await balanceOf(savings)).toBe('0.00');
    expect(
      await one(
        `SELECT count(*) AS n FROM txn.transaction WHERE id = ANY($1::uuid[]) AND status = 'VOIDED'`,
        [ids],
      ),
    ).toBe(32);
    expect(
      await one(
        `SELECT count(*) AS n FROM ledger.entry_reversal r
           JOIN txn.transaction_journal_link l ON l.journal_entry_id = r.original_entry_id
          WHERE l.transaction_id = ANY($1::uuid[])`,
        [ids],
      ),
    ).toBe(32);
    expect(
      await one(
        `SELECT count(*) AS n FROM audit.audit_log
          WHERE aggregate_id = ANY($1::uuid[]) AND action = 'transactions.transaction.voided'`,
        [ids],
      ),
    ).toBe(32);

    // Idempotente: la segunda vez todas se informan ya anuladas.
    const again = await voidBatch(job, ids);
    expect(again.voided).toEqual([]);
    expect([...again.alreadyVoided].sort()).toEqual([...ids].sort());
    expect(await balanceOf(bank)).toBe('4000.00');

    // La referencia queda libre: el mismo archivo vuelve a crear sus filas.
    const reimport = await recordBatch(bank, randomUUID(), [rows[0] as ImportedTransactionRowDto]);
    expect(reimport.created).toHaveLength(1);
  }, 120_000);

  it('[TC-IMPORTS-PIPELINE-060] un periodo cerrado bloquea el deshacer del conjunto y con allowBlocked se informa sin tocar esa transacción', async () => {
    const bank = await createAccount('Banco BOB cerrado');
    const job = randomUUID();
    const created = await recordBatch(bank, job, [
      row('p1', { date: '2026-08-14' }),
      row('p2', { date: '2026-10-03' }),
    ]);
    const [august, october] = created.created.map((c) => c.transactionId) as [string, string];
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
         VALUES ($1, '2026-08', '2026-08-01', '2026-08-31')`,
        [owner.ws],
      ),
    );
    try {
      await expect(voidBatch(job, [august, october])).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
      expect(await balanceOf(bank)).toBe('3950.00');
      const partial = await voidBatch(job, [august, october], { allowBlocked: true });
      expect(partial.voided).toEqual([october]);
      expect(partial.blocked).toEqual([{ transactionId: august, code: 'PERIOD_CLOSED' }]);
      expect(await balanceOf(bank)).toBe('3975.00');
    } finally {
      await asAdmin(h, (c) => c.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [owner.ws]));
    }
  }, 60_000);

  it('[TC-IMPORTS-PIPELINE-046] una conversión importada conserva el detalle inmutable y su anulación revierte los dos asientos de monedas distintas', async () => {
    const bob = await createAccount('Banco BOB conv');
    const usd = await createAccount('Banco USD conv', 'USD', '0.00');
    const job = randomUUID();
    const created = await recordBatch(bob, job, [
      row('c1', {
        kind: 'CONVERSION',
        amount: { amount: '696.00', currency: 'BOB' },
        conversion: {
          counterAccountId: usd,
          counterAmount: { amount: '100.00', currency: 'USD' },
          executedAt: '2026-10-02T15:00:00Z',
        },
      }),
    ]);
    const id = created.created[0]!.transactionId;
    expect(await balanceOf(bob)).toBe('3304.00');
    expect(await balanceOf(usd)).toBe('100.00');
    expect(
      await one(
        `SELECT count(*) AS n FROM txn.transaction
          WHERE id = $1 AND kind = 'CONVERSION' AND source = 'IMPORT' AND import_job_id = $2::uuid`,
        [id, job],
      ),
    ).toBe(1);
    const voided = await voidBatch(job, [id]);
    expect(voided.voided).toEqual([id]);
    expect(await balanceOf(bob)).toBe('4000.00');
    expect(await balanceOf(usd)).toBe('0.00');
  }, 60_000);
});
