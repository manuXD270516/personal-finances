import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PipelineRowResult, StagedInsert } from '../../src/application/ports/index.js';
import { ImportJob, MappingProfile } from '../../src/domain/index.js';
import {
  PgImportJobRepository,
  PgImportsUnitOfWork,
  PgRowLinkRepository,
  PgStagingRepository,
} from '../../src/infrastructure/pg-imports.js';
import { PgMappingProfileRepository } from '../../src/infrastructure/pg-mapping-profiles.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// Capa PostgreSQL del pipeline de Phase 6 (openspec add-import-pipeline, tarea 5.1): columnas nuevas del job, staging por
// bloques y reanudable, edición en lote por SQL, vínculos con identificador externo, perfiles de mapeo (RLS y permisos).
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgImportsUnitOfWork;
const jobs = new PgImportJobRepository();
const staging = new PgStagingRepository();
const links = new PgRowLinkRepository();
const profiles = new PgMappingProfileRepository();
const account = randomUUID();
const institution = randomUUID();
const NOW = '2026-10-20T14:00:00.000Z';

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

async function inCtx<T>(pool: Pool, workspaceId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      workspaceId,
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

const documentJob = (workspaceId: string) =>
  ImportJob.createFromDocument({
    id: randomUUID(),
    workspaceId,
    accountId: account,
    createdBy: user,
    now: NOW,
    documentId: randomUUID(),
    format: 'OFX',
    originalName: 'extracto.ofx',
    fileChecksum: 'ab'.repeat(32),
    fileSizeBytes: 900,
    warnings: [],
    mappingProfile: null,
  });

const hex = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

const insertRecord = (i: number, over: Partial<NonNullable<StagedInsert['record']>> = {}): StagedInsert => ({
  id: randomUUID(),
  rowNumber: i,
  raw: [],
  record: {
    bookingDate: '2026-03-01',
    bookingTime: '14:05:00',
    valueDate: '2026-03-02',
    signedAmount: i % 2 === 0 ? '-18.00' : '1500.50',
    currency: null,
    description: `MOVIMIENTO ${i}`,
    externalId: `FIT-${i}`,
    reference: `REF-${i}`,
    counterpartyText: 'SUPERMERCADO',
    runningBalance: '1019.32',
    issues: [],
    ...over,
  },
});

const result = (id: string, over: Partial<PipelineRowResult> = {}): PipelineRowResult => ({
  id,
  bookingDate: '2026-03-01',
  bookingTime: null,
  valueDate: null,
  amount: '18.00',
  currency: 'BOB',
  direction: 'OUT',
  description: 'COMPRA',
  externalId: null,
  reference: null,
  counterpartyText: null,
  runningBalance: null,
  occurrenceIndex: 0,
  fingerprint: hex(1),
  classification: 'NEW',
  decision: 'CREATE',
  issues: [],
  matchedTransactionId: null,
  proposal: null,
  candidates: [],
  occurrenceCandidates: [],
  duplicateOfRow: null,
  decidedScore: null,
  warnings: [],
  kind: 'EXPENSE',
  ...over,
});

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgImportsUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/pipe', $1, $2, 'U1') AS id`,
    [`sub-pipe-${randomUUID()}`, `pipe-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Pipe', 'BOB', 'America/La_Paz', 'es-BO')`,
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
});

