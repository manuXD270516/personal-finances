import { describe, expect, it } from 'vitest';
import type { CsvMapping } from './csv-mapping.js';
import { EMPTY_COUNTERS, ImportJob } from './import-job.js';
import { IMPORT_STATUSES, type ImportStatus } from './types.js';

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
const NOW = '2026-10-20T14:00:00.000Z';
const USER = { type: 'USER', userId: 'u1' } as const;

function newJob(): ImportJob {
  return ImportJob.create({
    id: 'j1',
    workspaceId: 'w1',
    accountId: 'a1',
    createdBy: 'u1',
    now: NOW,
    originalName: 'extracto.csv',
    fileChecksum: 'ab'.repeat(32),
    fileSizeBytes: 100,
    encoding: 'windows-1252',
    delimiter: ';',
    rowCount: 4,
    columnCount: 3,
    header: ['Fecha', 'Descripción', 'Monto'],
    warnings: [],
    expiresAt: '2026-11-19T14:00:00.000Z',
  });
}
const counters = { ...EMPTY_COUNTERS, rows: 4, newRows: 4, toCreate: 4 };

function inReview(): ImportJob {
  const job = newJob();
  job.applyMapping({ mapping: MAPPING, counters, now: NOW });
  return job;
}
function persisting(): ImportJob {
  const job = inReview();
  job.approve({ userId: 'u1', now: NOW, batchCount: 3 });
  job.beginPersisting(NOW);
  return job;
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};

