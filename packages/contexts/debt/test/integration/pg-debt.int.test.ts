import { randomUUID } from 'node:crypto';
import { dec } from '@pf/shared-kernel';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type {
  AllocationRecord,
  PaymentRecord,
  StoredInstallment,
} from '../../src/application/ports/index.js';
import { Loan } from '../../src/domain/index.js';
import {
  PgDebtUnitOfWork,
  PgLoanRepository,
  PgPaymentRepository,
  PgReferenceRepository,
  PgScheduleRepository,
} from '../../src/infrastructure/pg-debt.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `debt.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-loans, tarea 4.1): repositorios con
// control optimista, cronograma y referencias append-only, `UNIQUE (transaction_id)` de pagos, Σ componentes = monto
// (INV-016), una cuenta respalda un solo préstamo no cancelado, pagos concurrentes serializados por `FOR UPDATE`,
// aislamiento entre workspaces y registro en el catálogo de purga.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgDebtUnitOfWork;
const loans = new PgLoanRepository();
const schedules = new PgScheduleRepository();
const payments = new PgPaymentRepository();
const references = new PgReferenceRepository();
const AT = '2026-10-10T16:00:00.000Z';

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

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

const newLoan = (ws: string, accountId = randomUUID()) =>
  Loan.register({
    id: randomUUID(),
    workspaceId: ws,
    at: AT,
    by: user,
    name: 'Préstamo vehicular',
    accountId,
    disbursementAccountId: randomUUID(),
    paymentAccountId: randomUUID(),
    principal: '1000.00',
    currency: 'BOB',
    currencyScale: 2,
    annualRate: '0.12',
    termInstallments: 3,
    disbursementDate: '2026-10-15',
    firstDueDate: '2026-11-15',
  });

const installment = (loanId: string, n: number, principal: string, interest: string): StoredInstallment => ({
  id: randomUUID(),
  loanId,
  scheduleVersion: 1,
  n,
  dueDate: `2026-${10 + n}-15`,
  periodStart: `2026-${9 + n}-15`,
  periodEnd: `2026-${10 + n}-15`,
  principal,
  interest,
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
  total: dec(principal).plus(interest).toFixed(2),
  openingBalance: '1000.00',
  closingBalance: '0.00',
});

async function activeLoan(ws: string) {
  const loan = newLoan(ws);
  await inWs(ws, () => loans.insert(loan));
  loan.markPersisted();
  const items = [installment(loan.id, 1, '330.02', '10.00'), installment(loan.id, 2, '333.32', '6.70')];
  await inWs(ws, () =>
    schedules.insertVersion(
      ws,
      {
        loanId: loan.id,
        scheduleVersion: 1,
        reason: 'INITIAL',
        effectiveFrom: '2026-10-15',
        parameters: {},
        createdBy: user,
      },
      items,
    ),
  );
  loan.disburse(
    { transactionId: randomUUID(), retainedFee: '0.00', recurringDefinitionId: randomUUID() },
    AT,
  );
  expect(await inWs(ws, () => loans.save(loan))).toBe(true);
  loan.markPersisted();
  return { loan, items };
}