describe('PgImportJobRepository (pipeline)', () => {
  it('[TC-IMPORTS-PIPELINE-004] ida y vuelta de un job de documento con las columnas nuevas', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    job.markPersisted();
    const loaded = (await inWs(w1, () => jobs.findById(w1, job.id)))!;
    expect(loaded.state).toEqual(job.state);
    expect(loaded.state).toMatchObject({ status: 'UPLOADED', source: 'FILE_OFX', format: 'OFX' });

    loaded.beginProcessing(NOW);
    loaded.checkpoint({ stage: 'DEDUPE', processedRows: 2000, totalRows: 3000, now: NOW });
    loaded.readyForReview({
      counters: {
        rows: 3000,
        newRows: 3000,
        alreadyImported: 0,
        probableDuplicates: 0,
        invalid: 0,
        toCreate: 3000,
        skipped: 0,
        excluded: 0,
        created: 0,
        failed: 0,
      },
      rowCount: 3000,
      statement: {
        openingBalance: null,
        closingBalance: '1019.32',
        closingDate: '2026-03-31',
        periodFrom: null,
        periodTo: '2026-03-31',
      },
      rulesSummary: {
        rows: 3000,
        classifiedByRule: 0,
        withoutCategory: 3000,
        ratio: '0.0000',
        rulesUnavailable: true,
      },
      expiresAt: '2026-11-19T14:00:00.000Z',
      now: NOW,
    });
    expect(await inWs(w1, () => jobs.save(loaded))).toBe(true);
    const after = (await inWs(w1, () => jobs.findById(w1, job.id)))!;
    expect(after.state).toMatchObject({
      status: 'AWAITING_REVIEW',
      statement: { closingBalance: '1019.32', closingDate: '2026-03-31' },
      rulesSummary: { rulesUnavailable: true },
    });
    expect(after.state.progress).toMatchObject({ stage: null, processedRows: 3000 });
  });

  it('[TC-IMPORTS-PIPELINE-009] falla de lectura, reconciliación y deshacer se guardan y se leen', async () => {
    const failed = documentJob(w1);
    failed.beginProcessing(NOW);
    failed.failParse({ failure: { code: 'IMPORT_PARSE_FAILED', pointer: '/movements/1/amount' }, now: NOW });
    await inWs(w1, () => jobs.insert(failed));
    failed.markPersisted();
    expect((await inWs(w1, () => jobs.findById(w1, failed.id)))!.state).toEqual(failed.state);

    const done = documentJob(w1);
    done.beginProcessing(NOW);
    done.readyForReview({
      counters: {
        rows: 1,
        newRows: 1,
        alreadyImported: 0,
        probableDuplicates: 0,
        invalid: 0,
        toCreate: 1,
        skipped: 0,
        excluded: 0,
        created: 0,
        failed: 0,
      },
      rowCount: 1,
      statement: null,
      rulesSummary: null,
      expiresAt: '2026-11-19T14:00:00.000Z',
      now: NOW,
    });
    done.approve({ userId: user, now: NOW, batchCount: 1 });
    done.beginPersisting(NOW);
    done.finish({
      failed: 0,
      errors: [],
      now: NOW,
      reconciliation: {
        outcome: 'DIFFERENCE',
        statementBalance: '1019.32',
        accountBalance: '1001.32',
        difference: '18.00',
        statementDate: '2026-03-31',
      },
    });
    done.requestRevert({ userId: user, allowPartial: true, requested: 1, blocked: 0, now: NOW });
    done.recordRevertBatch({ voided: 1, alreadyVoided: 0, now: NOW });
    done.finishRevert({ blocked: 0, now: '2026-10-21T10:00:00.000Z' });
    await inWs(w1, () => jobs.insert(done));
    done.markPersisted();
    const loaded = (await inWs(w1, () => jobs.findById(w1, done.id)))!;
    expect(loaded.state).toEqual(done.state);
    expect(loaded.state).toMatchObject({
      status: 'ROLLED_BACK',
      revertedBy: user,
      reconciliation: { outcome: 'DIFFERENCE', difference: '18.00' },
    });
  });

  it('purgeable incluye ROLLED_BACK y PARSE_FAILED con staging; expiredReviews solo AWAITING_*', async () => {
    const failed = documentJob(w1);
    failed.beginProcessing(NOW);
    failed.failParse({ failure: { code: 'IMPORT_PARSE_FAILED', pointer: null }, now: NOW });
    await inWs(w1, () => jobs.insert(failed));
    await inWs(w1, () => staging.insertRecords(w1, failed.id, [insertRecord(1)]));
    expect(await inWs(w1, () => jobs.purgeable(w1, '2026-12-31T00:00:00.000Z', 100))).toContain(failed.id);
    expect(await inWs(w1, () => jobs.expiredReviews(w1, '2027-12-31T00:00:00.000Z', 100))).not.toContain(
      failed.id,
    );
  });
});

