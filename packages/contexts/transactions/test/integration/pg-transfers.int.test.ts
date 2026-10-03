import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Transaction } from '../../src/domain/index.js';
import { PgTransactionRepository } from '../../src/infrastructure/pg-transactions.js';

// Transferencias en PostgreSQL real (add-transfers tarea 4.1): legs SOURCE/TARGET persistidos y rehidratados,
// listado por cuenta en ambas cuentas y constraint trigger diferido `txn.assert_transfer_consistency()`.
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
const bankA = randomUUID();
const bankB = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId: ws }, fn);

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const transfer = () => {
  const tx = Transaction.recordTransfer({
    id: randomUUID(),
    workspaceId: ws,
    businessDate: '2026-03-15',
    from: { accountId: bankA, nature: 'ASSET', currency: 'BOB' },
    to: { accountId: bankB, nature: 'ASSET', currency: 'BOB' },
    amount: bob('1000.00'),
    fee: { amount: bob('10.00'), categoryId: randomUUID(), splitId: randomUUID() },
    paymentMethod: 'QR',
  });
  tx.attachEntry(randomUUID());
  return tx;
};

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-trf-${randomUUID()}`, `trf-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  await inWs(async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Trf', 'BOB', 'America/La_Paz', 'es-BO')`,
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

describe('PgTransactionRepository — transferencias', () => {
  it('[TC-TRANSACTIONS-TRANSFER-004] round-trip de legs SOURCE/TARGET y split de comisión; aparece en ambas cuentas', async () => {
    const tx = transfer();
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!;
    expect(loaded.snapshot.kind).toBe('TRANSFER');
    expect(loaded.snapshot.paymentMethod).toBe('QR');
    expect(loaded.snapshot.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', bankA, '-1010.00'],
      ['TARGET', bankB, '1000.00'],
    ]);
    expect(loaded.snapshot.splits.map((s) => s.amount.toFixed())).toEqual(['10.00']);
    for (const account of [bankA, bankB]) {
      const found = await inWs(() =>
        repo.list(ws, { accountIds: [account], sort: '-transactionDate' }, { offset: 0, limit: 10 }),
      );
      expect(found.map((t) => t.id)).toContain(tx.id);
    }
  });

  it('[TC-TRANSACTIONS-TRANSFER-003] el trigger diferido rechaza al COMMIT una transferencia con origen = destino', async () => {
    const tx = transfer();
    expect(
      await pgError(
        inWs(async () => {
          await repo.insert(tx);
          await requireSqlExecutor().query(
            `UPDATE txn.transaction_leg SET account_id = $1 WHERE transaction_id = $2 AND role = 'TARGET'`,
            [bankA, tx.id],
          );
        }),
      ),
    ).toBe('23514');
  });

  it('[TC-TRANSACTIONS-TRANSFER-001] el trigger diferido rechaza legs en monedas distintas', async () => {
    const tx = transfer();
    expect(
      await pgError(
        inWs(async () => {
          await repo.insert(tx);
          await requireSqlExecutor().query(
            `UPDATE txn.transaction_leg SET currency = 'USD' WHERE transaction_id = $1 AND role = 'TARGET'`,
            [tx.id],
          );
        }),
      ),
    ).toBe('23514');
  });
});
