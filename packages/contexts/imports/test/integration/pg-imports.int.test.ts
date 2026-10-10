import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { RowNormalization } from '../../src/application/ports/index.js';
import { EMPTY_COUNTERS, ImportJob, type CsvMapping } from '../../src/domain/index.js';
import {
  PgImportJobRepository,
  PgImportsUnitOfWork,
  PgRowLinkRepository,
  PgStagingRepository,
} from '../../src/infrastructure/pg-imports.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `imports.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-basic-csv-import, tarea 4.1): repositorios
// con optimistic locking, inserción por chunks, resumen del staging por SQL, índice único de vínculos activos (INV-014),
// aislamiento entre workspaces, permisos de borrado y registro en el catálogo de purga.
let app: Pool;
let migrator: Pool;
let worker: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgImportsUnitOfWork;
const jobs = new PgImportJobRepository();
const staging = new PgStagingRepository();
const links = new PgRowLinkRepository();
const account = randomUUID();
const NOW = '2026-10-20T14:00:00.000Z';
const MAPPING: CsvMapping = {
  hasHeader: true,
  skipRows: 0,
  columns: {
    date: { index: 0 },
    description: { index: 1 },
    amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
  },
  dateFormat: 'dd/MM/yyyy',
  decimalSeparator: ',',
};

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

async function inCtx<T>(
  pool: Pool,
  workspaceId: string,
  fn: (c: PoolClient) => Promise<T>,
  commit = false,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      workspaceId,
    ]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const newJob = (workspaceId: string, over: { rowCount?: number } = {}) =>
  ImportJob.create({
    id: randomUUID(),
    workspaceId,
    accountId: account,
    createdBy: user,
    now: NOW,
    originalName: 'extracto.csv',
    fileChecksum: 'ab'.repeat(32),
    fileSizeBytes: 100,
    encoding: 'windows-1252',
    delimiter: ';',
    rowCount: over.rowCount ?? 4,
    columnCount: 3,
    header: ['Fecha', 'Descripción', 'Monto'],
    warnings: [],
    expiresAt: '2026-11-19T14:00:00.000Z',
  });

const hex = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

const normalization = (id: string, i: number, over: Partial<RowNormalization> = {}): RowNormalization => ({
  id,
  bookingDate: '2026-10-02',
  amount: '18.00',
  currency: 'BOB',
  direction: 'OUT',
  description: `COMPRA ${i}`,
  occurrenceIndex: 0,
  fingerprint: hex(i + 1),
  classification: 'NEW',
  decision: 'CREATE',
  issues: [],
  matchedTransactionId: null,
  ...over,
});

