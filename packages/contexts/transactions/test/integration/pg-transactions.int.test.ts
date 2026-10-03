import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, DomainError, Money } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Transaction, type RecordTransactionInput } from '../../src/domain/index.js';
import { PgTransactionRepository, pgCurrencyCatalog } from '../../src/infrastructure/pg-transactions.js';

// Repositorio Kysely de TRANSACTIONS contra PostgreSQL real (Testcontainers postgres:18 + `migrate` real): RLS por
// workspace, CHECKs de INV-023, constraint trigger diferido de Σ splits (INV-021), optimistic locking, sin DELETE y
// `transaction_journal_link` append-only (tareas 4.1–4.3).
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
const bank = randomUUID();
const repo = new PgTransactionRepository();

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
    businessDate: '2026-09-30',
    accountId: bank,
    accountNature: 'ASSET',
    accountCurrency: 'BOB',
    amount: bob('150.00'),
    description: 'Farmacia Chávez',
    defaultCategoryId: randomUUID(),
    defaultSplitId: randomUUID(),
    ...over,
  });
  if (tx.needsEntry) tx.attachEntry(randomUUID());
  return tx;
};

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-txn-${randomUUID()}`, `txn-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await uow.run({ userId: u1, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Txn', 'BOB', 'America/La_Paz', 'es-BO')`,
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

describe('PgTransactionRepository', () => {
  it('[TC-TRANSACTIONS-SPLIT-001] round-trip con splits, tags y legs; Σ splits ≠ monto lo rechaza el trigger diferido', async () => {
    const tag = randomUUID();
    const tx = record(w1, {
      splits: [
        { id: randomUUID(), amount: bob('100.00'), categoryId: randomUUID(), tagIds: [tag] },
        { id: randomUUID(), amount: bob('50.00'), categoryId: randomUUID() },
      ],
    });
    await inWs(w1, () => repo.insert(tx));
    const loaded = (await inWs(w1, () => repo.findById(w1, tx.id)))!;
    expect(loaded.snapshot.amount.toFixed()).toBe('150.00');
    expect(loaded.snapshot.splits.map((s) => [s.amount.toFixed(), s.tagIds])).toEqual([
      ['100.00', [tag]],
      ['50.00', []],
    ]);
    expect(loaded.snapshot.legs.map((l) => l.amount.toFixed())).toEqual(['-150.00']);
    // Bypass del dominio: un UPDATE directo que descuadra los splits falla al COMMIT (INV-021 en BD).
    expect(
      await pgError(
        inWs(w1, () =>
          requireSqlExecutor().query(`UPDATE txn.transaction_split SET amount = 49.99 WHERE id = $1`, [
            tx.snapshot.splits[1]!.id,
          ]),
        ),
      ),
    ).toBe('23514');
    expect(await inWs(w1, () => pgCurrencyCatalog.scaleOf('BOB'))).toBe(2);
  });

  it('[TC-TRANSACTIONS-STATUS-001] INV-023 en BD: un POSTED sin asiento activo viola el CHECK', async () => {
    const tx = record(w1);
    await inWs(w1, () => repo.insert(tx));
    expect(
      await pgError(
        inWs(w1, () =>
          requireSqlExecutor().query(`UPDATE txn.transaction SET active_entry_id = NULL WHERE id = $1`, [
            tx.id,
          ]),
        ),
      ),
    ).toBe('23514');
  });

  it('[TC-TRANSACTIONS-CONCURRENCY-001] optimistic locking: el segundo escritor con la misma versión pierde', async () => {
    const tx = record(w1);
    await inWs(w1, () => repo.insert(tx));
    const a = (await inWs(w1, () => repo.findById(w1, tx.id)))!;
    const b = (await inWs(w1, () => repo.findById(w1, tx.id)))!;
    a.amend({ description: 'A' });
    b.amend({ description: 'B' });
    expect(await inWs(w1, () => repo.update(a))).toBe(true);
    expect(await inWs(w1, () => repo.update(b))).toBe(false);
    expect((await inWs(w1, () => repo.findById(w1, tx.id)))!.snapshot.description).toBe('A');
  });

  it('[TC-TRANSACTIONS-EDIT-001] repostear supersede el leg anterior y conserva la cadena de asientos', async () => {
    const tx = record(w1, { amount: bob('120.00') });
    const e1 = tx.snapshot.activeEntryId!;
    await inWs(w1, async () => {
      await repo.insert(tx);
      await repo.linkEntry({
        workspaceId: w1,
        transactionId: tx.id,
        revision: 1,
        journalEntryId: e1,
        linkType: 'POSTED',
      });
    });
    const loaded = (await inWs(w1, () => repo.findById(w1, tx.id, { forUpdate: true })))!;
    loaded.amend({ amount: bob('102.00') });
    const e2 = randomUUID();
    loaded.attachEntry(e2);
    await inWs(w1, async () => {
      expect(await repo.update(loaded)).toBe(true);
      await repo.linkEntry({
        workspaceId: w1,
        transactionId: tx.id,
        revision: 2,
        journalEntryId: e2,
        linkType: 'POSTED',
      });
    });
    const after = (await inWs(w1, () => repo.findById(w1, tx.id)))!.snapshot;
    expect(after).toMatchObject({ revision: 2, version: 2, activeEntryId: e2 });
    expect(after.legs.map((l) => l.amount.toFixed())).toEqual(['-102.00']);
    expect(await inWs(w1, () => repo.linkedEntries(w1, tx.id))).toEqual([e1, e2]);
    const { rows } = await inWs(w1, () =>
      requireSqlExecutor().query(
        `SELECT count(*)::text AS n FROM txn.transaction_leg WHERE transaction_id = $1 AND superseded_in_revision = 2`,
        [tx.id],
      ),
    );
    expect((rows[0] as { n: string } | undefined)?.n).toBe('1');
  });

  it('[TC-TRANSACTIONS-DUPLICATE-001] candidatos y filtros del listado (q sin acentos, estado, reembolsos)', async () => {
    const original = record(w1, { amount: bob('85.40'), description: 'Café Ñandú' });
    const refund = record(w1, {
      kind: 'REFUND',
      amount: bob('10.00'),
      refundOfTransactionId: original.id,
      description: 'devolución',
    });
    await inWs(w1, async () => {
      await repo.insert(original);
      await repo.insert(refund);
    });
    const dup = await inWs(w1, () =>
      repo.duplicateCandidates(w1, {
        accountId: bank,
        amount: bob('85.40'),
        from: '2026-09-27',
        to: '2026-10-03',
      }),
    );
    expect(dup.map((d) => d.id)).toEqual([original.id]);
    const found = await inWs(w1, () =>
      repo.list(w1, { q: 'cafe nandu', sort: '-transactionDate' }, { offset: 0, limit: 10 }),
    );
    expect(found.map((t) => t.id)).toEqual([original.id]);
    expect(await inWs(w1, () => repo.refundedTotal(w1, original.id))).toMatch(/^10\.0+$/);
    const refunds = await inWs(w1, () =>
      repo.list(w1, { kinds: ['REFUND'], sort: 'amount' }, { offset: 0, limit: 10 }),
    );
    expect(refunds.map((t) => t.id)).toEqual([refund.id]);
  });

  it('INV-025: RLS aísla workspaces; pf_app no puede borrar transacciones ni modificar la cadena de asientos', async () => {
    const tx = record(w1);
    await inWs(w1, async () => {
      await repo.insert(tx);
      await repo.linkEntry({
        workspaceId: w1,
        transactionId: tx.id,
        revision: 1,
        journalEntryId: tx.snapshot.activeEntryId!,
        linkType: 'POSTED',
      });
    });
    expect(await inWs(w2, () => repo.findById(w2, tx.id))).toBeNull();
    expect(
      await pgError(
        inWs(w1, () => requireSqlExecutor().query(`DELETE FROM txn.transaction WHERE id = $1`, [tx.id])),
      ),
    ).toBe('42501');
    expect(
      await pgError(
        inWs(w1, () =>
          requireSqlExecutor().query(
            `UPDATE txn.transaction_journal_link SET revision = 9 WHERE transaction_id = $1`,
            [tx.id],
          ),
        ),
      ),
    ).toBe('42501');
  });
});
