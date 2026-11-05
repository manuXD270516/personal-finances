import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import { PgNominalFlowQuery, PgNominalPortionQuery } from '../../src/infrastructure/pg-nominal-flows.js';
import {
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
} from '../../src/infrastructure/pg-transactions.js';

// Filtros, agrupación y drill-down de las porciones nominales en PostgreSQL real (openspec add-financial-reports,
// tareas 3.1 y 3.2): el MISMO predicado en la celda (`summarizeNominalFlows`) y en su detalle (`listPortions`), keyset
// por (fecha, id), totales de toda la celda, la cuenta de las comisiones y el aislamiento por workspace.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const ws = randomUUID();
const otherWs = randomUUID();
const banco = randomUUID();
const tarjeta = randomUUID();
const efectivo = randomUUID();
const usdAcc = randomUUID();
const catSuper = randomUUID();
const catRest = randomUUID();
const catFees = randomUUID();
const catSueldo = randomUUID();
const tag = randomUUID();
const cp = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(id: string, fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId: id }, fn);
let flows: PgNominalFlowQuery;
let portions: PgNominalPortionQuery;

async function save(tx: Transaction, workspace = ws): Promise<Transaction> {
  if (tx.needsEntry) tx.attachEntry(randomUUID());
  await inWs(workspace, () => repo.insert(tx));
  return tx;
}

const record = (
  over: Partial<RecordTransactionInput> & Pick<RecordTransactionInput, 'kind' | 'businessDate' | 'amount'>,
  workspace = ws,
) =>
  Transaction.record({
    id: randomUUID(),
    workspaceId: workspace,
    accountId: banco,
    accountNature: 'ASSET',
    accountCurrency: over.amount.currency.code,
    defaultCategoryId: randomUUID(),
    defaultSplitId: randomUUID(),
    ...over,
  });
const spend = (
  date: string,
  amount: string,
  categoryId: string,
  over: Partial<RecordTransactionInput> = {},
) =>
  record({
    kind: 'EXPENSE',
    businessDate: date,
    amount: bob(amount),
    splits: [{ id: randomUUID(), amount: bob(amount), categoryId }],
    ...over,
  });

const range = { dateFrom: '2026-10-01', dateTo: '2026-10-31' } as const;
const summarize = (over: object = {}) => flows.summarizeNominalFlows({ workspaceId: ws, ...range, ...over });
const sum = (rows: readonly { amount: { amount: string } }[]) =>
  rows.reduce((a, r) => a.add(bob(r.amount.amount)), bob('0.00')).toFixed();

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const unit = new PgTransactionsUnitOfWork(app);
  flows = new PgNominalFlowQuery(unit, pgCurrencyCatalog);
  portions = new PgNominalPortionQuery(unit, pgCurrencyCatalog);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-port-${randomUUID()}`, `port-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const id of [ws, otherWs]) {
    await uow.run({ userId: u1, workspaceId: id }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Port', 'BOB', 'America/La_Paz', 'es-BO')`,
        [id],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, u1],
      );
    });
  }
  // Octubre del scenario "Supermercado": gasto 3500.00, reembolso 200.00; compra repartida; USD; sueldo; tarjeta.
  const base = await save(spend('2026-10-10', '3500.00', catSuper, { counterpartyId: cp }));
  await save(
    record({
      kind: 'REFUND',
      businessDate: '2026-10-12',
      amount: bob('200.00'),
      refundOfTransactionId: base.id,
      splits: [{ id: randomUUID(), amount: bob('200.00'), categoryId: catSuper }],
    }),
  );
  await save(
    spend('2026-10-15', '600.00', catSuper, {
      splits: [
        { id: randomUUID(), amount: bob('400.00'), categoryId: catSuper, tagIds: [tag] },
        { id: randomUUID(), amount: bob('200.00'), categoryId: catRest },
      ],
    }),
  );
  await save(
    record({
      kind: 'EXPENSE',
      businessDate: '2026-10-15',
      accountId: usdAcc,
      accountCurrency: 'USD',
      amount: Money.parse('50.00', USD),
      splits: [{ id: randomUUID(), amount: Money.parse('50.00', USD), categoryId: catRest }],
    }),
  );
  await save(spend('2026-10-18', '500.00', catRest, { accountId: tarjeta, accountNature: 'LIABILITY' }));
  await save(
    record({
      kind: 'INCOME',
      businessDate: '2026-10-05',
      amount: bob('12000.00'),
      splits: [{ id: randomUUID(), amount: bob('12000.00'), categoryId: catSueldo }],
    }),
  );
  // Transferencia con comisión: la porción es la comisión y su cuenta es la de origen.
  await save(
    Transaction.recordTransfer({
      id: randomUUID(),
      workspaceId: ws,
      businessDate: '2026-10-20',
      from: { accountId: efectivo, nature: 'ASSET', currency: 'BOB' },
      to: { accountId: banco, nature: 'ASSET', currency: 'BOB' },
      amount: bob('100.00'),
      fee: { splitId: randomUUID(), amount: bob('2.00'), categoryId: catFees },
    }),
  );
  // Pendiente: no cuenta. Otro workspace: nunca aparece.
  await save(spend('2026-10-21', '300.00', catSuper, { status: 'PENDING' }));
  await save(spend('2026-10-22', '888.00', catSuper), ws);
  await save(
    record(
      {
        kind: 'EXPENSE',
        businessDate: '2026-10-22',
        amount: bob('777.00'),
        splits: [{ id: randomUUID(), amount: bob('777.00'), categoryId: catSuper }],
      },
      otherWs,
    ),
    otherWs,
  );
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('summarizeNominalFlows con filtros y groupBy (aditivo)', () => {
  it('[TC-REPORTING-REPORTS-002] sin filtros ni groupBy conserva la agrupación de siempre (sin accountId ni counterpartyId)', async () => {
    const rows = await summarize();
    expect(rows.every((r) => r.accountId === undefined && r.counterpartyId === undefined)).toBe(true);
    expect(sum(rows.filter((r) => r.nature === 'INCOME'))).toBe('12000.00');
  });

  it('[TC-REPORTING-REPORTS-002] el filtro por cuenta deja el gasto de "Tarjeta Andina" (500.00) y la comisión usa la cuenta de origen', async () => {
    expect(sum(await summarize({ accountIds: [tarjeta] }))).toBe('500.00');
    const fee = await summarize({ accountIds: [efectivo], groupBy: ['ACCOUNT'] });
    expect(fee.map((r) => [r.accountId, r.amount.amount, r.categoryId])).toEqual([
      [efectivo, '2.00', catFees],
    ]);
  });

  it('[TC-REPORTING-REPORTS-002] filtra por moneda, etiqueta (cualquiera) y contraparte', async () => {
    expect(sum(await summarize({ currencies: ['USD'] }))).toBe('50.00');
    const tagged = await summarize({ tagIds: [tag] });
    expect(tagged.map((r) => r.amount.amount)).toEqual(['400.00']);
    expect(sum(await summarize({ counterpartyIds: [cp] }))).toBe('3500.00');
    expect(await summarize({ accountIds: [randomUUID()] })).toEqual([]);
  });

  it('[TC-REPORTING-REPORTS-002] el groupBy ACCOUNT y COUNTERPARTY agrega la dimensión a cada fila', async () => {
    const byAccount = await summarize({ groupBy: ['ACCOUNT'], categoryIds: [catSuper] });
    expect(new Set(byAccount.map((r) => r.accountId))).toEqual(new Set([banco]));
    const byCp = await summarize({ groupBy: ['COUNTERPARTY'], categoryIds: [catSuper] });
    expect(byCp.find((r) => r.counterpartyId === cp)?.amount.amount).toBe('3500.00');
    expect(byCp.some((r) => r.counterpartyId === null)).toBe(true);
  });
});

