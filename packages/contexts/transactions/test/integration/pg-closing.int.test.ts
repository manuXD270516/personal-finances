import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { CategoryLookupPort } from '../../src/application/ports/index.js';
import { Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import { PgTransactionsClosingQuery } from '../../src/infrastructure/pg-closing.js';
import {
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
} from '../../src/infrastructure/pg-transactions.js';

// `TransactionsClosingQuery` contra PostgreSQL real (Testcontainers + `migrate` real; openspec add-month-closing,
// tareas 2.5/3.5): lecturas del checklist de cierre del rango del periodo, con RLS por workspace.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const UNCAT = randomUUID();
const UNCAT_INCOME = randomUUID();
const GROCERIES = randomUUID();
const categories: CategoryLookupPort = {
  uncategorized: async (_ws, kind) => (kind === 'INCOME' ? UNCAT_INCOME : UNCAT),
  fees: async () => null,
  withDescendants: async (_ws, ids) => [...ids],
};

let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const transactions = new PgTransactionRepository();
let closing: PgTransactionsClosingQuery;

const inWs = <T>(workspaceId: string, fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId }, fn);
const range = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };

async function newWorkspace(): Promise<string> {
  const ws = randomUUID();
  await uow.run({ userId: u1, workspaceId: ws }, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Closing', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, u1],
    );
  });
  return ws;
}

