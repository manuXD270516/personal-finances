import { describe, expect, it } from 'vitest';
import type { CsvMapping } from './csv-mapping.js';
import { EMPTY_COUNTERS, IMPORT_JOB_LIFECYCLE, ImportJob } from './import-job.js';
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
const EXPIRES = '2026-11-19T14:00:00.000Z';

export function documentJob(): ImportJob {
  return ImportJob.createFromDocument({
    id: 'j2',
    workspaceId: 'w1',
    accountId: 'a1',
    createdBy: 'u1',
    now: NOW,
    documentId: 'd1',
    format: 'OFX',
    originalName: 'extracto.ofx',
    fileChecksum: 'cd'.repeat(32),
    fileSizeBytes: 900,
    warnings: [],
    mappingProfile: null,
  });
}
function processingJob(): ImportJob {
  const job = documentJob();
  job.beginProcessing(NOW);
  return job;
}

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

function completedJob(): ImportJob {
  const j = persisting();
  j.finish({ failed: 0, errors: [], now: NOW });
  return j;
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};

describe('ImportJob (pipeline de documentos)', () => {
  it('[TC-IMPORTS-PIPELINE-007] el job de documento informa etapa y filas procesadas mientras se procesa', () => {
    const job = documentJob();
    expect(job.state).toMatchObject({
      status: 'UPLOADED',
      documentId: 'd1',
      source: 'FILE_OFX',
      format: 'OFX',
    });
    expect(job.lastTransition).toEqual({ transition: 'CREATE_FROM_DOCUMENT', from: null, to: 'UPLOADED' });
    job.beginProcessing(NOW);
    expect(job.lastTransition).toEqual({ transition: 'START', from: 'UPLOADED', to: 'PROCESSING' });
    job.checkpoint({ stage: 'NORMALIZE', processedRows: 1000, totalRows: 3000, now: NOW });
    expect(job.state.status).toBe('PROCESSING');
    expect(job.state.progress).toMatchObject({ stage: 'NORMALIZE', processedRows: 1000, totalRows: 3000 });
    expect(job.lastTransition).toBeNull();
    job.readyForReview({
      counters,
      rowCount: 3000,
      statement: null,
      rulesSummary: null,
      expiresAt: EXPIRES,
      now: NOW,
    });
    expect(job.state).toMatchObject({ status: 'AWAITING_REVIEW', rowCount: 3000, expiresAt: EXPIRES });
    expect(job.state.progress.stage).toBeNull();
  });

  it('beginProcessing es idempotente en PROCESSING y no actúa en otros estados', () => {
    const job = processingJob();
    const version = job.state.version;
    expect(job.beginProcessing(NOW)).toBe(true);
    expect(job.state.version).toBe(version);
    expect(inReview().beginProcessing(NOW)).toBe(false);
  });

  it('[TC-IMPORTS-PIPELINE-009] un error estructural deja PARSE_FAILED con código y ubicación', () => {
    const job = processingJob();
    job.failParse({ failure: { code: 'IMPORT_PARSE_FAILED', pointer: 'line:14' }, now: NOW });
    expect(job.state).toMatchObject({
      status: 'PARSE_FAILED',
      failure: { code: 'IMPORT_PARSE_FAILED', pointer: 'line:14' },
    });
    expect(codeOf(() => job.cancel({ actor: USER, now: NOW }))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-IMPORTS-PIPELINE-010] cancelar durante el procesamiento deja la importación cancelada', () => {
    const job = processingJob();
    job.cancel({ actor: USER, now: NOW });
    expect(job.state).toMatchObject({ status: 'CANCELLED', cancelledBy: USER });
    expect(job.lastTransition).toMatchObject({ transition: 'CANCEL', from: 'PROCESSING', to: 'CANCELLED' });
  });

  it('un job de documento esperando mapeo reprocesa al aplicar el mapeo (AWAITING_MAPPING → PROCESSING)', () => {
    const job = processingJob();
    job.awaitMapping({
      help: { profileCandidates: [], missingColumns: ['Monto'], needs: [] },
      rowCount: 10,
      columnCount: 3,
      header: ['Fecha', 'Descripción', 'Importe'],
      encoding: 'utf-8',
      delimiter: ';',
      statement: null,
      expiresAt: EXPIRES,
      now: NOW,
    });
    expect(job.state).toMatchObject({
      status: 'AWAITING_MAPPING',
      mappingHelp: { missingColumns: ['Monto'] },
    });
    job.applyMapping({ mapping: MAPPING, counters, now: NOW, profile: { id: 'p1', version: 2 } });
    expect(job.state).toMatchObject({
      status: 'PROCESSING',
      mappingProfile: { id: 'p1', version: 2 },
      mappingHelp: null,
      expiresAt: null,
    });
    expect(job.state.progress.stage).toBe('NORMALIZE');
  });

  it('[TC-IMPORTS-PIPELINE-058] con diferencia contra el extracto termina COMPLETED_WITH_DIFFERENCE', () => {
    const job = persisting();
    const status = job.finish({
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
    expect(status).toBe('COMPLETED_WITH_DIFFERENCE');
    expect(job.state.reconciliation?.difference).toBe('18.00');
    expect(job.lastTransition?.transition).toBe('COMPLETE_WITH_DIFFERENCE');
  });

  it('[TC-IMPORTS-PIPELINE-059] deshacer: COMPLETED → REVERTING → ROLLED_BACK, con actor y resumen', () => {
    const job = completedJob();
    job.requestRevert({ userId: 'ana', allowPartial: false, requested: 3, blocked: 0, now: NOW });
    expect(job.state.status).toBe('REVERTING');
    job.recordRevertBatch({ voided: 2, alreadyVoided: 0, now: NOW });
    job.recordRevertBatch({ voided: 1, alreadyVoided: 0, now: NOW });
    expect(job.finishRevert({ blocked: 0, now: NOW })).toBe('ROLLED_BACK');
    expect(job.state).toMatchObject({
      revertedBy: 'ana',
      revertedAt: NOW,
      revert: { voided: 3, blocked: 0, requested: 3 },
    });
  });

  it('[TC-IMPORTS-PIPELINE-061] con bloqueadas el deshacer parcial termina PARTIALLY_ROLLED_BACK y puede repetirse', () => {
    const job = completedJob();
    job.requestRevert({ userId: 'ana', allowPartial: true, requested: 2, blocked: 1, now: NOW });
    job.recordRevertBatch({ voided: 2, alreadyVoided: 0, now: NOW });
    expect(job.finishRevert({ blocked: 1, now: NOW })).toBe('PARTIALLY_ROLLED_BACK');
    job.requestRevert({ userId: 'ana', allowPartial: true, requested: 1, blocked: 0, now: NOW });
    expect(job.state.status).toBe('REVERTING');
  });

  it('[TC-IMPORTS-PIPELINE-071] aprobar una importación deshecha es INVALID_STATUS_TRANSITION y no cambia nada', () => {
    const job = completedJob();
    job.requestRevert({ userId: 'ana', allowPartial: false, requested: 3, blocked: 0, now: NOW });
    job.finishRevert({ blocked: 0, now: NOW });
    const before = job.state;
    expect(codeOf(() => job.approve({ userId: 'u', now: NOW, batchCount: 1 }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(job.state).toBe(before);
  });

  it('la máquina IMPORT_JOB_LIFECYCLE declara todos los estados del job', () => {
    const codes = IMPORT_JOB_LIFECYCLE.definition.states.map((st) => st.code).sort();
    expect(codes).toEqual([...IMPORT_STATUSES].sort());
  });
});

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
      UPLOADED: documentJob,
      PROCESSING: processingJob,
      PARSE_FAILED: () => {
        const j = processingJob();
        j.failParse({ failure: { code: 'IMPORT_PARSE_FAILED', pointer: 'x' }, now: NOW });
        return j;
      },
      COMPLETED_WITH_DIFFERENCE: () => {
        const j = persisting();
        j.finish({
          failed: 0,
          errors: [],
          now: NOW,
          reconciliation: {
            outcome: 'DIFFERENCE',
            statementBalance: '1.00',
            accountBalance: '0.00',
            difference: '1.00',
            statementDate: '2026-03-31',
          },
        });
        return j;
      },
      REVERTING: () => {
        const j = completedJob();
        j.requestRevert({ userId: 'u1', allowPartial: false, requested: 3, blocked: 0, now: NOW });
        return j;
      },
      ROLLED_BACK: () => {
        const j = build.REVERTING();
        j.finishRevert({ blocked: 0, now: NOW });
        return j;
      },
      PARTIALLY_ROLLED_BACK: () => {
        const j = build.REVERTING();
        j.finishRevert({ blocked: 1, now: NOW });
        return j;
      },
    };
    const actions: Record<string, [(j: ImportJob) => void, ImportStatus[]]> = {
      applyMapping: [
        (j) => j.applyMapping({ mapping: MAPPING, counters, now: NOW }),
        ['AWAITING_MAPPING', 'AWAITING_REVIEW'],
      ],
      approve: [(j) => j.approve({ userId: 'u', now: NOW, batchCount: 1 }), ['AWAITING_REVIEW']],
      cancel: [
        (j) => j.cancel({ actor: USER, now: NOW }),
        ['UPLOADED', 'PROCESSING', 'AWAITING_MAPPING', 'AWAITING_REVIEW'],
      ],
      beginPersisting: [(j) => j.beginPersisting(NOW), ['APPROVED', 'PERSISTING']],
      recordBatch: [(j) => j.recordBatch({ created: 1, now: NOW }), ['PERSISTING']],
      finish: [(j) => void j.finish({ failed: 0, errors: [], now: NOW }), ['PERSISTING']],
      retry: [(j) => j.retry(NOW), ['PARTIALLY_FAILED']],
      acceptErrors: [(j) => j.acceptErrors(NOW), ['PARTIALLY_FAILED']],
      failParse: [
        (j) => j.failParse({ failure: { code: 'IMPORT_PARSE_FAILED', pointer: null }, now: NOW }),
        ['UPLOADED', 'PROCESSING'],
      ],
      requestRevert: [
        (j) => j.requestRevert({ userId: 'u', allowPartial: false, requested: 1, blocked: 0, now: NOW }),
        ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_ROLLED_BACK'],
      ],
      finishRevert: [(j) => void j.finishRevert({ blocked: 0, now: NOW }), ['REVERTING']],
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
