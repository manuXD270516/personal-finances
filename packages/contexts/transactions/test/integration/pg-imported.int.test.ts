import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { UnitOfWork } from '../../src/application/ports/index.js';
import { Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import {
  PgDuplicateCandidatesQuery,
  PgImportedRefReader,
  PgTransactionStatusQuery,
} from '../../src/infrastructure/pg-imported.js';
import { PgTransactionRepository, pgCurrencyCatalog } from '../../src/infrastructure/pg-transactions.js';

// Contratos de lectura para IMPORTS contra PostgreSQL real (openspec add-basic-csv-import, tarea 4.2): candidatos de
// duplicado set-based (gastos, ingresos y PATAS de transferencias), estados por id y referencias de filas importadas,
// con el índice único parcial `transaction_import_ref_uk` (INV-014) como red de seguridad.
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
let pgUow: PgUnitOfWork;
let u1: string;
const ws = randomUUID();
const other = randomUUID();
const bank = randomUUID();
const visa = randomUUID();
const dollars = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(workspaceId: string, fn: () => Promise<T>) => pgUow.run({ userId: u1, workspaceId }, fn);
const uow: UnitOfWork = { run: (workspaceId, fn) => inWs(workspaceId, fn) };

const candidates = new PgDuplicateCandidatesQuery(uow, pgCurrencyCatalog);
const statuses = new PgTransactionStatusQuery(uow);
const refs = new PgImportedRefReader();

const expense = (over: Partial<RecordTransactionInput> = {}) => {
  const tx = Transaction.record({
    id: randomUUID(),
    workspaceId: ws,
    kind: 'EXPENSE',
    businessDate: '2026-10-02',
    accountId: bank,
    accountNature: 'ASSET',
    accountCurrency: 'BOB',
    amount: bob('245.30'),
    description: 'Supermercado',
    defaultCategoryId: randomUUID(),
    defaultSplitId: randomUUID(),
    ...over,
  });
  tx.attachEntry(randomUUID());
  return tx;
};

const insert = async (tx: Transaction) => {
  await inWs(tx.snapshot.workspaceId, () => repo.insert(tx));
  return tx.id;
};

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const find = (
  rows: { rowRef: string; date: string; direction: 'IN' | 'OUT'; amount: string }[],
  window = 3,
) =>
  candidates.findForImport({
    workspaceId: ws,
    accountId: bank,
    windowDays: window,
    rows: rows.map((r) => ({ ...r, amount: { amount: r.amount, currency: 'BOB' } })),
  });
const idsOf = (result: Awaited<ReturnType<typeof find>>, rowRef: string) =>
  result.find((r) => r.rowRef === rowRef)?.candidates.map((c) => c.transactionId) ?? [];

let manualExpense: string;
let manualIncome: string;
let transferOut: string;
let transferIn: string;
let voidedExpense: string;

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  pgUow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-imp-${randomUUID()}`, `imp-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const id of [ws, other]) {
    await pgUow.run({ userId: u1, workspaceId: id }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Imp', 'BOB', 'America/La_Paz', 'es-BO')`,
        [id],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, u1],
      );
    });
  }
  manualExpense = await insert(expense());
  manualIncome = await insert(
    expense({ kind: 'INCOME', amount: bob('8000.00'), businessDate: '2026-10-05', description: 'Sueldo' }),
  );
  const transfer = Transaction.recordTransfer({
    id: randomUUID(),
    workspaceId: ws,
    businessDate: '2026-10-10',
    from: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
    to: { accountId: visa, nature: 'LIABILITY', currency: 'BOB' },
    amount: bob('400.00'),
  });
  transfer.attachEntry(randomUUID());
  transferOut = await insert(transfer);
  // Transferencia entrante a Banco desde Visa (pata TARGET positiva sobre la cuenta).
  const incoming = Transaction.recordTransfer({
    id: randomUUID(),
    workspaceId: ws,
    businessDate: '2026-10-20',
    from: { accountId: visa, nature: 'LIABILITY', currency: 'BOB' },
    to: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
    amount: bob('75.00'),
  });
  incoming.attachEntry(randomUUID());
  transferIn = await insert(incoming);
  const toVoid = expense({ amount: bob('99.00'), businessDate: '2026-10-12', description: 'Se anula' });
  voidedExpense = await insert(toVoid);
  await inWs(ws, async () => {
    await requireSqlExecutor().query(
      `UPDATE txn.transaction SET status = 'VOIDED', voided_at = now(), active_entry_id = NULL, void_reason = 'x' WHERE id = $1`,
      [voidedExpense],
    );
  });
  // Ruido: otra moneda, otra cuenta y otro workspace con el mismo monto.
  await insert(
    expense({
      accountId: dollars,
      accountCurrency: 'USD',
      amount: Money.parse('245.30', USD),
      description: 'USD',
    }),
  );
  await insert(expense({ accountId: visa, accountNature: 'LIABILITY', description: 'Otra cuenta' }));
  await insert(expense({ workspaceId: other, description: 'Otro workspace' }));
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('DuplicateCandidatesQuery.findForImport (PostgreSQL real)', () => {
  it('[TC-IMPORTS-CSV-020] encuentra el gasto manual del mismo monto, dirección y ±3 días, con su descripción', async () => {
    const result = await find([{ rowRef: 'r1', date: '2026-10-01', direction: 'OUT', amount: '245.30' }]);
    expect(idsOf(result, 'r1')).toEqual([manualExpense]);
    expect(result[0]?.candidates[0]).toMatchObject({
      kind: 'EXPENSE',
      status: 'POSTED',
      date: '2026-10-02',
      description: 'Supermercado',
      amount: { amount: '245.30', currency: 'BOB' },
    });
  });

  it('[TC-IMPORTS-CSV-020] las patas de una transferencia son candidatas: la saliente como salida y la entrante como entrada', async () => {
    const out = await find([{ rowRef: 'out', date: '2026-10-10', direction: 'OUT', amount: '400.00' }]);
    expect(idsOf(out, 'out')).toEqual([transferOut]);
    expect(out[0]?.candidates[0]?.kind).toBe('TRANSFER');
    const incoming = await find([{ rowRef: 'in', date: '2026-10-19', direction: 'IN', amount: '75.00' }]);
    expect(idsOf(incoming, 'in')).toEqual([transferIn]);
    // Una entrada de 400 NO coincide con la salida de la transferencia (la dirección importa).
    const wrongWay = await find([{ rowRef: 'x', date: '2026-10-10', direction: 'IN', amount: '400.00' }]);
    expect(idsOf(wrongWay, 'x')).toEqual([]);
  });

  it('respeta la dirección, la ventana de días y excluye anuladas, otras monedas, otras cuentas y otros workspaces', async () => {
    const rows = [
      { rowRef: 'inside', date: '2026-10-05', direction: 'OUT' as const, amount: '245.30' }, // Δ 3 días: dentro
      { rowRef: 'outside', date: '2026-10-06', direction: 'OUT' as const, amount: '245.30' }, // Δ 4 días: fuera
      { rowRef: 'wrong-direction', date: '2026-10-02', direction: 'IN' as const, amount: '245.30' },
      { rowRef: 'income', date: '2026-10-04', direction: 'IN' as const, amount: '8000.00' },
      { rowRef: 'voided', date: '2026-10-12', direction: 'OUT' as const, amount: '99.00' },
      { rowRef: 'none', date: '2026-10-02', direction: 'OUT' as const, amount: '245.31' },
    ];
    const result = await find(rows);
    expect(idsOf(result, 'inside')).toEqual([manualExpense]);
    expect(idsOf(result, 'outside')).toEqual([]);
    expect(idsOf(result, 'wrong-direction')).toEqual([]);
    expect(idsOf(result, 'income')).toEqual([manualIncome]);
    expect(idsOf(result, 'voided')).toEqual([]);
    expect(idsOf(result, 'none')).toEqual([]);
    expect(result.map((r) => r.rowRef)).toEqual(rows.map((r) => r.rowRef));
  });

  it('una ventana de 0 días exige la misma fecha y excludeTransactionIds descarta candidatos', async () => {
    const same = await find([{ rowRef: 'r', date: '2026-10-02', direction: 'OUT', amount: '245.30' }], 0);
    expect(idsOf(same, 'r')).toEqual([manualExpense]);
    const near = await find([{ rowRef: 'r', date: '2026-10-03', direction: 'OUT', amount: '245.30' }], 0);
    expect(idsOf(near, 'r')).toEqual([]);
    const excluded = await candidates.findForImport({
      workspaceId: ws,
      accountId: bank,
      windowDays: 3,
      excludeTransactionIds: [manualExpense],
      rows: [
        { rowRef: 'r', date: '2026-10-02', direction: 'OUT', amount: { amount: '245.30', currency: 'BOB' } },
      ],
    });
    expect(idsOf(excluded, 'r')).toEqual([]);
  });

  it('sin filas devuelve vacío y varias filas se resuelven en una sola consulta', async () => {
    expect(await find([])).toEqual([]);
    const many = Array.from({ length: 300 }, (_, i) => ({
      rowRef: `m${i}`,
      date: '2026-10-02',
      direction: 'OUT' as const,
      amount: i === 299 ? '245.30' : `${i + 1}.00`,
    }));
    const result = await find(many);
    expect(result).toHaveLength(300);
    expect(idsOf(result, 'm299')).toEqual([manualExpense]);
  });
});

