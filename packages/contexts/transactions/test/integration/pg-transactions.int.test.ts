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

  it('[TC-TRANSACTIONS-SPLIT-007] la BD rechaza al confirmar unos splits que no suman, admite revisiones en varias sentencias y revierte el lote entero', async () => {
    const failure = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        return err as { code?: string; constraint?: string; message?: string };
      }
      return undefined;
    };
    const exec = (text: string, params: unknown[]) => requireSqlExecutor().query(text, params);
    const tx = record(w1, { amount: bob('150.00') });
    await inWs(w1, () => repo.insert(tx));
    const amountOf = async (id: string) =>
      Number(
        (
          (await inWs(w1, () => exec(`SELECT amount::text AS a FROM txn.transaction WHERE id = $1`, [id])))
            .rows[0] as { a: string }
        ).a,
      );

    // 1. Revisión en tres sentencias: el estado intermedio no suma, el confirmado sí.
    await inWs(w1, async () => {
      await exec(`UPDATE txn.transaction SET amount = 175.00 WHERE id = $1`, [tx.id]);
      await exec(
        `UPDATE txn.transaction_split SET superseded_in_revision = 2 WHERE transaction_id = $1 AND superseded_in_revision IS NULL`,
        [tx.id],
      );
      await exec(
        `INSERT INTO txn.transaction_split (id, workspace_id, transaction_id, position, amount, currency, category_id, revision)
         VALUES ($1, $2, $3, 0, 175.00, 'BOB', $4, 2)`,
        [randomUUID(), w1, tx.id, randomUUID()],
      );
    });
    expect(await amountOf(tx.id)).toBe(175);

    // 2. Cambio de monto sin splits nuevos: falla al confirmar con la restricción y el formato de siempre.
    const amountOnly = await failure(
      inWs(w1, () => exec(`UPDATE txn.transaction SET amount = 200.00 WHERE id = $1`, [tx.id])),
    );
    expect(amountOnly?.code).toBe('23514');
    expect(amountOnly?.constraint).toBe('transaction_splits_sum_ck');
    expect(amountOnly?.message).toMatch(
      /splits of transaction [0-9a-f-]{36} sum 175(\.0+)? but the expected amount is 200(\.0+)?/,
    );
    expect(await amountOf(tx.id)).toBe(175);

    // 3. Lote por conjunto con un split inyectado de 17.00: no queda ninguna de las 200 transacciones.
    const writeBatch = (ids: string[], badIndex: number | null) =>
      inWs(w1, async () => {
        await exec(
          `INSERT INTO txn.transaction (id, workspace_id, kind, status, transaction_date, account_id, amount, currency, source)
           SELECT t.id, $1::uuid, 'EXPENSE', 'PENDING', '2026-10-01', $2::uuid, 18.00, 'BOB', 'IMPORT'
             FROM unnest($3::uuid[]) AS t(id)`,
          [w1, bank, ids],
        );
        await exec(
          `INSERT INTO txn.transaction_split (id, workspace_id, transaction_id, position, amount, currency, category_id, revision)
           SELECT gen_random_uuid(), $1::uuid, t.id, 0, CASE WHEN t.ord = $3 THEN 17.00 ELSE 18.00 END, 'BOB', $4::uuid, 1
             FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)`,
          [w1, ids, badIndex ?? -1, randomUUID()],
        );
      });
    const countOf = async (ids: string[]) =>
      (
        (
          await inWs(w1, () =>
            exec(`SELECT count(*)::int AS n FROM txn.transaction WHERE id = ANY($1::uuid[])`, [ids]),
          )
        ).rows[0] as { n: number }
      ).n;
    const bad = Array.from({ length: 200 }, () => randomUUID());
    const batch = await failure(writeBatch(bad, 59));
    expect(batch?.code).toBe('23514');
    expect(batch?.constraint).toBe('transaction_splits_sum_ck');
    expect(batch?.message).toMatch(
      new RegExp(`splits of transaction ${bad[58]} sum 17(\\.0+)? but the expected amount is 18(\\.0+)?`),
    );
    expect(await countOf(bad)).toBe(0);
    const good = Array.from({ length: 200 }, () => randomUUID());
    await writeBatch(good, null);
    expect(await countOf(good)).toBe(200);
  }, 60_000);

  it('[TC-TRANSACTIONS-BULKIMPORT-005] (BD) insertMany escribe las mismas filas que insert + linkEntry, también con splits y tags', async () => {
    const tag = randomUUID();
    const make = (extra: Partial<RecordTransactionInput> = {}) =>
      record(w1, {
        kind: 'INCOME',
        amount: bob('8000.00'),
        description: 'ABONO "SUELDO" ñ \\ <ref>',
        source: 'IMPORT',
        externalRef: { namespace: 'imports.csv-row', id: `fp-${randomUUID()}` },
        ...extra,
      });
    const withSplits = () => ({
      splits: [
        { id: randomUUID(), amount: bob('5000.00'), categoryId: randomUUID(), tagIds: [tag] },
        { id: randomUUID(), amount: bob('3000.00'), categoryId: randomUUID() },
      ],
    });
    const singles = [make(), make(withSplits())];
    const bulk = [make(), make(withSplits())];
    await inWs(w1, async () => {
      for (const tx of singles) {
        await repo.insert(tx);
        await repo.linkEntry({
          workspaceId: w1,
          transactionId: tx.id,
          revision: tx.revision,
          journalEntryId: tx.snapshot.activeEntryId as string,
          linkType: 'POSTED',
        });
      }
    });
    await inWs(w1, () =>
      repo.insertMany(
        bulk,
        bulk.map((tx) => ({
          transactionId: tx.id,
          revision: tx.revision,
          journalEntryId: tx.snapshot.activeEntryId as string,
          linkType: 'POSTED' as const,
        })),
      ),
    );
    const normalized = async (tx: Transaction) => {
      const loaded = (await inWs(w1, () => repo.findById(w1, tx.id)))!.snapshot;
      const legs = await inWs(w1, () => repo.revisionLegs(w1, tx.id));
      const links = await inWs(w1, () => repo.linkedEntries(w1, tx.id));
      return JSON.stringify({
        ...loaded,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        externalRef: undefined,
        activeEntryId: undefined,
        splits: loaded.splits.map((x) => ({ ...x, id: undefined, amount: x.amount.toFixed() })),
        amount: loaded.amount.toFixed(),
        legs: loaded.legs.map((l) => ({ role: l.role, amount: l.amount.toFixed() })),
        history: [...legs.entries()].map(([r, ls]) => [r, ls.map((l) => [l.role, l.amount.toFixed()])]),
        linkCount: links.length,
      }).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#');
    };
    for (let i = 0; i < singles.length; i += 1) {
      expect(await normalized(bulk[i]!)).toBe(await normalized(singles[i]!));
    }
    const loaded = (await inWs(w1, () => repo.findById(w1, bulk[1]!.id)))!;
    expect(loaded.snapshot.splits.map((x) => [x.amount.toFixed(), x.tagIds.length])).toEqual([
      ['5000.00', 1],
      ['3000.00', 0],
    ]);
    // La barrera de INV-021 sigue activa para las filas insertadas por conjunto.
    expect(
      await pgError(
        inWs(w1, () =>
          requireSqlExecutor().query(`UPDATE txn.transaction_split SET amount = 1.00 WHERE id = $1`, [
            bulk[1]!.snapshot.splits[0]!.id,
          ]),
        ),
      ),
    ).toBe('23514');
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