const payment = (loanId: string, no: number, over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: randomUUID(),
  loanId,
  paymentNo: no,
  transactionId: randomUUID(),
  accountId: randomUUID(),
  businessDate: '2026-11-15',
  amount: '340.02',
  principal: '330.02',
  interest: '10.00',
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
  explicitBreakdown: false,
  paymentMethod: null,
  status: 'ACTIVE',
  voidedAt: null,
  voidedReason: null,
  createdBy: user,
  createdAt: AT,
  ...over,
});
const allocation = (p: PaymentRecord, item: StoredInstallment): AllocationRecord => ({
  paymentId: p.id,
  installmentId: item.id,
  installmentNo: item.n,
  principal: p.principal,
  interest: p.interest,
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
});

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgDebtUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/debt', $1, $2, 'U1') AS id`,
    [`sub-debt-${randomUUID()}`, `debt-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Debt', 'BOB', 'America/La_Paz', 'es-BO')`,
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

describe('PgLoanRepository y cronograma', () => {
  it('round-trip del préstamo con control optimista por versión', async () => {
    const loan = newLoan(w1);
    await inWs(w1, () => loans.insert(loan));
    loan.markPersisted();
    const loaded = (await inWs(w1, () => loans.findById(w1, loan.id)))!;
    expect(loaded.snapshot).toEqual(loan.snapshot);
    expect(loaded.snapshot.principal).toBe('1000.00');
    loaded.edit({ name: 'Auto' }, 2, AT);
    expect(await inWs(w1, () => loans.save(loaded))).toBe(true);
    const stale = Loan.restore(loan.snapshot);
    stale.edit({ name: 'Otro' }, 2, AT);
    expect(await inWs(w1, () => loans.save(stale))).toBe(false);
    expect((await inWs(w1, () => loans.findById(w1, loan.id)))!.snapshot.name).toBe('Auto');
  });

  it('[TC-DEBT-LOAN-043] una cuenta respalda un solo préstamo no cancelado', async () => {
    const account = randomUUID();
    const first = newLoan(w1, account);
    await inWs(w1, () => loans.insert(first));
    first.markPersisted();
    expect((await inWs(w1, () => loans.findActiveByAccount(w1, account)))?.id).toBe(first.id);
    expect(await sqlState(() => inWs(w1, () => loans.insert(newLoan(w1, account))))).toBe('23505');
    first.cancel('duplicado', AT);
    expect(await inWs(w1, () => loans.save(first))).toBe(true);
    expect(await inWs(w1, () => loans.findActiveByAccount(w1, account))).toBeNull();
    await inWs(w1, () => loans.insert(newLoan(w1, account)));
  });

  it('el cronograma y sus cuotas son inmutables (PF003) y se leen en orden', async () => {
    const { loan, items } = await activeLoan(w1);
    const read = await inWs(w1, () => schedules.installments(loan.id, 1));
    expect(read.map((i) => [i.n, i.total, i.principal])).toEqual([
      [1, '340.02', '330.02'],
      [2, '340.02', '333.32'],
    ]);
    expect(read[0]!.id).toBe(items[0]!.id);
    for (const sql of [
      `UPDATE debt.loan_installment SET interest_amount = 1 WHERE loan_id = $1`,
      `DELETE FROM debt.loan_installment WHERE loan_id = $1`,
      `UPDATE debt.loan_schedule_version SET reason = 'INITIAL' WHERE loan_id = $1`,
    ]) {
      // pf_app no tiene UPDATE/DELETE sobre estas tablas (42501); el dueño de la tabla topa con el trigger (PF003).
      expect(['42501', 'PF003']).toContain(
        await sqlState(() => inCtx(app, w1, (c) => c.query(sql, [loan.id]))),
      );
    }
    // El dueño de la tabla topa con el trigger (TRUNCATE es de sentencia: no depende de las políticas RLS).
    for (const table of ['loan_installment', 'loan_schedule_version']) {
      expect(
        await sqlState(() => inCtx(migrator, w1, (c) => c.query(`TRUNCATE debt.${table} CASCADE`))),
      ).toBe('PF003');
    }
  });
});

describe('pagos', () => {
  it('[TC-DEBT-LOAN-012] imputaciones vigentes por cuota; un pago anulado deja de contar; UNIQUE (transaction_id)', async () => {
    const { loan, items } = await activeLoan(w1);
    const p1 = payment(loan.id, await inWs(w1, () => payments.nextPaymentNo(loan.id)));
    await inWs(w1, () => payments.insert(w1, p1, [allocation(p1, items[0]!)]));
    const paid = await inWs(w1, () => payments.paidByInstallment(loan.id));
    expect(paid.get(items[0]!.id)).toEqual({
      taxes: '0.00',
      insurance: '0.00',
      fees: '0.00',
      interest: '10.00',
      principal: '330.02',
    });
    expect((await inWs(w1, () => payments.latestActive(loan.id)))?.id).toBe(p1.id);
    expect(
      await sqlState(() =>
        inWs(w1, () => payments.insert(w1, payment(loan.id, 2, { transactionId: p1.transactionId }), [])),
      ),
    ).toBe('23505');
    await inWs(w1, () => payments.markVoided(w1, p1.id, { voidedAt: AT, voidedBy: user, reason: 'error' }));
    expect((await inWs(w1, () => payments.paidByInstallment(loan.id))).size).toBe(0);
    expect(await inWs(w1, () => payments.latestActive(loan.id))).toBeNull();
    expect((await inWs(w1, () => payments.find(loan.id, p1.id)))?.status).toBe('VOIDED');
  });

  it('[TC-DEBT-LOAN-012] INV-016: el monto debe ser la suma de los componentes', async () => {
    const { loan } = await activeLoan(w1);
    const broken = payment(loan.id, 1, { amount: '341.00' });
    expect(await sqlState(() => inWs(w1, () => payments.insert(w1, broken, [])))).toBe('23514');
  });

  it('[TC-DEBT-LOAN-032] dos pagos concurrentes se serializan con FOR UPDATE del préstamo', async () => {
    const { loan, items } = await activeLoan(w1);
    const run = (index: number) =>
      inWs(w1, async () => {
        await loans.findById(w1, loan.id, { lock: 'update' });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const p = payment(loan.id, await payments.nextPaymentNo(loan.id));
        await payments.insert(w1, p, [allocation(p, items[index]!)]);
        return p.paymentNo;
      });
    const numbers = await Promise.all([run(0), run(1)]);
    expect([...numbers].sort()).toEqual([1, 2]);
  }, 30_000);
});

describe('referencias del banco, aislamiento y purga', () => {
  it('la referencia y sus filas son append-only; la comparación se guarda y se explica', async () => {
    const { loan } = await activeLoan(w1);
    const ref = {
      id: randomUUID(),
      loanId: loan.id,
      referenceVersion: await inWs(w1, () => references.nextVersion(loan.id)),
      source: 'PASTE' as const,
      mapping: { dateFormat: 'DD/MM/YYYY' },
      rowCount: 1,
      createdAt: AT,
      createdBy: user,
    };
    const row = {
      n: 1,
      dueDate: '2026-11-15',
      principal: '330.02',
      interest: '10.00',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
      total: '340.02',
    };
    await inWs(w1, () => references.insert(w1, ref, [row]));
    expect(await inWs(w1, () => references.rows(ref.id))).toEqual([row]);
    expect(
      await sqlState(() => inCtx(migrator, w1, (c) => c.query(`TRUNCATE debt.loan_reference_row`))),
    ).toBe('PF003');
    const comparison = {
      id: randomUUID(),
      loanId: loan.id,
      referenceId: ref.id,
      scheduleVersion: 1,
      matched: 0,
      totalRows: 2,
      firstDifferenceNo: 1,
      summary: {},
      status: 'UNEXPLAINED' as const,
      explanation: null,
      explainedBy: null,
      explainedAt: null,
    };
    await inWs(w1, () => references.upsertComparison(w1, comparison));
    await inWs(w1, () =>
      references.explain(w1, comparison.id, {
        explanation: 'el banco trunca',
        explainedBy: user,
        explainedAt: AT,
      }),
    );
    const stored = (await inWs(w1, () => references.findComparison(ref.id, 1)))!;
    expect([stored.status, stored.explanation]).toEqual(['EXPLAINED', 'el banco trunca']);
  });

  it('[TC-SECURITY-ISOLATION-001] otro workspace no ve ni escribe préstamos ajenos', async () => {
    const { loan } = await activeLoan(w1);
    expect(await inWs(w2, () => loans.findById(w2, loan.id))).toBeNull();
    expect(await inWs(w2, () => schedules.installments(loan.id, 1))).toEqual([]);
    const counts = await inCtx(app, w2, async (c) => {
      const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM debt.loan WHERE id = $1`, [loan.id]);
      return Number(r.rows[0]!.n);
    });
    expect(counts).toBe(0);
    expect(
      await sqlState(() =>
        inCtx(app, w2, (c) => c.query(`UPDATE debt.loan SET name = 'x' WHERE id = $1`, [loan.id])),
      ),
    ).toBeUndefined();
    expect((await inWs(w1, () => loans.findById(w1, loan.id)))!.snapshot.name).toBe('Préstamo vehicular');
  });

  it('las tablas de debt están registradas para la purga demo con hijas antes que padres', async () => {
    const { rows } = await migrator.query<{ table_name: string; purge_order: number }>(
      `SELECT table_name, purge_order FROM platform.workspace_scoped_table WHERE schema_name = 'debt'`,
    );
    const order = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.purge_order)]));
    expect(Object.keys(order).sort()).toEqual([
      'loan',
      'loan_installment',
      'loan_payment',
      'loan_payment_allocation',
      'loan_reference_row',
      'loan_reference_schedule',
      'loan_schedule_comparison',
      'loan_schedule_version',
    ]);
    expect(order['loan_payment_allocation']).toBeLessThan(order['loan_payment']!);
    expect(order['loan_payment_allocation']).toBeLessThan(order['loan_installment']!);
    expect(order['loan_installment']).toBeLessThan(order['loan_schedule_version']!);
    expect(order['loan_schedule_version']).toBeLessThan(order['loan']!);
    expect(order['loan_reference_row']).toBeLessThan(order['loan_reference_schedule']!);
    expect(order['loan_schedule_comparison']).toBeLessThan(order['loan_reference_schedule']!);
  });
});