describe('TransactionStatusQuery y referencias de filas importadas (PostgreSQL real)', () => {
  it('statusOf devuelve el estado actual y ignora ids ajenos al workspace', async () => {
    const result = await statuses.statusOf({
      workspaceId: ws,
      transactionIds: [manualExpense, voidedExpense, randomUUID()],
    });
    expect(Object.fromEntries(result.map((r) => [r.transactionId, r.status]))).toEqual({
      [manualExpense]: 'POSTED',
      [voidedExpense]: 'VOIDED',
    });
    expect(await statuses.statusOf({ workspaceId: ws, transactionIds: [] })).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-016] existingByRefs encuentra las referencias vivas de la cuenta; el índice único impide un segundo registro activo', async () => {
    const fp = 'ab'.repeat(32);
    const imported = expense({
      source: 'IMPORT',
      externalRef: { namespace: 'imports.csv-row', id: fp },
      importJobId: randomUUID(),
      amount: bob('18.00'),
      description: 'CAFE',
    });
    await insert(imported);
    const found = await inWs(ws, () =>
      refs.existingByRefs({
        workspaceId: ws,
        accountId: bank,
        namespace: 'imports.csv-row',
        ids: [fp, 'cd'.repeat(32)],
      }),
    );
    expect([...found]).toEqual([[fp, imported.id]]);
    // Otra cuenta no la ve.
    expect(
      (
        await inWs(ws, () =>
          refs.existingByRefs({ workspaceId: ws, accountId: visa, namespace: 'imports.csv-row', ids: [fp] }),
        )
      ).size,
    ).toBe(0);

    const duplicate = expense({
      source: 'IMPORT',
      externalRef: { namespace: 'imports.csv-row', id: fp },
      importJobId: randomUUID(),
      amount: bob('18.00'),
    });
    expect(await pgError(insert(duplicate))).toBe('23505');

    // Anulada, la referencia queda libre (misma huella: el usuario anuló y vuelve a importar).
    await inWs(ws, async () => {
      await requireSqlExecutor().query(
        `UPDATE txn.transaction SET status = 'VOIDED', voided_at = now(), active_entry_id = NULL, void_reason = 'x' WHERE id = $1`,
        [imported.id],
      );
    });
    expect(
      (
        await inWs(ws, () =>
          refs.existingByRefs({ workspaceId: ws, accountId: bank, namespace: 'imports.csv-row', ids: [fp] }),
        )
      ).size,
    ).toBe(0);
    await insert(
      expense({
        source: 'IMPORT',
        externalRef: { namespace: 'imports.csv-row', id: fp },
        importJobId: randomUUID(),
        amount: bob('18.00'),
      }),
    );
  });

  it('la columna import_job_id se guarda y se rehidrata; las manuales quedan en NULL', async () => {
    const job = randomUUID();
    const tx = expense({
      source: 'IMPORT',
      externalRef: { namespace: 'imports.csv-row', id: 'ef'.repeat(32) },
      importJobId: job,
    });
    await insert(tx);
    const loaded = (await inWs(ws, () => repo.findById(ws, tx.id)))!;
    expect(loaded.snapshot.importJobId).toBe(job);
    expect(loaded.snapshot.source).toBe('IMPORT');
    const manual = (await inWs(ws, () => repo.findById(ws, manualExpense)))!;
    expect(manual.snapshot.importJobId).toBeNull();
  });
});