async function insert(workspaceId: string, over: Partial<RecordTransactionInput> = {}): Promise<Transaction> {
  const tx = Transaction.record({
    id: randomUUID(),
    workspaceId,
    kind: 'EXPENSE',
    businessDate: '2026-10-10',
    accountId: randomUUID(),
    accountNature: 'ASSET',
    accountCurrency: 'BOB',
    amount: bob('10.00'),
    description: 'G',
    status: 'POSTED',
    defaultCategoryId: GROCERIES,
    defaultSplitId: randomUUID(),
    ...over,
  });
  if (tx.needsEntry) tx.attachEntry(randomUUID());
  await inWs(workspaceId, () => transactions.insert(tx));
  return tx;
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  closing = new PgTransactionsClosingQuery(new PgTransactionsUnitOfWork(app), pgCurrencyCatalog, categories);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/closing', $1, $2, 'U1') AS id`,
    [`sub-closing-${randomUUID()}`, `closing-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgTransactionsClosingQuery', () => {
  it('[TC-PLANNING-CHECKLIST-001] pendientes del rango (sin contar 2026-11-01), sumadas por moneda, detalle por fecha e id', async () => {
    const ws = await newWorkspace();
    const a = await insert(ws, {
      status: 'PENDING',
      businessDate: '2026-10-31',
      amount: bob('30.00'),
      description: 'Luz',
    });
    const b = await insert(ws, { status: 'PENDING', businessDate: '2026-10-05', amount: bob('60.00') });
    await insert(ws, {
      status: 'PENDING',
      businessDate: '2026-10-20',
      amount: usd('5.00'),
      accountCurrency: 'USD',
    });
    await insert(ws, { status: 'PENDING', businessDate: '2026-11-01', amount: bob('99.00') });
    await insert(ws, { status: 'POSTED', businessDate: '2026-10-06', amount: bob('77.00') });
    const finding = await inWs(ws, () => closing.countPendingInRange({ workspaceId: ws, ...range }));
    expect(finding.count).toBe(3);
    expect(finding.amounts).toEqual([
      { amount: '90.00', currency: 'BOB' },
      { amount: '5.00', currency: 'USD' },
    ]);
    expect(finding.details.map((d) => [d.refType, d.refId, d.date])).toEqual([
      ['TRANSACTION', b.id, '2026-10-05'],
      ['TRANSACTION', expect.any(String), '2026-10-20'],
      ['TRANSACTION', a.id, '2026-10-31'],
    ]);
    expect(finding.details[2]).toMatchObject({ label: 'Luz', amount: { amount: '30.00', currency: 'BOB' } });
    expect(finding.truncated).toBe(false);
    // Otro workspace no ve nada (RLS).
    const other = await newWorkspace();
    expect(
      (await inWs(other, () => closing.countPendingInRange({ workspaceId: other, ...range }))).count,
    ).toBe(0);
  });

  it('[TC-PLANNING-CHECKLIST-001] el detalle se limita a 50 y marca truncated; count y montos cubren todos', async () => {
    const ws = await newWorkspace();
    for (let i = 0; i < 51; i++) {
      await insert(ws, { status: 'PENDING', businessDate: '2026-10-15', amount: bob('1.00') });
    }
    const finding = await inWs(ws, () => closing.countPendingInRange({ workspaceId: ws, ...range }));
    expect(finding.count).toBe(51);
    expect(finding.details).toHaveLength(50);
    expect(finding.truncated).toBe(true);
    expect(finding.amounts).toEqual([{ amount: '51.00', currency: 'BOB' }]);
  });

  it('[TC-PLANNING-CLOSE-006] porciones sin categoría de sistema: 210.00 BOB; transferencias, anuladas y pendientes no cuentan', async () => {
    const ws = await newWorkspace();
    const acc = randomUUID();
    await insert(ws, { accountId: acc, amount: bob('150.00'), defaultCategoryId: UNCAT });
    await insert(ws, {
      accountId: acc,
      amount: bob('60.00'),
      splits: [{ id: randomUUID(), amount: bob('60.00'), categoryId: UNCAT_INCOME }],
      kind: 'INCOME',
    });
    await insert(ws, { accountId: acc, amount: bob('40.00'), defaultCategoryId: GROCERIES });
    await insert(ws, { accountId: acc, amount: bob('500.00'), defaultCategoryId: UNCAT, status: 'PENDING' });
    await insert(ws, {
      accountId: acc,
      amount: bob('15.00'),
      defaultCategoryId: UNCAT,
      businessDate: '2026-11-02',
    });
    const finding = await inWs(ws, () => closing.countUncategorizedInRange({ workspaceId: ws, ...range }));
    expect(finding.count).toBe(2);
    expect(finding.amounts).toEqual([{ amount: '210.00', currency: 'BOB' }]);
    expect(finding.details.every((d) => d.refType === 'SPLIT')).toBe(true);
    expect(finding.details).toHaveLength(2);
    expect(finding.truncated).toBe(false);
  });

  it('[TC-PLANNING-CLOSE-007] conciliadas sin extracto del rango por cuenta; las de extracto y otras cuentas no aparecen', async () => {
    const ws = await newWorkspace();
    const accA = randomUUID();
    const accB = randomUUID();
    const wos = await insert(ws, { accountId: accA, amount: bob('80.00'), businessDate: '2026-10-12' });
    const stmt = await insert(ws, { accountId: accA, amount: bob('20.00'), businessDate: '2026-10-13' });
    const outside = await insert(ws, { accountId: accA, amount: bob('25.00'), businessDate: '2026-11-03' });
    const otherAcc = await insert(ws, { accountId: accB, amount: bob('35.00'), businessDate: '2026-10-14' });
    await inWs(ws, async () => {
      const exec = requireSqlExecutor();
      for (const [tx, mode] of [
        [wos, 'WITHOUT_STATEMENT'],
        [stmt, 'STATEMENT'],
        [outside, 'WITHOUT_STATEMENT'],
        [otherAcc, 'WITHOUT_STATEMENT'],
      ] as const) {
        await exec.query(
          `UPDATE txn.transaction SET status = 'RECONCILED', reconciliation_mode = $2 WHERE id = $1`,
          [tx.id, mode],
        );
      }
    });
    const rows = await inWs(ws, () =>
      closing.listReconciledWithoutStatementInRange({ workspaceId: ws, accountIds: [accA], ...range }),
    );
    expect(rows).toEqual([
      {
        accountId: accA,
        transactionId: wos.id,
        businessDate: '2026-10-12',
        amount: { amount: '-80.00', currency: 'BOB' },
      },
    ]);
    expect(
      await inWs(ws, () =>
        closing.listReconciledWithoutStatementInRange({ workspaceId: ws, accountIds: [], ...range }),
      ),
    ).toEqual([]);
  });

  it('[TC-PLANNING-CLOSE-007] cuentas con actividad: excluye pendientes, anuladas y fechas fuera del rango', async () => {
    const ws = await newWorkspace();
    const [active, onlyPending, onlyVoided, outside] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await insert(ws, { accountId: active });
    await insert(ws, { accountId: onlyPending, status: 'PENDING' });
    const voided = await insert(ws, { accountId: onlyVoided });
    await inWs(ws, () =>
      requireSqlExecutor().query(
        `UPDATE txn.transaction SET status = 'VOIDED', voided_at = now(), active_entry_id = NULL WHERE id = $1`,
        [voided.id],
      ),
    );
    await insert(ws, { accountId: outside, businessDate: '2026-09-30' });
    const ids = await inWs(ws, () =>
      closing.listAccountIdsWithActivityInRange({ workspaceId: ws, ...range }),
    );
    expect(ids).toEqual([active]);
  });

  it('[TC-PLANNING-CHECKLIST-001] duplicados derivados: pares dentro de la ventana con al menos una transacción en el rango', async () => {
    const ws = await newWorkspace();
    const acc = randomUUID();
    const first = await insert(ws, {
      accountId: acc,
      amount: bob('100.00'),
      description: 'Hipermaxi',
      businessDate: '2026-10-10',
    });
    const second = await insert(ws, {
      accountId: acc,
      amount: bob('100.00'),
      description: 'Hipermaxi',
      businessDate: '2026-10-12',
    });
    // Par que cruza el borde del rango: 10-31 y 11-02 (una dentro).
    const edgeA = await insert(ws, {
      accountId: acc,
      amount: bob('55.00'),
      description: 'Netflix',
      businessDate: '2026-10-31',
    });
    const edgeB = await insert(ws, {
      accountId: acc,
      amount: bob('55.00'),
      description: 'Netflix',
      businessDate: '2026-11-02',
    });
    // No son duplicados: otro monto, ventana > 3 días, otra descripción sin contraparte común.
    await insert(ws, {
      accountId: acc,
      amount: bob('100.50'),
      description: 'Hipermaxi',
      businessDate: '2026-10-11',
    });
    await insert(ws, {
      accountId: acc,
      amount: bob('100.00'),
      description: 'Hipermaxi',
      businessDate: '2026-10-20',
    });
    await insert(ws, {
      accountId: acc,
      amount: bob('100.00'),
      description: 'Taxi',
      businessDate: '2026-10-11',
    });
    const finding = await inWs(ws, () => closing.countOpenDuplicatesInRange({ workspaceId: ws, ...range }));
    expect(finding.count).toBe(2);
    expect(finding.details.map((d) => [d.refType, d.refId, d.date])).toEqual([
      ['DUPLICATE_CANDIDATE', second.id, '2026-10-12'],
      ['DUPLICATE_CANDIDATE', edgeB.id, '2026-11-02'],
    ]);
    expect(finding.amounts).toEqual([{ amount: '155.00', currency: 'BOB' }]);
    expect([first.id, edgeA.id]).not.toContain(finding.details[0]?.refId);
  });
});