describe('PgStagingRepository (pipeline)', () => {
  it('[TC-IMPORTS-PIPELINE-008] insertRecords es reanudable: reinsertar un bloque no duplica filas', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = Array.from({ length: 5 }, (_, i) => insertRecord(i + 1));
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows.slice(0, 3)));
    // Reanudación: el bloque se reenvía completo con ids nuevos para las ya insertadas.
    await inWs(w1, () =>
      staging.insertRecords(
        w1,
        job.id,
        rows.map((r) => ({ ...r, id: randomUUID() })),
      ),
    );
    expect(await inWs(w1, () => staging.countRows(w1, job.id))).toBe(5);
    const all = await inWs(w1, () => staging.loadAll(w1, job.id));
    expect(all.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(all[0]).toMatchObject({
      externalId: 'FIT-1',
      bookingTime: '14:05:00',
      valueDate: '2026-03-02',
      reference: 'REF-1',
      counterpartyText: 'SUPERMERCADO',
      runningBalance: '1019.32',
      direction: 'IN',
      amount: expect.stringMatching(/^1500\.5/),
      edits: {},
      candidates: [],
      classification: null,
    });
    expect(all[1]).toMatchObject({ direction: 'OUT' });
  });

  it('applyPipeline escribe candidatos, propuesta y preselección; loadAll los devuelve', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = [insertRecord(1), insertRecord(2)];
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    const matched = randomUUID();
    const candidate = {
      transactionId: matched,
      kind: 'EXPENSE',
      date: '2026-02-28',
      amount: { amount: '18.00', currency: 'BOB' },
      description: 'MOVIMIENTO 2',
      score: '0.9000',
      confidence: 'HIGH' as const,
      signals: { amount: '0.4', date: '0.2', description: '0.2', counterparty: '0.05', origin: '0.05' },
      preselected: true,
    };
    await inWs(w1, () =>
      staging.applyPipeline(
        w1,
        job.id,
        [
          result(rows[0]!.id, {
            externalId: 'FIT-1',
            proposal: {
              category: { value: 'cat-1', origin: { type: 'RULE', ruleId: 'r1', ruleVersion: 2 } },
              counterparty: null,
              tags: null,
              description: null,
              notes: null,
              needsReview: null,
              exclude: null,
              rulesUnavailable: false,
            },
          }),
          result(rows[1]!.id, {
            classification: 'DUPLICATE_PROBABLE',
            decision: 'SKIP',
            matchedTransactionId: matched,
            candidates: [candidate],
            decidedScore: '0.9000',
            fingerprint: hex(2),
            warnings: [{ code: 'IMPORT_RUNNING_BALANCE_GAP', severity: 'WARNING' }],
            occurrenceCandidates: [
              {
                occurrenceId: randomUUID(),
                definitionId: randomUUID(),
                definitionName: 'Internet',
                dueDate: '2026-03-01',
                score: '0.95',
                confidence: 'HIGH',
                ambiguous: false,
              },
            ],
          }),
        ],
        [],
      ),
    );
    const all = await inWs(w1, () => staging.loadAll(w1, job.id));
    expect(all[0]!.proposal?.category).toEqual({
      value: 'cat-1',
      origin: { type: 'RULE', ruleId: 'r1', ruleVersion: 2 },
    });
    expect(all[1]).toMatchObject({
      classification: 'DUPLICATE_PROBABLE',
      decision: 'SKIP',
      decidedScore: '0.9000',
      candidates: [candidate],
      warnings: [{ code: 'IMPORT_RUNNING_BALANCE_GAP' }],
      proposal: null,
    });
    const summary = await inWs(w1, () => staging.summary(w1, job.id));
    expect(summary).toMatchObject({ rows: 2, pendingDecisions: 0, toCreate: 1, skipped: 1 });
  });

  it('[TC-IMPORTS-PIPELINE-042] bulkEdit asigna la categoría a las filas filtradas en una sentencia y no toca las demás', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = Array.from({ length: 6 }, (_, i) => insertRecord(i + 1));
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    const withCategory = (id: string) =>
      result(id, {
        proposal: {
          category: { value: 'cat-rule', origin: { type: 'RULE', ruleId: 'r9', ruleVersion: 1 } },
          counterparty: null,
          tags: null,
          description: null,
          notes: null,
          needsReview: null,
          exclude: null,
          rulesUnavailable: false,
        },
      });
    await inWs(w1, () =>
      staging.applyPipeline(
        w1,
        job.id,
        rows.map((r, i) => (i < 2 ? withCategory(r.id) : result(r.id, { fingerprint: hex(i + 10) }))),
        [],
      ),
    );
    const need = await inWs(w1, () => staging.page(w1, job.id, { needsCategory: true, limit: 100 }));
    expect(need).toHaveLength(4);
    const byRule = await inWs(w1, () => staging.page(w1, job.id, { ruleId: 'r9', limit: 100 }));
    expect(byRule.map((r) => r.rowNumber)).toEqual([1, 2]);

    const updated = await inWs(w1, () =>
      staging.bulkEdit(
        w1,
        job.id,
        { needsCategory: true },
        { categoryId: 'cat-transporte', tagIds: ['t1'] },
        { userId: user, at: NOW },
      ),
    );
    expect(updated).toBe(4);
    const after = await inWs(w1, () => staging.loadAll(w1, job.id));
    expect(after.slice(0, 2).map((r) => r.edits)).toEqual([{}, {}]);
    expect(after.slice(2).every((r) => r.edits.categoryId === 'cat-transporte')).toBe(true);
    expect(after[2]!.edits.tagIds).toEqual(['t1']);
    expect(await inWs(w1, () => staging.page(w1, job.id, { needsCategory: true, limit: 100 }))).toEqual([]);
    // Un filtro de decisión + set de decisión (EXCLUDE) registra autor y momento.
    expect(
      await inWs(w1, () =>
        staging.bulkEdit(w1, job.id, { ruleId: 'r9' }, { decision: 'EXCLUDE' }, { userId: user, at: NOW }),
      ),
    ).toBe(2);
    const excluded = await inWs(w1, () => staging.page(w1, job.id, { decision: 'EXCLUDE', limit: 10 }));
    expect(excluded).toHaveLength(2);
    expect(excluded[0]).toMatchObject({ decidedBy: user, decidedAt: NOW });
  });

  it('[TC-IMPORTS-PIPELINE-039] applyProposals reescribe la propuesta y conserva las ediciones; applyEdit guarda origen manual', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = [insertRecord(1)];
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    await inWs(w1, () => staging.applyPipeline(w1, job.id, [result(rows[0]!.id)], []));
    await inWs(w1, () =>
      staging.applyEdit(w1, job.id, rows[0]!.id, {
        edits: { categoryId: 'cat-hogar', kind: 'EXPENSE' },
        kind: 'EXPENSE',
        decision: 'EXCLUDE',
        decidedBy: user,
        decidedAt: NOW,
        occurrenceLink: { occurrenceId: 'occ-1' },
      }),
    );
    await inWs(w1, () =>
      staging.applyProposals(w1, job.id, [
        {
          id: rows[0]!.id,
          proposal: {
            category: { value: 'cat-nueva', origin: { type: 'RULE', ruleId: 'r1', ruleVersion: 4 } },
            counterparty: null,
            tags: null,
            description: null,
            notes: null,
            needsReview: null,
            exclude: null,
            rulesUnavailable: false,
          },
          warnings: [],
        },
      ]),
    );
    const row = (await inWs(w1, () => staging.find(w1, job.id, rows[0]!.id)))!;
    expect(row.edits).toEqual({ categoryId: 'cat-hogar', kind: 'EXPENSE' });
    expect(row.proposal?.category?.value).toBe('cat-nueva');
    expect(row).toMatchObject({
      decision: 'EXCLUDE',
      kind: 'EXPENSE',
      decidedBy: user,
      occurrenceLink: { occurrenceId: 'occ-1' },
    });
  });

  it('[TC-IMPORTS-PIPELINE-050] confirmHighConfidenceMatches vincula solo las filas con un único candidato HIGH no ambiguo', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = Array.from({ length: 4 }, (_, i) => insertRecord(i + 1));
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    const cand = (confidence: string, ambiguous = false) => ({
      occurrenceId: randomUUID(),
      definitionId: randomUUID(),
      definitionName: 'Internet',
      dueDate: '2026-03-01',
      score: '0.9',
      confidence,
      ambiguous,
    });
    await inWs(w1, () =>
      staging.applyPipeline(
        w1,
        job.id,
        [
          result(rows[0]!.id, { occurrenceCandidates: [cand('HIGH')], fingerprint: hex(1) }),
          result(rows[1]!.id, { occurrenceCandidates: [cand('HIGH', true)], fingerprint: hex(2) }),
          result(rows[2]!.id, { occurrenceCandidates: [cand('HIGH'), cand('MEDIUM')], fingerprint: hex(3) }),
          result(rows[3]!.id, { occurrenceCandidates: [cand('MEDIUM')], fingerprint: hex(4) }),
        ],
        [],
      ),
    );
    expect(await inWs(w1, () => staging.confirmHighConfidenceMatches(w1, job.id))).toBe(1);
    const all = await inWs(w1, () => staging.loadAll(w1, job.id));
    expect(all.map((r) => r.occurrenceLink !== null)).toEqual([true, false, false, false]);

    await inWs(w1, () => staging.markOccurrenceOutcome(w1, [{ rowId: rows[0]!.id, outcome: 'SKIPPED' }]));
    const row = (await inWs(w1, () => staging.find(w1, job.id, rows[0]!.id)))!;
    expect(row.occurrenceLink?.outcome).toBe('SKIPPED');
    expect(row.warnings).toEqual([{ code: 'IMPORT_OCCURRENCE_LINK_SKIPPED', severity: 'WARNING' }]);
  });

  it('[TC-IMPORTS-PIPELINE-069] rulesCoverage cuenta las creadas con categoría fijada por regla (las editadas no suman)', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = Array.from({ length: 3 }, (_, i) => insertRecord(i + 1));
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    const proposal = {
      category: { value: 'c', origin: { type: 'RULE', ruleId: 'r', ruleVersion: 1 } },
      counterparty: null,
      tags: null,
      description: null,
      notes: null,
      needsReview: null,
      exclude: null,
      rulesUnavailable: false,
    } as const;
    await inWs(w1, () =>
      staging.applyPipeline(
        w1,
        job.id,
        [
          result(rows[0]!.id, { proposal, fingerprint: hex(1) }),
          result(rows[1]!.id, { proposal, fingerprint: hex(2) }),
          result(rows[2]!.id, { fingerprint: hex(3) }),
        ],
        [],
      ),
    );
    await inWs(w1, () =>
      staging.applyEdit(w1, job.id, rows[1]!.id, {
        edits: { categoryId: 'otra' },
        kind: null,
        decidedBy: user,
        decidedAt: NOW,
        occurrenceLink: null,
      }),
    );
    await inWs(w1, () =>
      staging.markPersisted(
        w1,
        rows.map((r) => ({ rowId: r.id, transactionId: randomUUID() })),
      ),
    );
    expect(await inWs(w1, () => staging.rulesCoverage(w1, job.id))).toEqual({
      created: 3,
      byRule: 1,
      withoutCategory: 1,
    });
  });
});