describe('Puntaje de duplicados e identificador del banco (PostgreSQL real, add-import-pipeline)', () => {
  const scored = (
    rows: {
      rowRef: string;
      date: string;
      description: string | null;
      amount: string;
      externalId?: string | null;
      counterpartyId?: string | null;
    }[],
  ) =>
    candidates.findForImport({
      workspaceId: ws,
      accountId: bank,
      windowDays: 3,
      rows: rows.map((r) => ({
        rowRef: r.rowRef,
        date: r.date,
        direction: 'OUT' as const,
        amount: { amount: r.amount, currency: 'BOB' },
        description: r.description,
        ...(r.externalId !== undefined ? { externalId: r.externalId } : {}),
        ...(r.counterpartyId !== undefined ? { counterpartyId: r.counterpartyId } : {}),
      })),
    });

  it('[TC-TRANSACTIONS-DEDUPE-001] el gasto manual del día siguiente con la misma descripción puntúa 0.9000 con sus señales', async () => {
    const result = await scored([
      { rowRef: 's1', date: '2026-10-01', description: 'SUPERMERCADO', amount: '245.30' },
    ]);
    const candidate = result[0]?.candidates.find((c) => c.transactionId === manualExpense);
    expect(candidate?.transactionId).toBe(manualExpense);
    expect(candidate?.score).toBe('0.9000');
    expect(candidate?.signals).toEqual({
      amount: '1.0000',
      date: '0.8000',
      description: '1.0000',
      counterparty: '0.5000',
      origin: '1.0000',
    });
    expect(candidate?.hasBankExternalRef).toBe(false);
  });

  it('[TC-TRANSACTIONS-DEDUPE-002] un candidato con otro identificador del banco puntúa 0.8500 y se marca hasBankExternalRef', async () => {
    const bankTx = expense({
      amount: bob('310.10'),
      businessDate: '2026-10-02',
      description: 'Supermercado',
      source: 'IMPORT',
      externalRef: { namespace: 'imports.ext:OFX', id: 'FIT-A' },
      importJobId: randomUUID(),
    });
    const id = await insert(bankTx);
    const result = await scored([
      {
        rowRef: 's2',
        date: '2026-10-01',
        description: 'SUPERMERCADO',
        amount: '310.10',
        externalId: 'FIT-B',
      },
      {
        rowRef: 's3',
        date: '2026-10-01',
        description: 'SUPERMERCADO',
        amount: '310.10',
        externalId: 'FIT-A',
      },
    ]);
    expect(result[0]?.candidates[0]).toMatchObject({
      transactionId: id,
      score: '0.8500',
      hasBankExternalRef: true,
    });
    expect(result[1]?.candidates[0]?.score).toBe('0.9000');
  });

  it('[TC-TRANSACTIONS-DEDUPE-003] dos candidatos se ordenan por puntaje, días e id, y el orden se repite', async () => {
    const near = await insert(
      expense({ amount: bob('77.70'), businessDate: '2026-10-02', description: 'Farmacia Demo' }),
    );
    const far = await insert(
      expense({ amount: bob('77.70'), businessDate: '2026-10-03', description: 'Farmacia Demo' }),
    );
    const rows = [{ rowRef: 'f', date: '2026-10-01', description: 'FARMACIA DEMO', amount: '77.70' }];
    const first = await scored(rows);
    expect(first[0]?.candidates.map((c) => c.transactionId)).toEqual([near, far]);
    expect(first[0]?.candidates.map((c) => c.score)).toEqual(['0.9000', '0.8250']);
    expect((await scored(rows))[0]?.candidates.map((c) => c.transactionId)).toEqual([near, far]);
  });

  it('[TC-TRANSACTIONS-DEDUPE-008] a 3 días sin similitud ni identificador el candidato puntúa 0.5750', async () => {
    const id = await insert(
      expense({ amount: bob('412.55'), businessDate: '2026-10-04', description: 'qqq' }),
    );
    const result = await scored([
      { rowRef: 'low', date: '2026-10-01', description: 'zzzz', amount: '412.55' },
    ]);
    expect(result[0]?.candidates[0]).toMatchObject({ transactionId: id, score: '0.5750' });
  });
});

