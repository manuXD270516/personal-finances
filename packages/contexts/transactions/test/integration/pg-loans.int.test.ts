import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LoanPaymentBreakdown, Transaction, toJournalEntryDraft } from '../../src/domain/index.js';
import { PgNominalFlowQuery } from '../../src/infrastructure/pg-nominal-flows.js';
import {
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
} from '../../src/infrastructure/pg-transactions.js';

// Transacciones de préstamo en PostgreSQL real (openspec add-loans, extensión de TRANSACTIONS): kinds y desglose
// persistidos y rehidratados, CHECKs de coherencia, `txn.assert_splits_sum()` ampliado (INV-021), unicidad por
// `externalRef`, listado por tipo y flujos nominales (el principal no es gasto, TC-DEBT-LOAN-019).
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
const ws = randomUUID();
const bank = randomUUID();
const loanAccount = randomUUID();
const loanId = randomUUID();
const interestCategory = randomUUID();
const feesCategory = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId: ws }, fn);

async function pgError(p: Promise<unknown>): Promise<{ code?: string; constraint?: string } | undefined> {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; constraint?: string };
  }
  return undefined;
}

const breakdown = (
  over: Partial<Record<'principal' | 'interest' | 'fees' | 'insurance' | 'taxes', string>> = {},
) =>
  LoanPaymentBreakdown.create({
    loanId,
    principal: bob(over.principal ?? '1862.85'),
    interest: bob(over.interest ?? '479.17'),
    fees: bob(over.fees ?? '0.00'),
    insurance: bob(over.insurance ?? '0.00'),
    taxes: bob(over.taxes ?? '0.00'),
  });

const payment = (date = '2026-11-15', b = breakdown(), paymentId = randomUUID()) => {
  const tx = Transaction.recordLoanPayment({
    id: randomUUID(),
    workspaceId: ws,
    businessDate: date,
    paymentAccount: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
    loanAccount: { accountId: loanAccount, nature: 'LIABILITY', currency: 'BOB' },
    amount: b.total(),
    breakdown: b,
    categoryIds: {
      interest: interestCategory,
      fees: feesCategory,
      insurance: randomUUID(),
      taxes: randomUUID(),
    },
    newSplitId: randomUUID,
    description: 'Cuota 1',
    externalRef: { namespace: 'debt.loan-payment', id: paymentId },
  });
  tx.attachEntry(randomUUID());
  return tx;
};

