import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money, Rate } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { displayOrientation, Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import { PgAccountMovementsQuery } from '../../src/infrastructure/pg-account-movements.js';
import {
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
} from '../../src/infrastructure/pg-transactions.js';

// AccountMovementsQuery en PostgreSQL real (openspec add-credit-cards, decisión 12): ciclo de octubre de "Visa Oro BOB"
// (TC-DEBT-CARD-009), pendiente que no cuenta (-010), conversión hacia la tarjeta en USD (-016), anuladas y revisiones.
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
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const ws = randomUUID();
const otherWs = randomUUID();
const card = randomUUID();
const cardUsd = randomUUID();
const bank = randomUUID();
const interestCategory = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId: ws }, fn);
let query: PgAccountMovementsQuery;

const range = { dateFrom: '2026-09-26', dateTo: '2026-10-25' } as const;
const summarize = (accountIds: string[], groupBy: 'DAY' | 'TRANSACTION' = 'DAY', over: object = {}) =>
  query.summarizeAccountMovements({ workspaceId: ws, accountIds, ...range, groupBy, ...over });

async function save(tx: Transaction): Promise<Transaction> {
  if (tx.needsEntry) tx.attachEntry(randomUUID());
  await inWs(() => repo.insert(tx));
  return tx;
}

const onCard = (
  over: Partial<RecordTransactionInput> & Pick<RecordTransactionInput, 'kind' | 'businessDate' | 'amount'>,
) =>
  Transaction.record({
    id: randomUUID(),
    workspaceId: ws,
    accountId: card,
    accountNature: 'LIABILITY',
    accountCurrency: 'BOB',
    defaultCategoryId: randomUUID(),
    defaultSplitId: randomUUID(),
    ...over,
  });

const transferToCard = (businessDate: string, amount: string) =>
  Transaction.recordTransfer({
    id: randomUUID(),
    workspaceId: ws,
    businessDate,
    from: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
    to: { accountId: card, nature: 'LIABILITY', currency: 'BOB' },
    amount: bob(amount),
    fee: null,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  query = new PgAccountMovementsQuery(
    new PgTransactionsUnitOfWork(app),
    pgCurrencyCatalog,
    async () => new Map([[interestCategory, 'INTEREST']]),
  );
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-mov-${randomUUID()}`, `mov-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const id of [ws, otherWs]) {
    await uow.run({ userId: u1, workspaceId: id }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Mov', 'BOB', 'America/La_Paz', 'es-BO')`,
        [id],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, u1],
      );
    });
  }
  // Ciclo de octubre de "Visa Oro BOB" (TC-DEBT-CARD-009).
  await save(transferToCard('2026-10-10', '1200.00'));
  await save(onCard({ kind: 'EXPENSE', businessDate: '2026-10-03', amount: bob('350.00') }));
  await save(
    onCard({
      kind: 'EXPENSE',
      businessDate: '2026-10-18',
      amount: bob('820.50'),
      splits: [
        { id: randomUUID(), amount: bob('800.00'), categoryId: randomUUID() },
        { id: randomUUID(), amount: bob('20.50'), categoryId: interestCategory },
      ],
    }),
  );
  await save(onCard({ kind: 'REFUND', businessDate: '2026-10-20', amount: bob('50.00') }));
  await save(onCard({ kind: 'EXPENSE', businessDate: '2026-10-26', amount: bob('400.00') }));
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

const sum = (rows: readonly { amount: { amount: string } }[]) =>
  rows.reduce((a, r) => a.add(bob(r.amount.amount)), bob('0.00')).toFixed();
const ofClass = (rows: readonly { movementClass: string; amount: { amount: string } }[], c: string) =>
  sum(rows.filter((r) => r.movementClass === c));