describe('PgNominalPortionQuery', () => {
  it('[TC-REPORTING-REPORTS-018] "Supermercado" lista el gasto, el reembolso y la porción de 400.00 con la identidad Σ porciones = celda', async () => {
    const cell = await summarize({ categoryIds: [catSuper] });
    const page = await portions.listPortions({
      workspaceId: ws,
      ...range,
      nature: 'EXPENSE',
      categoryIds: [catSuper],
      limit: 50,
    });
    expect(page.rows.map((r) => r.amount.amount).sort()).toEqual(
      ['-200.00', '3500.00', '400.00', '888.00'].sort(),
    );
    expect(page.totals.map((t) => t.amount)).toEqual([sum(cell)]);
    expect(page.count).toBe(page.rows.length);
    expect(sum(page.rows)).toBe(sum(cell));
    expect(page.rows.every((r) => r.transactionId && r.splitId)).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-019] la celda filtrada por cuenta lista solo sus porciones, que suman 500.00', async () => {
    const page = await portions.listPortions({ workspaceId: ws, ...range, accountIds: [tarjeta], limit: 50 });
    expect(page.rows.every((r) => r.accountId === tarjeta)).toBe(true);
    expect(sum(page.rows)).toBe('500.00');
  });

  it('[TC-REPORTING-REPORTS-019] pagina por keyset (fecha desc, id desc) sin repetidos y con los mismos totales en cada página', async () => {
    const seen = new Set<string>();
    const pages: number[] = [];
    let cursor: string | undefined;
    let last: { date: string; id: string } | null = null;
    let totals: string | null = null;
    do {
      const page = await portions.listPortions({
        workspaceId: ws,
        ...range,
        limit: 3,
        ...(cursor ? { cursor } : {}),
      });
      pages.push(page.rows.length);
      for (const r of page.rows) {
        expect(seen.has(r.splitId)).toBe(false);
        seen.add(r.splitId);
        if (last) expect(`${last.date}|${last.id}` > `${r.businessDate}|${r.splitId}`).toBe(true);
        last = { date: r.businessDate, id: r.splitId };
      }
      const t = JSON.stringify(page.totals);
      totals ??= t;
      expect(t).toBe(totals);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(seen.size);
    expect(pages.slice(0, -1).every((n) => n === 3)).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-004] [TC-REPORTING-REPORTS-025] no incluye pendientes ni porciones de otro workspace y rechaza un cursor inválido', async () => {
    const page = await portions.listPortions({ workspaceId: ws, ...range, limit: 200 });
    expect(page.rows.some((r) => r.amount.amount === '300.00' || r.amount.amount === '777.00')).toBe(false);
    await expect(
      portions.listPortions({ workspaceId: ws, ...range, limit: 5, cursor: 'xxx' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const other = await portions.listPortions({ workspaceId: otherWs, ...range, limit: 50 });
    expect(other.rows.map((r) => r.amount.amount)).toEqual(['777.00']);
  });
});