describe('PgRowLinkRepository (pipeline)', () => {
  it('[TC-IMPORTS-PIPELINE-052] vínculos por identificador externo, por job y superación al deshacer', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = [insertRecord(1), insertRecord(2)];
    await inWs(w1, () => staging.insertRecords(w1, job.id, rows));
    const tx = [randomUUID(), randomUUID()];
    await inWs(w1, () =>
      links.insertMany(w1, [
        {
          id: randomUUID(),
          accountId: account,
          fingerprint: hex(1),
          transactionId: tx[0]!,
          stagedTransactionId: rows[0]!.id,
          kind: 'CREATED',
          importJobId: job.id,
          externalRef: { namespace: 'imports.ext:OFX', id: 'FIT-1' },
        },
        {
          id: randomUUID(),
          accountId: account,
          fingerprint: hex(2),
          transactionId: tx[1]!,
          stagedTransactionId: rows[1]!.id,
          kind: 'SKIPPED_AS_DUPLICATE',
          importJobId: job.id,
        },
      ]),
    );
    expect(await inWs(w1, () => links.findActiveByExternal(w1, account, ['FIT-1', 'FIT-9']))).toEqual([
      { externalId: 'FIT-1', transactionId: tx[0] },
    ]);
    expect(await inWs(w1, () => links.findActiveByExternal(w1, randomUUID(), ['FIT-1']))).toEqual([]);
    const active = await inWs(w1, () => links.activeByJob(w1, job.id));
    expect(active.map((l) => [l.lineNumber, l.kind, l.bookingDate])).toEqual([
      [1, 'CREATED', '2026-03-01'],
      [2, 'SKIPPED_AS_DUPLICATE', '2026-03-01'],
    ]);
    expect(await inWs(w1, () => links.supersedeByJob(w1, job.id, NOW))).toBe(2);
    expect(await inWs(w1, () => links.activeByJob(w1, job.id))).toEqual([]);
    expect(await inWs(w1, () => links.findActiveByExternal(w1, account, ['FIT-1']))).toEqual([]);
  });
});