const disbursement = (fee?: string, id = loanId) => {
  const tx = Transaction.recordLoanDisbursement({
    id: randomUUID(),
    workspaceId: ws,
    businessDate: '2026-10-15',
    loanAccount: { accountId: loanAccount, nature: 'LIABILITY', currency: 'BOB' },
    destinationAccount: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
    principal: bob('50000.00'),
    ...(fee ? { retainedFee: { amount: bob(fee), categoryId: feesCategory, splitId: randomUUID() } } : {}),
    description: 'Desembolso',
    externalRef: { namespace: 'debt.loan', id },
  });
  tx.attachEntry(randomUUID());
  return tx;
};

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn-loans', $1, $2, 'U1') AS id`,
    [`sub-loans-${randomUUID()}`, `loans-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  await inWs(async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Loans', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, u1],
    );
  });
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgTransactionRepository — transacciones de préstamo', () => {
  it('[TC-DEBT-LOAN-012] round-trip del pago: legs SOURCE/TARGET, split de interés y desglose jsonb', async () => {
    const tx = payment();
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!.snapshot;
    expect(loaded).toMatchObject({ kind: 'LOAN_PAYMENT', source: 'DEBT', accountId: bank });
    expect(loaded.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', bank, '-2342.02'],
      ['TARGET', loanAccount, '1862.85'],
    ]);
    expect(loaded.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([
      [interestCategory, '479.17'],
    ]);
    expect(loaded.loanPaymentBreakdown?.toJson()).toEqual({
      loanId,
      principal: '1862.85',
      interest: '479.17',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
    });
    // El asiento cuadra por moneda (INV-004): Σ postings = 0.
    expect(
      Money.sum(
        toJournalEntryDraft(loaded).postings.map((p) => p.amount),
        BOB,
      ).isZero(),
    ).toBe(true);
  });

  it('[TC-DEBT-LOAN-008] desembolso con comisión retenida: Σ splits = comisión; el loanId sale del externalRef', async () => {
    const id = randomUUID();
    const tx = disbursement('500.00', id);
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findByExternalRef(ws, { namespace: 'debt.loan', id })))!.snapshot;
    expect(loaded.kind).toBe('LOAN_DISBURSEMENT');
    expect(loaded.legs.map((l) => [l.role, l.amount.toFixed()])).toEqual([
      ['SOURCE', '-50000.00'],
      ['TARGET', '49500.00'],
    ]);
    expect(loaded.splits.map((s) => s.amount.toFixed())).toEqual(['500.00']);
    expect(loaded.loanPaymentBreakdown).toBeNull();
  });

  it('[TC-DEBT-LOAN-007] desembolso sin comisión (sin splits) es válido', async () => {
    const tx = disbursement(undefined, randomUUID());
    await inWs(() => repo.insert(tx));
    expect((await inWs(() => repo.findById(ws, tx.id)))!.snapshot.splits).toEqual([]);
  });

  it('principal 0 (solo cargos): sin pata TARGET; el trigger espera Σ splits = monto − 0', async () => {
    const tx = payment('2026-11-20', breakdown({ principal: '0.00', interest: '100.00' }));
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!.snapshot;
    expect(loaded.legs.map((l) => l.role)).toEqual(['SOURCE']);
  });

  it('[TC-DEBT-LOAN-012] INV-021 ampliado: Σ splits ≠ monto − principal ⇒ el trigger diferido rechaza al COMMIT', async () => {
    const tx = payment();
    const err = await pgError(
      inWs(async () => {
        await repo.insert(tx);
        await requireSqlExecutor().query(
          `UPDATE txn.transaction_split SET amount = amount + 0.01 WHERE transaction_id = $1`,
          [tx.id],
        );
      }),
    );
    expect(err?.code).toBe('23514');
    expect(err?.constraint).toBe('transaction_splits_sum_ck');
  });

  it('el trigger rechaza un desembolso cuya comisión no coincide con monto − neto recibido', async () => {
    const tx = disbursement('500.00', randomUUID());
    const err = await pgError(
      inWs(async () => {
        await repo.insert(tx);
        await requireSqlExecutor().query(
          `UPDATE txn.transaction_leg SET amount = 49000.00 WHERE transaction_id = $1 AND role = 'TARGET'`,
          [tx.id],
        );
      }),
    );
    expect(err?.constraint).toBe('transaction_splits_sum_ck');
  });

  it('los demás kinds conservan su regla: un gasto con splits que no suman sigue rechazado', async () => {
    const tx = Transaction.record({
      id: randomUUID(),
      workspaceId: ws,
      kind: 'EXPENSE',
      businessDate: '2026-11-01',
      accountId: bank,
      accountNature: 'ASSET',
      accountCurrency: 'BOB',
      amount: bob('10.00'),
      defaultCategoryId: interestCategory,
      defaultSplitId: randomUUID(),
    });
    tx.attachEntry(randomUUID());
    const err = await pgError(
      inWs(async () => {
        await repo.insert(tx);
        await requireSqlExecutor().query(
          `UPDATE txn.transaction_split SET amount = 9.99 WHERE transaction_id = $1`,
          [tx.id],
        );
      }),
    );
    expect(err?.constraint).toBe('transaction_splits_sum_ck');
  });

  it('CHECKs: un kind de préstamo exige source DEBT, su externalRef y (solo el pago) el desglose', async () => {
    const insertRaw = (kind: string, source: string, ns: string | null, breakdownJson: string | null) =>
      pgError(
        inWs(async () => {
          await requireSqlExecutor().query(
            `INSERT INTO txn.transaction (id, workspace_id, kind, status, transaction_date, account_id, amount, currency,
                                          source, external_ref_namespace, external_ref_id, loan_payment_breakdown)
             VALUES ($1, $2, $3, 'PENDING', '2026-11-01', $4, 10, 'BOB', $5, $6, $7, $8::jsonb)`,
            [randomUUID(), ws, kind, bank, source, ns, ns ? randomUUID() : null, breakdownJson],
          );
        }),
      );
    const json = JSON.stringify(breakdown().toJson());
    expect((await insertRaw('LOAN_PAYMENT', 'MANUAL', 'debt.loan-payment', json))?.constraint).toBe(
      'transaction_loan_source_ck',
    );
    expect((await insertRaw('LOAN_PAYMENT', 'DEBT', null, json))?.constraint).toBe(
      'transaction_loan_external_ref_ck',
    );
    expect((await insertRaw('LOAN_DISBURSEMENT', 'DEBT', 'debt.loan-payment', null))?.constraint).toBe(
      'transaction_loan_external_ref_ck',
    );
    expect((await insertRaw('LOAN_PAYMENT', 'DEBT', 'debt.loan-payment', null))?.constraint).toBe(
      'transaction_loan_breakdown_ck',
    );
    expect((await insertRaw('EXPENSE', 'MANUAL', null, json))?.constraint).toBe(
      'transaction_loan_breakdown_ck',
    );
    expect((await insertRaw('LOAN_REFINANCE', 'DEBT', 'debt.loan', null))?.constraint).toBe(
      'transaction_kind_check',
    );
  });

  it('el índice único parcial impide dos transacciones vigentes con la misma referencia; una anulada libera la referencia', async () => {
    const paymentId = randomUUID();
    const first = payment('2026-12-01', breakdown(), paymentId);
    await inWs(() => repo.insert(first));
    const dup = await pgError(inWs(() => repo.insert(payment('2026-12-01', breakdown(), paymentId))));
    expect(dup?.code).toBe('23505');
    const found = await inWs(() =>
      repo.findByExternalRef(ws, { namespace: 'debt.loan-payment', id: paymentId }),
    );
    expect(found?.id).toBe(first.id);
    const loadedFirst = (await inWs(() => repo.findById(ws, first.id)))!;
    loadedFirst.void('anulado', '2026-12-02T00:00:00Z');
    expect(await inWs(() => repo.update(loadedFirst))).toBe(true);
    expect(
      await inWs(() => repo.findByExternalRef(ws, { namespace: 'debt.loan-payment', id: paymentId })),
    ).toBeNull();
    await inWs(() => repo.insert(payment('2026-12-01', breakdown(), paymentId)));
  });

  it('[TC-DEBT-LOAN-040] el listado por tipo (y por cuenta de pago o del préstamo) devuelve el pago con su desglose', async () => {
    const tx = payment('2027-01-15');
    await inWs(() => repo.insert(tx));
    for (const accountId of [bank, loanAccount]) {
      const found = await inWs(() =>
        repo.list(
          ws,
          {
            kinds: ['LOAN_PAYMENT'],
            accountIds: [accountId],
            dateFrom: '2027-01-01',
            dateTo: '2027-01-31',
            sort: '-transactionDate',
          },
          { offset: 0, limit: 10 },
        ),
      );
      expect(found.map((t) => t.id)).toEqual([tx.id]);
      expect(found[0]!.snapshot.loanPaymentBreakdown?.principal.toFixed()).toBe('1862.85');
    }
    const onlyDisbursements = await inWs(() =>
      repo.list(
        ws,
        {
          kinds: ['LOAN_DISBURSEMENT'],
          dateFrom: '2027-01-01',
          dateTo: '2027-01-31',
          sort: '-transactionDate',
        },
        { offset: 0, limit: 10 },
      ),
    );
    expect(onlyDisbursements).toEqual([]);
  });

  it('[TC-DEBT-LOAN-019] flujos nominales: el interés cuenta como gasto del mes y el principal no', async () => {
    const wsFlows = randomUUID();
    await uow.run({ userId: u1, workspaceId: wsFlows }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Flows', 'BOB', 'America/La_Paz', 'es-BO')`,
        [wsFlows],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [wsFlows, u1],
      );
    });
    const tx = Transaction.recordLoanPayment({
      id: randomUUID(),
      workspaceId: wsFlows,
      businessDate: '2026-11-15',
      paymentAccount: { accountId: bank, nature: 'ASSET', currency: 'BOB' },
      loanAccount: { accountId: loanAccount, nature: 'LIABILITY', currency: 'BOB' },
      amount: bob('2342.02'),
      breakdown: breakdown(),
      categoryIds: {
        interest: interestCategory,
        fees: feesCategory,
        insurance: randomUUID(),
        taxes: randomUUID(),
      },
      newSplitId: randomUUID,
      externalRef: { namespace: 'debt.loan-payment', id: randomUUID() },
    });
    tx.attachEntry(randomUUID());
    await uow.run({ userId: u1, workspaceId: wsFlows }, () => repo.insert(tx));
    const flows = new PgNominalFlowQuery(new PgTransactionsUnitOfWork(app), pgCurrencyCatalog);
    const rows = await uow.run({ userId: u1, workspaceId: wsFlows }, () =>
      flows.summarizeNominalFlows({ workspaceId: wsFlows, dateFrom: '2026-11-01', dateTo: '2026-11-30' }),
    );
    expect(rows).toEqual([
      {
        businessDate: '2026-11-15',
        nature: 'EXPENSE',
        categoryId: interestCategory,
        amount: { amount: '479.17', currency: 'BOB' },
      },
    ]);
  });
});