async function seedStaged(workspaceId: string, jobId: string, n: number) {
  const ids = Array.from({ length: n }, () => randomUUID());
  await inWs(workspaceId, () =>
    staging.insertRaw(
      workspaceId,
      jobId,
      ids.map((id, i) => ({ id, rowNumber: i + 1, raw: [`01/10/2026`, `COMPRA "${i}"`, `-18,00`] })),
    ),
  );
  return ids;
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  uow = new PgImportsUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/imp', $1, $2, 'U1') AS id`,
    [`sub-imp-${randomUUID()}`, `imp-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Imp', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
  await worker?.end();
});

describe('PgImportJobRepository', () => {
  it('[TC-IMPORTS-CSV-001] round-trip del job (jsonb, bytea, instantes) con control optimista por versión', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    job.markPersisted();
    const loaded = (await inWs(w1, () => jobs.findById(w1, job.id)))!;
    expect(loaded.state).toEqual({ ...job.state });
    expect(loaded.state.fileChecksum).toBe('ab'.repeat(32));
    expect(loaded.state.header).toEqual(['Fecha', 'Descripción', 'Monto']);

    loaded.applyMapping({ mapping: MAPPING, counters: { ...EMPTY_COUNTERS, rows: 4, newRows: 4 }, now: NOW });
    expect(await inWs(w1, () => jobs.save(loaded))).toBe(true);
    // Una copia vieja (versión persistida 1) ya no puede guardar: otra escritura ganó.
    const stale = ImportJob.rehydrate(job.state);
    stale.applyMapping({ mapping: MAPPING, counters: EMPTY_COUNTERS, now: NOW });
    expect(await inWs(w1, () => jobs.save(stale))).toBe(false);
    const after = (await inWs(w1, () => jobs.findById(w1, job.id)))!;
    expect(after.state.status).toBe('AWAITING_REVIEW');
    expect(after.state.mapping).toEqual(MAPPING);
    expect(after.state.version).toBe(2);
  });

  it('lista por cuenta y estado más reciente primero, con cursor keyset', async () => {
    const a = newJob(w1);
    const b = newJob(w1);
    const c = ImportJob.create({ ...newJobArgs(w1), id: randomUUID(), now: '2026-10-21T10:00:00.000Z' });
    for (const j of [a, b, c]) await inWs(w1, () => jobs.insert(j));
    const all = await inWs(w1, () => jobs.list(w1, { accountId: account, limit: 100 }));
    expect(all.map((j) => j.id)[0]).toBe(c.id);
    const firstPage = await inWs(w1, () => jobs.list(w1, { accountId: account, limit: 2 }));
    const last = firstPage.at(-1)!.state;
    const rest = await inWs(w1, () =>
      jobs.list(w1, { accountId: account, limit: 100, after: [last.createdAt, last.id] }),
    );
    expect([...firstPage, ...rest].map((j) => j.id)).toEqual(all.map((j) => j.id));
    expect(await inWs(w1, () => jobs.list(w1, { status: 'CANCELLED', limit: 10 }))).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-019] encuentra la importación terminada previa por checksum y la última con mapeo', async () => {
    const done = newJob(w1);
    done.applyMapping({ mapping: MAPPING, counters: EMPTY_COUNTERS, now: NOW });
    done.approve({ userId: user, now: NOW, batchCount: 0 });
    done.beginPersisting(NOW);
    done.finish({ failed: 0, errors: [], now: '2026-10-22T09:00:00.000Z' });
    const fp = 'cd'.repeat(32);
    const withChecksum = ImportJob.rehydrate({ ...done.state, fileChecksum: fp });
    await inWs(w1, () =>
      jobs.insert(ImportJob.create({ ...newJobArgs(w1), id: withChecksum.id, fileChecksum: fp, now: NOW })),
    );
    await inWs(w1, async () => {
      const fresh = (await jobs.findById(w1, withChecksum.id))!;
      fresh.applyMapping({ mapping: MAPPING, counters: EMPTY_COUNTERS, now: NOW });
      fresh.approve({ userId: user, now: NOW, batchCount: 0 });
      fresh.beginPersisting(NOW);
      fresh.finish({ failed: 0, errors: [], now: '2026-10-22T09:00:00.000Z' });
      expect(await jobs.save(fresh)).toBe(true);
    });
    const previous = await inWs(w1, () => jobs.findPreviousImported(w1, account, fp));
    expect(previous).toEqual({ id: withChecksum.id, completedAt: '2026-10-22T09:00:00.000Z' });
    expect(await inWs(w1, () => jobs.findPreviousImported(w1, account, 'ee'.repeat(32)))).toBeNull();
    expect(await inWs(w1, () => jobs.lastMapping(w1, account))).toEqual(MAPPING);
  });

  it('[TC-IMPORTS-CSV-030] reconoce las revisiones vencidas y los jobs purgables', async () => {
    const waiting = newJob(w1);
    await inWs(w1, () => jobs.insert(waiting));
    const expired = await inWs(w1, () => jobs.expiredReviews(w1, '2026-11-19T14:00:00.000Z', 100));
    expect(expired).toContain(waiting.id);
    expect(await inWs(w1, () => jobs.expiredReviews(w1, '2026-11-18T14:00:00.000Z', 100))).not.toContain(
      waiting.id,
    );

    const done = newJob(w1);
    done.applyMapping({ mapping: MAPPING, counters: EMPTY_COUNTERS, now: NOW });
    done.approve({ userId: user, now: NOW, batchCount: 0 });
    done.beginPersisting(NOW);
    done.finish({ failed: 0, errors: [], now: NOW });
    await inWs(w1, async () => {
      await jobs.insert(ImportJob.create({ ...newJobArgs(w1), id: done.id, now: NOW }));
      const row = (await jobs.findById(w1, done.id))!;
      row.applyMapping({ mapping: MAPPING, counters: EMPTY_COUNTERS, now: NOW });
      row.approve({ userId: user, now: NOW, batchCount: 0 });
      row.beginPersisting(NOW);
      row.finish({ failed: 0, errors: [], now: NOW });
      await jobs.save(row);
    });
    await seedStaged(w1, done.id, 3);
    expect(await inWs(w1, () => jobs.purgeable(w1, NOW, 100))).toContain(done.id);
    expect(await inWs(w1, () => jobs.purgeable(w1, '2026-10-20T13:59:59.000Z', 100))).not.toContain(done.id);
    await inWs(w1, () => staging.deleteAll(w1, done.id));
    expect(await inWs(w1, () => jobs.purgeable(w1, NOW, 100))).not.toContain(done.id);
  });
});

function newJobArgs(workspaceId: string) {
  return {
    id: randomUUID(),
    workspaceId,
    accountId: account,
    createdBy: user,
    now: NOW,
    originalName: 'extracto.csv',
    fileChecksum: 'ab'.repeat(32),
    fileSizeBytes: 100,
    encoding: 'windows-1252' as const,
    delimiter: ';' as const,
    rowCount: 4,
    columnCount: 3,
    header: ['Fecha', 'Descripción', 'Monto'],
    warnings: [],
    expiresAt: '2026-11-19T14:00:00.000Z',
  };
}

describe('PgStagingRepository', () => {
  it('inserta 5 000 celdas en chunks y las devuelve en orden de línea con sus comillas intactas', async () => {
    const job = newJob(w1, { rowCount: 5000 });
    await inWs(w1, () => jobs.insert(job));
    const started = Date.now();
    const ids = await seedStaged(w1, job.id, 5000);
    expect(Date.now() - started).toBeLessThan(15_000);
    const loaded = await inWs(w1, () => staging.loadForMapping(w1, job.id));
    expect(loaded).toHaveLength(5000);
    expect(loaded[0]).toMatchObject({ id: ids[0], rowNumber: 1, fingerprint: null, classification: null });
    expect(loaded[4999]?.raw).toEqual(['01/10/2026', 'COMPRA "4999"', '-18,00']);
  }, 60_000);

  it('[TC-IMPORTS-CSV-015] aplica la normalización y resume conteos y totales por SQL con la escala de la moneda', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const ids = await seedStaged(w1, job.id, 6);
    await inWs(w1, () =>
      staging.applyNormalization(
        w1,
        job.id,
        [
          normalization(ids[1]!, 1, { amount: '245.30', description: 'SUPERMERCADO' }),
          normalization(ids[2]!, 2),
          normalization(ids[3]!, 3, { amount: '8000.00', direction: 'IN' }),
          normalization(ids[4]!, 4, {
            classification: 'DUPLICATE_PROBABLE',
            decision: null,
            matchedTransactionId: randomUUID(),
          }),
          normalization(ids[5]!, 5, {
            classification: 'INVALID',
            decision: 'EXCLUDE',
            fingerprint: null,
            amount: null,
            direction: null,
          }),
        ],
        [ids[0]!],
      ),
    );
    const summary = await inWs(w1, () => staging.summary(w1, job.id));
    expect(summary).toMatchObject({
      rows: 5,
      byClassification: { NEW: 3, DUPLICATE_EXACT: 0, DUPLICATE_PROBABLE: 1, INVALID: 1 },
      pendingDecisions: 1,
      toCreate: 3,
      skipped: 0,
      excluded: 0,
      created: 0,
      failed: 0,
    });
    expect(Number(summary.outflows)).toBeCloseTo(263.3, 5);
    expect(summary.inflows).toBe('8000.000000000000000000');

    const page = await inWs(w1, () => staging.page(w1, job.id, { limit: 10 }));
    expect(page.map((r) => [r.rowNumber, r.classification, r.amount])).toEqual([
      [2, 'NEW', '245.30'],
      [3, 'NEW', '18.00'],
      [4, 'NEW', '8000.00'],
      [5, 'DUPLICATE_PROBABLE', '18.00'],
      [6, 'INVALID', null],
    ]);
    const filtered = await inWs(w1, () => staging.page(w1, job.id, { classification: 'INVALID', limit: 10 }));
    expect(filtered.map((r) => r.rowNumber)).toEqual([6]);
    const afterCursor = await inWs(w1, () => staging.page(w1, job.id, { afterRowNumber: 3, limit: 1 }));
    expect(afterCursor.map((r) => r.rowNumber)).toEqual([4]);

    await inWs(w1, () => staging.setDecision(w1, job.id, ids[4]!, 'SKIP'));
    const after = await inWs(w1, () => staging.summary(w1, job.id));
    expect(after).toMatchObject({ pendingDecisions: 0, skipped: 1, toCreate: 3 });
    const skipped = await inWs(w1, () => staging.skippedProbableRows(w1, job.id));
    expect(skipped.map((s) => s.rowId)).toEqual([ids[4]]);
  });

  it('[TC-IMPORTS-CSV-024] reparte lotes, persiste, registra fallos por lote y los limpia al reintentar', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const ids = await seedStaged(w1, job.id, 5);
    await inWs(w1, () =>
      staging.applyNormalization(
        w1,
        job.id,
        ids.map((id, i) => normalization(id, i, { bookingDate: `2026-10-0${i + 1}` })),
        [],
      ),
    );
    const toCreate = await inWs(w1, () => staging.rowsToCreate(w1, job.id));
    expect(toCreate.map((r) => r.bookingDate)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    await inWs(w1, () =>
      staging.assignBatches(w1, job.id, [
        { batchNo: 1, rowIds: [ids[0]!, ids[1]!] },
        { batchNo: 2, rowIds: [ids[2]!, ids[3]!] },
        { batchNo: 3, rowIds: [ids[4]!] },
      ]),
    );
    expect(await inWs(w1, () => staging.pendingBatchNumbers(w1, job.id))).toEqual([1, 2, 3]);
    const batch1 = await inWs(w1, () => staging.loadBatch(w1, job.id, 1));
    expect(batch1.map((r) => r.id)).toEqual([ids[0], ids[1]]);

    const t1 = randomUUID();
    const t2 = randomUUID();
    await inWs(w1, () =>
      staging.markPersisted(w1, [
        { rowId: ids[0]!, transactionId: t1 },
        { rowId: ids[1]!, transactionId: t2 },
      ]),
    );
    await inWs(w1, () => staging.markBatchFailed(w1, job.id, 2, { code: 'PERIOD_CLOSED' }));
    expect(await inWs(w1, () => staging.pendingBatchNumbers(w1, job.id))).toEqual([3]);
    expect(await inWs(w1, () => staging.failures(w1, job.id, 100))).toEqual([
      { code: 'PERIOD_CLOSED', count: 2, lines: [3, 4] },
    ]);
    expect(await inWs(w1, () => staging.failures(w1, job.id, 1))).toEqual([
      { code: 'PERIOD_CLOSED', count: 2, lines: [3] },
    ]);
    expect(await inWs(w1, () => staging.summary(w1, job.id))).toMatchObject({ created: 2, failed: 2 });
    expect(await inWs(w1, () => staging.dateRange(w1, job.id))).toEqual({
      from: '2026-10-01',
      to: '2026-10-02',
    });

    await inWs(w1, () => staging.clearFailures(w1, job.id));
    expect(await inWs(w1, () => staging.pendingBatchNumbers(w1, job.id))).toEqual([2, 3]);
    expect(await inWs(w1, () => staging.failures(w1, job.id, 100))).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-025] descartar el staging conserva los vínculos de idempotencia (FK ON DELETE SET NULL)', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const ids = await seedStaged(w1, job.id, 2);
    const txn = randomUUID();
    await inWs(w1, () =>
      links.insertMany(w1, [
        {
          id: randomUUID(),
          accountId: account,
          fingerprint: hex(200),
          transactionId: txn,
          stagedTransactionId: ids[0]!,
          kind: 'CREATED',
        },
      ]),
    );
    expect(await inWs(w1, () => staging.deleteAll(w1, job.id))).toBe(2);
    const found = await inWs(w1, () => links.findActive(w1, account, [hex(200)]));
    expect(found).toEqual([{ fingerprint: hex(200), transactionId: txn }]);
    const row = await inCtx(app, w1, (c) =>
      c.query(`SELECT staged_transaction_id FROM imports.row_link WHERE transaction_id = $1`, [txn]),
    );
    expect(row.rows[0]).toEqual({ staged_transaction_id: null });
  });
});

describe('PgRowLinkRepository (INV-014)', () => {
  it('[TC-IMPORTS-CSV-016] una huella ACTIVA por cuenta: el segundo insert se ignora; superado, la huella queda libre', async () => {
    const fp = hex(150);
    const first = randomUUID();
    const second = randomUUID();
    const insert = (txn: string) =>
      inWs(w1, () =>
        links.insertMany(w1, [
          {
            id: randomUUID(),
            accountId: account,
            fingerprint: fp,
            transactionId: txn,
            stagedTransactionId: null,
            kind: 'CREATED',
          },
        ]),
      );
    await insert(first);
    await insert(second);
    expect(await inWs(w1, () => links.findActive(w1, account, [fp, hex(151)]))).toEqual([
      { fingerprint: fp, transactionId: first },
    ]);
    expect(await inWs(w1, () => links.linkedTransactionIds(w1, account, [first, second]))).toEqual(
      new Set([first]),
    );

    await inWs(w1, () => links.supersede(w1, account, [fp], '2026-10-21T00:00:00.000Z'));
    expect(await inWs(w1, () => links.findActive(w1, account, [fp]))).toEqual([]);
    await insert(second);
    expect(await inWs(w1, () => links.findActive(w1, account, [fp]))).toEqual([
      { fingerprint: fp, transactionId: second },
    ]);
    // Otra cuenta puede usar la misma huella (la clave es workspace + cuenta + huella).
    await inWs(w1, () =>
      links.insertMany(w1, [
        {
          id: randomUUID(),
          accountId: randomUUID(),
          fingerprint: fp,
          transactionId: randomUUID(),
          stagedTransactionId: null,
          kind: 'CREATED',
        },
      ]),
    );
    expect(await inWs(w1, () => links.findActive(w1, account, [fp]))).toHaveLength(1);
  });

  it('inserta 1 500 vínculos en chunks y los encuentra todos', async () => {
    const acct = randomUUID();
    const many = Array.from({ length: 1500 }, (_, i) => ({
      id: randomUUID(),
      accountId: acct,
      fingerprint: `${(i + 1000).toString(16).padStart(64, '0')}`,
      transactionId: randomUUID(),
      stagedTransactionId: null,
      kind: 'CREATED' as const,
    }));
    await inWs(w1, () => links.insertMany(w1, many));
    const found = await inWs(w1, () =>
      links.findActive(
        w1,
        acct,
        many.map((m) => m.fingerprint),
      ),
    );
    expect(found).toHaveLength(1500);
  }, 30_000);
});

describe('RLS, permisos y catálogo de purga', () => {
  it('un job y su staging de otro workspace son inexistentes; sin contexto la consulta falla (PF002)', async () => {
    const job = newJob(w2);
    await inWs(w2, () => jobs.insert(job));
    await seedStaged(w2, job.id, 2);
    expect(await inWs(w1, () => jobs.findById(w1, job.id))).toBeNull();
    expect(await inWs(w1, () => jobs.findById(w2, job.id))).toBeNull();
    expect(await inWs(w1, () => staging.summary(w1, job.id))).toMatchObject({ rows: 0 });
    // Insertar con un workspace distinto al del contexto lo rechaza la política (WITH CHECK).
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(
            `INSERT INTO imports.row_link (id, workspace_id, account_id, fingerprint, transaction_id, kind)
             VALUES ($1, $2, $3, decode($4, 'hex'), $5, 'CREATED')`,
            [randomUUID(), w2, account, hex(7), randomUUID()],
          ),
        ),
      ),
    ).toBe('42501');
    const noContext = await sqlState(async () => {
      const c = await app.connect();
      try {
        await c.query('SELECT count(*) FROM imports.import_job');
      } finally {
        c.release();
      }
    });
    expect(noContext).toBe('PF002');
  });

  it('pf_app no puede borrar jobs ni vínculos; sí el staging; pf_worker hereda los permisos de pf_app', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) => c.query(`DELETE FROM imports.import_job WHERE id = $1`, [job.id])),
      ),
    ).toBe('42501');
    expect(await sqlState(() => inCtx(app, w1, (c) => c.query(`DELETE FROM imports.row_link`)))).toBe(
      '42501',
    );
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`DELETE FROM imports.staged_transaction WHERE import_job_id = $1`, [job.id]),
        ),
      ),
    ).toBeUndefined();
    // El worker lee y actualiza con el contexto del workspace (miembro de pf_app).
    const seen = await inCtx(worker, w1, (c) =>
      c.query(`SELECT status FROM imports.import_job WHERE id = $1`, [job.id]),
    );
    expect(seen.rows).toEqual([{ status: 'AWAITING_MAPPING' }]);
  });

  it('los CHECK de estado y de dirección rechazan valores fuera de catálogo', async () => {
    const job = newJob(w1);
    await inWs(w1, () => jobs.insert(job));
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE imports.import_job SET status = 'PARSING' WHERE id = $1`, [job.id]),
        ),
      ),
    ).toBe('23514');
    const [row] = await seedStaged(w1, job.id, 1);
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE imports.staged_transaction SET direction = 'SIDEWAYS' WHERE id = $1`, [row]),
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE imports.staged_transaction SET decision = 'MERGE' WHERE id = $1`, [row]),
        ),
      ),
    ).toBe('23514');
  });

  it('las tres tablas están registradas para la purga del workspace demo, hijas antes que padres', async () => {
    const { rows } = await migrator.query<{ table_name: string; purge_order: number }>(
      `SELECT table_name, purge_order FROM platform.workspace_scoped_table WHERE schema_name = 'imports' ORDER BY purge_order`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(['row_link', 'staged_transaction', 'import_job']);
  });
});