describe('PgMappingProfileRepository', () => {
  const options = (hasHeader = true) => ({
    mapping: {
      hasHeader,
      skipRows: 0,
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
      columns: {
        date: { index: 0, header: 'Fecha' },
        description: { index: 1, header: 'Detalle' },
        amount: { mode: 'SIGNED', index: 2, header: 'Monto', signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    },
  });

  const newProfile = (
    name: string,
    over: { accountId?: string | null; institutionId?: string | null } = {},
  ) =>
    MappingProfile.create({
      id: randomUUID(),
      workspaceId: w1,
      institutionId: over.institutionId === undefined ? institution : over.institutionId,
      accountId: over.accountId ?? null,
      name,
      format: 'CSV',
      options: options(),
      createdBy: user,
      now: NOW,
    });

  it('[TC-IMPORTS-PIPELINE-026] guarda versiones inmutables y devuelve la última para la coincidencia', async () => {
    const profile = newProfile(`Cumbre ${randomUUID()}`);
    await inWs(w1, () => profiles.insertVersion(profile.latest));
    const v2 = profile.newVersion({
      createdBy: user,
      now: '2026-10-21T10:00:00.000Z',
      options: options(false),
    });
    void v2;
    await inWs(w1, () => profiles.insertVersion(profile.latest));
    const versions = await inWs(w1, () => profiles.versionsOf(w1, profile.state.id));
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.options.mapping?.hasHeader).toBe(true);
    expect(versions[1]!.options.mapping?.hasHeader).toBe(false);

    const matching = await inWs(w1, () =>
      profiles.latestForMatching(w1, { accountId: account, institutionId: institution, format: 'CSV' }),
    );
    const mine = matching.filter((m) => m.id === profile.state.id);
    expect(mine.map((m) => m.version)).toEqual([2]);
    // Otra institución no la ve; formato distinto tampoco.
    expect(
      (
        await inWs(w1, () =>
          profiles.latestForMatching(w1, { accountId: account, institutionId: randomUUID(), format: 'CSV' }),
        )
      ).some((m) => m.id === profile.state.id),
    ).toBe(false);
    expect(
      (
        await inWs(w1, () =>
          profiles.latestForMatching(w1, { accountId: account, institutionId: institution, format: 'OFX' }),
        )
      ).some((m) => m.id === profile.state.id),
    ).toBe(false);
  });

  it('[TC-IMPORTS-PIPELINE-028] archivar afecta a todas las versiones: no se sugiere y list lo oculta salvo includeArchived', async () => {
    const profile = newProfile(`Archivable ${randomUUID()}`, { accountId: account });
    await inWs(w1, () => profiles.insertVersion(profile.latest));
    await inWs(w1, () => profiles.archive(w1, profile.state.id, NOW));
    expect(
      (
        await inWs(w1, () =>
          profiles.latestForMatching(w1, { accountId: account, institutionId: institution, format: 'CSV' }),
        )
      ).some((m) => m.id === profile.state.id),
    ).toBe(false);
    const visible = await inWs(w1, () => profiles.list(w1, { includeArchived: false, limit: 100 }));
    expect(visible.some((p) => p.id === profile.state.id)).toBe(false);
    const all = await inWs(w1, () => profiles.list(w1, { includeArchived: true, limit: 100 }));
    expect(all.find((p) => p.id === profile.state.id)?.archivedAt).toBe(NOW);
  });

  it('list pagina con cursor (updated_at DESC, id)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const p = newProfile(`Paginado ${i} ${randomUUID()}`, { institutionId: randomUUID() });
      await inWs(w1, () => profiles.insertVersion(p.latest));
    }
    const all = await inWs(w1, () => profiles.list(w1, { includeArchived: true, limit: 500 }));
    const firstPage = await inWs(w1, () => profiles.list(w1, { includeArchived: true, limit: 2 }));
    const last = firstPage.at(-1)!;
    const rest = await inWs(w1, () =>
      profiles.list(w1, { includeArchived: true, limit: 500, after: [last.updatedAt, last.id] }),
    );
    expect([...firstPage, ...rest].map((p) => p.id)).toEqual(all.map((p) => p.id));
  });

  it('RLS: otro workspace no ve los perfiles; sin contexto falla cerrado (PF002); pf_app solo actualiza archived_at y no borra', async () => {
    const profile = newProfile(`Aislado ${randomUUID()}`);
    await inWs(w1, () => profiles.insertVersion(profile.latest));
    expect(await inWs(w2, () => profiles.versionsOf(w2, profile.state.id))).toEqual([]);
    expect(await inWs(w2, () => profiles.versionsOf(w1, profile.state.id))).toEqual([]);

    const noContext = await sqlState(async () => {
      const c = await app.connect();
      try {
        await c.query('SELECT count(*) FROM imports.mapping_profile');
      } finally {
        c.release();
      }
    });
    expect(noContext).toBe('PF002');

    // Insertar con el workspace ajeno lo rechaza la política.
    expect(
      await sqlState(() =>
        inCtx(app, w2, (c) =>
          c.query(
            `INSERT INTO imports.mapping_profile (id, version, workspace_id, institution_id, name, format, options, created_by)
             VALUES ($1, 1, $2, $3, 'x', 'CSV', '{}'::jsonb, $4)`,
            [randomUUID(), w1, institution, user],
          ),
        ),
      ),
    ).toBe('42501');
    // UPDATE solo de archived_at; DELETE denegado.
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE imports.mapping_profile SET name = 'otro' WHERE id = $1`, [profile.state.id]),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE imports.mapping_profile SET archived_at = now() WHERE id = $1`, [profile.state.id]),
        ),
      ),
    ).toBeUndefined();
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`DELETE FROM imports.mapping_profile WHERE id = $1`, [profile.state.id]),
        ),
      ),
    ).toBe('42501');
  });

  it('el perfil exige institución o cuenta (CHECK) y está en el catálogo de purga', async () => {
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(
            `INSERT INTO imports.mapping_profile (id, version, workspace_id, name, format, options, created_by)
             VALUES ($1, 1, $2, 'sin destino', 'CSV', '{}'::jsonb, $3)`,
            [randomUUID(), w1, user],
          ),
        ),
      ),
    ).toBe('23514');
    const { rows } = await migrator.query<{ table_name: string }>(
      `SELECT table_name FROM platform.workspace_scoped_table WHERE schema_name = 'imports' AND table_name = 'mapping_profile'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('audit.lifecycle_state_divergences() se ejecuta con la rama de ImportJob', async () => {
    const job = documentJob(w1);
    await inWs(w1, () => jobs.insert(job));
    const rows = await inCtx(migrator, w1, async (c) => {
      const r = await c.query(`SELECT * FROM audit.lifecycle_state_divergences()`);
      return r.rows;
    });
    expect(Array.isArray(rows)).toBe(true);
  });
});