describe('Índice único por identificador del banco imports.ext:* (PostgreSQL real, add-import-pipeline)', () => {
  const ofx = (id: string, over: Partial<RecordTransactionInput> = {}) =>
    expense({
      source: 'IMPORT',
      externalRef: { namespace: 'imports.ext:OFX', id },
      importJobId: randomUUID(),
      amount: bob('50.00'),
      description: 'MOV',
      ...over,
    });

  it('[TC-TRANSACTIONS-DEDUPE-004] dos importaciones simultáneas con el mismo identificador dejan una sola transacción viva', async () => {
    const results = await Promise.allSettled([insert(ofx('2026030100017')), insert(ofx('2026030100017'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code?: string }).code).toBe('23505');
    const found = await inWs(ws, () =>
      refs.existingByRefs({
        workspaceId: ws,
        accountId: bank,
        namespace: 'imports.ext:OFX',
        ids: ['2026030100017'],
      }),
    );
    expect(found.size).toBe(1);
  });

  it('[TC-TRANSACTIONS-DEDUPE-004] el mismo identificador en otra cuenta o en otro formato es otra referencia', async () => {
    const id = 'FIT-multi';
    await insert(ofx(id));
    await insert(ofx(id, { accountId: visa, accountNature: 'LIABILITY' }));
    await insert(ofx(id, { externalRef: { namespace: 'imports.ext:QIF', id } }));
    expect(await pgError(insert(ofx(id)))).toBe('23505');
  });

  it('[TC-TRANSACTIONS-DEDUPE-005] anular la transacción libera el identificador para un import posterior', async () => {
    const id = 'FIT-liberada';
    const first = ofx(id);
    await insert(first);
    expect(await pgError(insert(ofx(id)))).toBe('23505');
    await inWs(ws, async () => {
      await requireSqlExecutor().query(
        `UPDATE txn.transaction SET status = 'VOIDED', voided_at = now(), active_entry_id = NULL, void_reason = 'x' WHERE id = $1`,
        [first.id],
      );
    });
    const second = ofx(id);
    await insert(second);
    const found = await inWs(ws, () =>
      refs.existingByRefs({ workspaceId: ws, accountId: bank, namespace: 'imports.ext:OFX', ids: [id] }),
    );
    expect([...found]).toEqual([[id, second.id]]);
  });

  it('existingByRefs también ve una transferencia importada por la pata de la cuenta que no es la principal', async () => {
    const incoming = Transaction.recordTransfer({
      id: randomUUID(),
      workspaceId: ws,
      businessDate: '2026-10-21',
      from: { accountId: visa, nature: 'LIABILITY', currency: 'BOB' },
      to: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
      amount: bob('12.00'),
      source: 'IMPORT',
      externalRef: { namespace: 'imports.ext:OFX', id: 'FIT-transfer' },
      importJobId: randomUUID(),
    });
    incoming.attachEntry(randomUUID());
    await insert(incoming);
    const found = await inWs(ws, () =>
      refs.existingByRefs({
        workspaceId: ws,
        accountId: bank,
        namespace: 'imports.ext:OFX',
        ids: ['FIT-transfer'],
      }),
    );
    expect([...found]).toEqual([['FIT-transfer', incoming.id]]);
  });
});