describe('PgAccountMovementsQuery', () => {
  it('[TC-DEBT-CARD-009] ciclo de octubre: clases por día y Σ = variación del saldo presentado (1200.00 a 1120.50)', async () => {
    const rows = await summarize([card]);
    expect(ofClass(rows, 'PURCHASE')).toBe('1170.50');
    expect(ofClass(rows, 'REFUND')).toBe('-50.00');
    expect(ofClass(rows, 'PAYMENT')).toBe('-1200.00');
    expect(ofClass(rows, 'OTHER')).toBe('0.00');
    // La compra del 2026-10-26 queda fuera del rango y pertenece al ciclo siguiente.
    expect(rows.map((r) => r.businessDate)).not.toContain('2026-10-26');
    expect(
      bob('1200.00')
        .add(bob(sum(rows)))
        .toFixed(),
    ).toBe('1120.50');
    expect(rows.every((r) => r.transactionId === null && r.amount.currency === 'BOB')).toBe(true);
    // Agrupa por (fecha, clase, categoría de sistema): el interés de 20.50 queda en su propia fila.
    expect(
      rows
        .filter((r) => r.businessDate === '2026-10-18')
        .map((r) => [r.systemCategoryCode, r.amount.amount])
        .sort(),
    ).toEqual([
      [null, '800.00'],
      ['INTEREST', '20.50'],
    ]);
  });

  it('[TC-DEBT-CARD-009] groupBy TRANSACTION: una fila por transacción y clase', async () => {
    const rows = await summarize([card], 'TRANSACTION');
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.transactionId !== null)).toBe(true);
    expect(sum(rows)).toBe('-79.50');
  });

  it('[TC-DEBT-CARD-010] una compra PENDING no cuenta en el ciclo', async () => {
    await save(
      onCard({ kind: 'EXPENSE', businessDate: '2026-10-22', amount: bob('75.00'), status: 'PENDING' }),
    );
    const rows = await summarize([card]);
    expect(ofClass(rows, 'PURCHASE')).toBe('1170.50');
    expect(
      bob('1200.00')
        .add(bob(sum(rows)))
        .toFixed(),
    ).toBe('1120.50');
  });

  it('una transacción anulada (VOIDED) no cuenta', async () => {
    const tx = await save(onCard({ kind: 'EXPENSE', businessDate: '2026-10-05', amount: bob('33.00') }));
    expect(ofClass(await summarize([card]), 'PURCHASE')).toBe('1203.50');
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!;
    loaded.void('error de carga', new Date().toISOString());
    expect(await inWs(() => repo.update(loaded))).toBe(true);
    expect(ofClass(await summarize([card]), 'PURCHASE')).toBe('1170.50');
  });

  it('una revisión cuenta solo con su asiento vigente', async () => {
    const tx = await save(onCard({ kind: 'EXPENSE', businessDate: '2026-10-06', amount: bob('100.00') }));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!;
    if (loaded.amend({ amount: bob('120.00') }).ledgerImpact) loaded.attachEntry(randomUUID());
    expect(await inWs(() => repo.update(loaded))).toBe(true);
    expect(ofClass(await summarize([card]), 'PURCHASE')).toBe('1290.50');
    // Con la fecha movida fuera del rango la revisión previa no deja residuos.
    const again = (await inWs(() => repo.findById(ws, tx.id)))!;
    if (again.amend({ businessDate: '2026-11-02' }).ledgerImpact) again.attachEntry(randomUUID());
    expect(await inWs(() => repo.update(again))).toBe(true);
    expect(ofClass(await summarize([card]), 'PURCHASE')).toBe('1170.50');
  });

  it('un ajuste a la tarjeta es OTHER con signo (aumento de deuda positivo)', async () => {
    await save(
      onCard({
        kind: 'ADJUSTMENT',
        businessDate: '2026-10-07',
        amount: bob('15.00'),
        direction: 'INCREASE',
        reason: 'ajuste de prueba',
      }),
    );
    expect(ofClass(await summarize([card]), 'OTHER')).toBe('15.00');
  });

  it('[TC-DEBT-CARD-016] la conversión de 980 BOB a 100 USD hacia la tarjeta USD es PAYMENT', async () => {
    const conv = Transaction.recordConversion({
      id: randomUUID(),
      workspaceId: ws,
      businessDate: '2026-10-12',
      sourceAccount: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
      targetAccount: { accountId: cardUsd, nature: 'LIABILITY', currency: 'USD' },
      sourceAmount: bob('980.00'),
      targetAmount: usd('100.00'),
      fees: [],
      quotedRate: Rate.of(USD, BOB, '9.8'),
      referenceRate: null,
      display: displayOrientation({ currency: BOB, kind: 'FIAT' }, { currency: USD, kind: 'FIAT' }),
      provider: { counterpartyId: null, name: null },
      executedAt: '2026-10-12T15:00:00Z',
      externalRef: null,
    });
    await save(conv);
    const rows = await summarize([cardUsd]);
    expect(rows.map((r) => [r.movementClass, r.amount.amount, r.amount.currency])).toEqual([
      ['PAYMENT', '-100.00', 'USD'],
    ]);
    // La pata de salida de la cuenta bancaria es PURCHASE (sale de la cuenta) y no se mezcla con la tarjeta.
    const bankRows = await summarize([bank], 'DAY', { dateFrom: '2026-10-12', dateTo: '2026-10-12' });
    expect(bankRows.map((r) => r.movementClass)).toContain('PURCHASE');
  });

  it('aísla por workspace (RLS) y sin cuentas devuelve vacío', async () => {
    const rows = await query.summarizeAccountMovements({
      workspaceId: otherWs,
      accountIds: [card],
      ...range,
      groupBy: 'DAY',
    });
    expect(rows).toEqual([]);
    expect(await summarize([])).toEqual([]);
  });
});