describe('ImportJob', () => {
  it('nace esperando mapeo, con expiración y versión 1', () => {
    const s = newJob().state;
    expect(s.status).toBe('AWAITING_MAPPING');
    expect(s.expiresAt).toBe('2026-11-19T14:00:00.000Z');
    expect(s.version).toBe(1);
    expect(s.counters.rows).toBe(4);
  });

  it('[TC-IMPORTS-CSV-006] el mapeo lleva a revisión y puede volver a enviarse', () => {
    const job = inReview();
    expect(job.state.status).toBe('AWAITING_REVIEW');
    job.applyMapping({ mapping: { ...MAPPING, dateFormat: 'MM/dd/yyyy' }, counters, now: NOW });
    expect(job.state.mapping?.dateFormat).toBe('MM/dd/yyyy');
    expect(job.state.version).toBe(3);
  });

  it('el flujo feliz: aprobar, persistir por lotes y completar', () => {
    const job = persisting();
    expect(job.state.status).toBe('PERSISTING');
    expect(job.state.expiresAt).toBeNull();
    expect(job.state.approvedBy).toBe('u1');
    job.recordBatch({ created: 200, now: NOW });
    expect(job.state.progress).toEqual({ attempt: 1, batchCount: 3, batchesDone: 1 });
    job.recordBatch({ created: 200, alreadyExisting: 3, now: NOW });
    job.recordBatch({ created: 47, now: NOW });
    expect(job.finish({ failed: 0, errors: [], now: NOW })).toBe('COMPLETED');
    expect(job.state.completedAt).toBe(NOW);
    expect(job.state.counters).toMatchObject({ created: 447, alreadyImported: 3 });
    expect(job.state.progress.batchesDone).toBe(3);
  });

  it('[TC-IMPORTS-CSV-024] con filas fallidas termina parcial; reintentar vuelve a persistir; aceptar cierra con errores', () => {
    const job = persisting();
    job.recordBatch({ created: 250, now: NOW });
    const errors = [{ code: 'PERIOD_CLOSED', count: 200, lines: [3, 4] }];
    expect(job.finish({ failed: 200, errors, now: NOW })).toBe('PARTIALLY_FAILED');
    expect(job.state.errors).toEqual(errors);
    expect(job.state.completedAt).toBeNull();

    job.retry(NOW);
    expect(job.state.status).toBe('PERSISTING');
    expect(job.state.progress.attempt).toBe(2);
    expect(job.state.errors).toEqual([]);
    expect(job.finish({ failed: 0, errors: [], now: NOW })).toBe('COMPLETED');

    const other = persisting();
    other.recordBatch({ created: 250, now: NOW });
    other.finish({ failed: 200, errors, now: NOW });
    other.acceptErrors(NOW);
    expect(other.state.status).toBe('COMPLETED_WITH_ERRORS');
    expect(other.state.counters).toMatchObject({ created: 250, failed: 200 });
    expect(other.state.completedAt).toBe(NOW);
  });

  it('[TC-IMPORTS-CSV-025] cancelar en espera o revisión funciona; aprobada o terminada es INVALID_STATUS_TRANSITION', () => {
    const waiting = newJob();
    waiting.cancel({ actor: USER, now: NOW });
    expect(waiting.state).toMatchObject({ status: 'CANCELLED', cancelledBy: USER, expiresAt: null });

    const review = inReview();
    review.cancel({ actor: { type: 'SYSTEM' }, now: NOW });
    expect(review.state.cancelledBy).toEqual({ type: 'SYSTEM' });

    const approved = inReview();
    approved.approve({ userId: 'u1', now: NOW, batchCount: 1 });
    expect(codeOf(() => approved.cancel({ actor: USER, now: NOW }))).toBe('INVALID_STATUS_TRANSITION');

    const done = persisting();
    done.finish({ failed: 0, errors: [], now: NOW });
    expect(codeOf(() => done.cancel({ actor: USER, now: NOW }))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('re-entregar el evento de aprobación en PERSISTING es idempotente', () => {
    const job = persisting();
    const version = job.state.version;
    job.beginPersisting(NOW);
    expect(job.state.version).toBe(version);
  });

  it('matriz: solo las transiciones del subconjunto son válidas', () => {
    const build: Record<ImportStatus, () => ImportJob> = {
      AWAITING_MAPPING: newJob,
      AWAITING_REVIEW: inReview,
      APPROVED: () => {
        const j = inReview();
        j.approve({ userId: 'u1', now: NOW, batchCount: 1 });
        return j;
      },
      PERSISTING: persisting,
      COMPLETED: () => {
        const j = persisting();
        j.finish({ failed: 0, errors: [], now: NOW });
        return j;
      },
      PARTIALLY_FAILED: () => {
        const j = persisting();
        j.finish({ failed: 1, errors: [], now: NOW });
        return j;
      },
      COMPLETED_WITH_ERRORS: () => {
        const j = build.PARTIALLY_FAILED();
        j.acceptErrors(NOW);
        return j;
      },
      CANCELLED: () => {
        const j = newJob();
        j.cancel({ actor: USER, now: NOW });
        return j;
      },
    };
    const actions: Record<string, [(j: ImportJob) => void, ImportStatus[]]> = {
      applyMapping: [
        (j) => j.applyMapping({ mapping: MAPPING, counters, now: NOW }),
        ['AWAITING_MAPPING', 'AWAITING_REVIEW'],
      ],
      approve: [(j) => j.approve({ userId: 'u', now: NOW, batchCount: 1 }), ['AWAITING_REVIEW']],
      cancel: [(j) => j.cancel({ actor: USER, now: NOW }), ['AWAITING_MAPPING', 'AWAITING_REVIEW']],
      beginPersisting: [(j) => j.beginPersisting(NOW), ['APPROVED', 'PERSISTING']],
      recordBatch: [(j) => j.recordBatch({ created: 1, now: NOW }), ['PERSISTING']],
      finish: [(j) => void j.finish({ failed: 0, errors: [], now: NOW }), ['PERSISTING']],
      retry: [(j) => j.retry(NOW), ['PARTIALLY_FAILED']],
      acceptErrors: [(j) => j.acceptErrors(NOW), ['PARTIALLY_FAILED']],
    };
    for (const [name, [run, allowed]] of Object.entries(actions)) {
      for (const status of IMPORT_STATUSES) {
        const outcome = codeOf(() => run(build[status]()));
        expect(outcome, `${name} desde ${status}`).toBe(
          allowed.includes(status) ? 'OK' : 'INVALID_STATUS_TRANSITION',
        );
      }
    }
  });

  it('markPersisted alinea la versión persistida con la del agregado', () => {
    const job = inReview();
    expect(job.persistedVersion).toBe(0);
    job.markPersisted();
    expect(job.persistedVersion).toBe(job.state.version);
    expect(ImportJob.rehydrate(job.state).persistedVersion).toBe(job.state.version);
  });
});
