import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, isDomainError } from '@pf/shared-kernel';
import { IMPORT_ROW_NAMESPACE } from '@pf/transactions/contracts';
import type { ImportJob } from '../domain/index.js';
import { publishCompleted } from './imports.service.js';
import type { ImportsDeps, StagedRow } from './ports/index.js';

export interface PersistOutcome {
  readonly status: 'SKIPPED' | 'DONE';
  readonly batches: number;
  readonly failedBatches: number;
}

/** Líneas del archivo que se listan por código de error en el job (el detalle completo queda en el staging). */
const ERROR_LINES_LIMIT = 100;

/**
 * `PersistImport` (consumidor `imports.persist` del worker; decisión 10 de add-basic-csv-import): crea las
 * transacciones de una importación aprobada por lotes. UN lote = UNA transacción de BD (`recordBatch` de
 * Transactions + staging + vínculos + progreso del job), independiente de la del consumidor, de modo que un error de
 * dominio (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`) revierte SOLO ese lote, se registra en sus filas y la persistencia
 * continúa. Un lote cuyas filas ya tienen transacción se salta, así que la caída del proceso o la re-entrega del
 * evento reanudan sin duplicar. Los errores transitorios (BD, red) se propagan: el consumidor reintenta con backoff.
 */
export class PersistImportService {
  constructor(private readonly deps: ImportsDeps) {}

  private audit(entry: AuditEntry): Promise<void> {
    return this.deps.audit.append(entry);
  }

  async persist(input: { readonly workspaceId: string; readonly importId: string }): Promise<PersistOutcome> {
    const { deps } = this;
    const { workspaceId } = input;

    const started = await deps.uow.runDetached(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, input.importId, { lock: 'update' });
      if (!job) return null;
      const status = job.state.status;
      // Re-entrega de un evento viejo (el job ya terminó, se canceló o está en otro estado): no-op idempotente.
      if (status !== 'APPROVED' && status !== 'PERSISTING') return null;
      job.beginPersisting(deps.clock.now().toString());
      await this.save(job);
      return job.state;
    });
    if (!started) return { status: 'SKIPPED', batches: 0, failedBatches: 0 };

    const approvedBy = started.approvedBy as string;
    const batchNos = await deps.uow.runDetached(workspaceId, () =>
      deps.staging.pendingBatchNumbers(workspaceId, input.importId),
    );
    let failedBatches = 0;
    for (const batchNo of batchNos) {
      try {
        await deps.uow.runDetached(workspaceId, () =>
          this.persistBatch(started.accountId, input, batchNo, approvedBy),
        );
      } catch (err) {
        if (!isDomainError(err)) throw err;
        failedBatches += 1;
        // El lote se revirtió entero: registra el motivo en sus filas y avanza el progreso en una transacción propia.
        await deps.uow.runDetached(workspaceId, async () => {
          await deps.staging.markBatchFailed(workspaceId, input.importId, batchNo, { code: err.code });
          const job = await this.lock(workspaceId, input.importId);
          job.recordBatch({ created: 0, now: deps.clock.now().toString() });
          await this.save(job);
        });
      }
    }

    await deps.uow.runDetached(workspaceId, async () => {
      const job = await this.lock(workspaceId, input.importId);
      const failures = await deps.staging.failures(workspaceId, input.importId, ERROR_LINES_LIMIT);
      const failed = failures.reduce((sum, f) => sum + f.count, 0);
      const before = job.state.status;
      const status = job.finish({
        failed,
        errors: failures.map((f) => ({ code: f.code, count: f.count, lines: f.lines })),
        now: deps.clock.now().toString(),
      });
      await this.save(job);
      await publishCompleted(deps, job.state, await deps.staging.dateRange(workspaceId, input.importId));
      await this.audit({
        workspaceId,
        action: 'imports.import.completed',
        aggregateType: 'ImportJob',
        aggregateId: job.id,
        aggregateVersion: job.state.version,
        changes: [
          { field: 'status', before, after: status },
          { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ],
      });
    });
    return { status: 'DONE', batches: batchNos.length, failedBatches };
  }

  /** Un lote en la transacción de BD en curso (la abre `persist` con `runDetached`). */
  private async persistBatch(
    accountId: string,
    input: { readonly workspaceId: string; readonly importId: string },
    batchNo: number,
    approvedBy: string,
  ): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    const rows = await deps.staging.loadBatch(workspaceId, input.importId, batchNo);
    if (rows.length === 0) return;
    const result = await deps.imported.recordBatch({
      workspaceId,
      accountId,
      importJobId: input.importId,
      actorUserId: approvedBy,
      rows: rows.map((r) => this.toRecordRow(r)),
    });
    const byRef = new Map(rows.map((r) => [r.id, r] as const));
    const persisted = [...result.created, ...result.alreadyExisting];
    await deps.staging.markPersisted(
      workspaceId,
      persisted.map((p) => ({ rowId: p.rowRef, transactionId: p.transactionId })),
    );
    await deps.links.insertMany(
      workspaceId,
      persisted.map((p) => ({
        id: deps.ids.next(),
        accountId,
        fingerprint: (byRef.get(p.rowRef) as StagedRow).fingerprint as string,
        transactionId: p.transactionId,
        stagedTransactionId: p.rowRef,
        kind: 'CREATED' as const,
      })),
    );
    const job = await this.lock(workspaceId, input.importId);
    job.recordBatch({
      created: result.created.length,
      alreadyExisting: result.alreadyExisting.length,
      now: deps.clock.now().toString(),
    });
    await this.save(job);
  }

  private toRecordRow(row: StagedRow) {
    if (!row.bookingDate || !row.amount || !row.direction || !row.currency || !row.fingerprint) {
      throw new DomainError('VALIDATION_FAILED', 'a staged row to create is incomplete');
    }
    return {
      rowRef: row.id,
      date: row.bookingDate,
      direction: row.direction,
      amount: { amount: row.amount, currency: row.currency },
      description: row.description,
      externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: row.fingerprint },
    };
  }

  private async lock(workspaceId: string, importId: string): Promise<ImportJob> {
    const job = await this.deps.jobs.findById(workspaceId, importId, { lock: 'update' });
    if (!job) throw new DomainError('RESOURCE_NOT_FOUND', `import ${importId} not found`);
    return job;
  }

  private async save(job: ImportJob): Promise<void> {
    if (!(await this.deps.jobs.save(job))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
    }
    job.markPersisted();
  }
}
