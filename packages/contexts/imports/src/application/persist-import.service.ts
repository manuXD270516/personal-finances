import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, isDomainError } from '@pf/shared-kernel';
import {
  IMPORT_EXTERNAL_NAMESPACE_PREFIX,
  IMPORT_ROW_NAMESPACE,
  type ImportedClassificationDto,
  type ImportedTransactionRowDto,
} from '@pf/transactions/contracts';
import {
  EMPTY_PROPOSAL,
  effectiveRow,
  type FieldOrigin,
  executionInstant,
  statementDifference,
  type ImportJob,
  type ImportReconciliation,
} from '../domain/index.js';
import { recordJob, SYSTEM_ACTOR } from './job-recorder.js';
import { publishCompleted } from './imports.service.js';
import { ratio } from './process-import.service.js';
import type { ImportsDeps, StagedRow } from './ports/index.js';

export interface PersistOutcome {
  readonly status: 'SKIPPED' | 'DONE';
  readonly batches: number;
  readonly failedBatches: number;
}

/** Líneas del archivo que se listan por código de error en el job (el detalle completo queda en el staging). */
const ERROR_LINES_LIMIT = 100;

/**
 * `PersistImport` (consumidor `imports.persist` del worker; decisión 10 de add-basic-csv-import ampliada por
 * add-import-pipeline decisiones 10, 12, 13 y 14): crea las transacciones de una importación aprobada por lotes con lo
 * que mostró la vista previa (gasto, ingreso, transferencia o conversión, con la categoría, la contraparte, las
 * etiquetas y la descripción de la fila). UN lote = UNA transacción de BD (`recordBatch` de Transactions + staging +
 * vínculos + progreso del job), independiente de la del consumidor, de modo que un error de dominio (`PERIOD_CLOSED`,
 * `ACCOUNT_CLOSED`) revierte SOLO ese lote, se registra en sus filas y la persistencia continúa. Un lote cuyas filas ya
 * tienen transacción se salta, así que la caída del proceso o la re-entrega del evento reanudan sin duplicar. Los
 * errores transitorios (BD, red) se propagan: el consumidor reintenta con backoff.
 *
 * Tras cada lote, en una unidad de trabajo APARTE por fila, vincula las ocurrencias de compromisos que el usuario
 * confirmó (D121); un rechazo de COMMITMENTS no revierte la transacción: queda como `IMPORT_OCCURRENCE_LINK_SKIPPED`.
 * Al final, si el extracto trae saldo final, compara el saldo de la cuenta a esa fecha (decisión 14): coincide ⇒
 * `COMPLETED` con la oferta de reconciliación; difiere ⇒ `COMPLETED_WITH_DIFFERENCE`. Nunca un ajuste automático.
 */
export class PersistImportService {
  constructor(private readonly deps: ImportsDeps) {}

  async persist(input: { readonly workspaceId: string; readonly importId: string }): Promise<PersistOutcome> {
    const { deps } = this;
    const { workspaceId } = input;

    const started = await deps.uow.runDetached(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, input.importId, { lock: 'update' });
      if (!job) return null;
      const status = job.state.status;
      // Re-entrega de un evento viejo (el job ya terminó, se canceló o está en otro estado): no-op idempotente.
      if (status !== 'APPROVED' && status !== 'PERSISTING') return null;
      const before = status;
      job.beginPersisting(deps.clock.now().toString());
      await this.save(job);
      if (before === 'APPROVED') {
        await recordJob(deps, job, 'persisting', {
          actor: SYSTEM_ACTOR,
          changes: [{ field: 'status', before: 'APPROVED', after: 'PERSISTING' }],
        });
      }
      return job.state;
    });
    if (!started) return { status: 'SKIPPED', batches: 0, failedBatches: 0 };

    const approvedBy = started.approvedBy as string;
    const timeZone = await deps.uow.run(workspaceId, () => deps.calendar.timeZoneOf(workspaceId));
    const batchNos = await deps.uow.runDetached(workspaceId, () =>
      deps.staging.pendingBatchNumbers(workspaceId, input.importId),
    );
    let failedBatches = 0;
    for (const batchNo of batchNos) {
      try {
        const linkable = await deps.uow.runDetached(workspaceId, () =>
          this.persistBatch(started, input, batchNo, approvedBy, timeZone),
        );
        await this.linkOccurrences(workspaceId, linkable, approvedBy);
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
      const reconciliation =
        failed === 0 ? await this.reconcile(workspaceId, job) : (job.state.reconciliation ?? null);
      const coverage = await deps.staging.rulesCoverage(workspaceId, input.importId);
      const status = job.finish({
        failed,
        errors: failures.map((f) => ({ code: f.code, count: f.count, lines: f.lines })),
        now: deps.clock.now().toString(),
        reconciliation,
        rulesSummary: {
          rows: coverage.created,
          classifiedByRule: coverage.byRule,
          withoutCategory: coverage.withoutCategory,
          ratio: ratio(coverage.byRule, coverage.created),
          rulesUnavailable: job.state.rulesSummary?.rulesUnavailable ?? false,
        },
      });
      await this.save(job);
      const refs = [
        await publishCompleted(deps, job.state, await deps.staging.dateRange(workspaceId, input.importId)),
      ];
      const changes: AuditChangeInput[] = [
        { field: 'status', before, after: status },
        { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ...(reconciliation
          ? [{ field: 'reconciliation', before: null, after: JSON.stringify(reconciliation) }]
          : []),
        { field: 'ruleCoverage', before: null, after: JSON.stringify(job.state.rulesSummary) },
      ];
      await recordJob(deps, job, 'completed', { actor: SYSTEM_ACTOR, events: refs, changes });
    });
    return { status: 'DONE', batches: batchNos.length, failedBatches };
  }

  /**
   * Compara el saldo de la cuenta a la fecha del extracto con el saldo final del extracto (sin ajuste automático):
   * posteadas, confirmadas y reconciliadas cuentan; coincide ⇒ `MATCHED` (la UI ofrece la reconciliación).
   */
  private async reconcile(workspaceId: string, job: ImportJob): Promise<ImportReconciliation | null> {
    const { deps } = this;
    const statement = job.state.statement;
    if (!statement || statement.closingBalance === null) return null;
    const account = await deps.accounts.getAccount(workspaceId, job.state.accountId);
    if (!account) return null;
    const scale = (await deps.currencies.scaleOf(account.currency)) ?? 2;
    const date = statement.closingDate ?? statement.periodTo ?? null;
    if (date === null) return null;
    const presented = await deps.balances.presentedBalance(workspaceId, job.state.accountId, date);
    const diff = statementDifference(statement.closingBalance, presented ?? '0', account.currency, scale);
    return {
      outcome: diff.matches ? 'MATCHED' : 'DIFFERENCE',
      statementBalance: diff.closingBalance,
      accountBalance: diff.resultingBalance,
      difference: diff.difference,
      statementDate: date,
    };
  }

  /** Un lote en la transacción de BD en curso (la abre `persist` con `runDetached`). Devuelve los vínculos pendientes. */
  private async persistBatch(
    state: { readonly accountId: string; readonly format: string | null },
    input: { readonly workspaceId: string; readonly importId: string },
    batchNo: number,
    approvedBy: string,
    timeZone: string,
  ): Promise<readonly { rowId: string; transactionId: string; occurrenceId: string }[]> {
    const { deps } = this;
    const { workspaceId } = input;
    const accountId = state.accountId;
    const rows = await deps.staging.loadBatch(workspaceId, input.importId, batchNo);
    if (rows.length === 0) return [];
    const result = await deps.imported.recordBatch({
      workspaceId,
      accountId,
      importJobId: input.importId,
      actorUserId: approvedBy,
      rows: rows.map((r) => this.toRecordRow(r, state.format, timeZone)),
    });
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const persisted = [...result.created, ...result.alreadyExisting];
    await deps.staging.markPersisted(
      workspaceId,
      persisted.map((p) => ({ rowId: p.rowRef, transactionId: p.transactionId })),
    );
    await deps.links.insertMany(
      workspaceId,
      persisted.map((p) => {
        const row = byId.get(p.rowRef) as StagedRow;
        return {
          id: deps.ids.next(),
          accountId,
          fingerprint: row.fingerprint as string,
          transactionId: p.transactionId,
          stagedTransactionId: p.rowRef,
          kind: 'CREATED' as const,
          importJobId: input.importId,
          externalRef: row.externalId
            ? { namespace: `${IMPORT_EXTERNAL_NAMESPACE_PREFIX}${state.format ?? 'CSV'}`, id: row.externalId }
            : null,
        };
      }),
    );
    const job = await this.lock(workspaceId, input.importId);
    job.recordBatch({
      created: result.created.length,
      alreadyExisting: result.alreadyExisting.length,
      now: deps.clock.now().toString(),
    });
    await this.save(job);
    // Solo las filas efectivamente creadas se vinculan; las que ya existían no (otro import las creó).
    return result.created.flatMap((c) => {
      const link = (byId.get(c.rowRef) as StagedRow).occurrenceLink;
      return link
        ? [{ rowId: c.rowRef, transactionId: c.transactionId, occurrenceId: link.occurrenceId }]
        : [];
    });
  }

  /**
   * Vincula cada ocurrencia confirmada con su transacción, UNA unidad de trabajo por fila: un rechazo de COMMITMENTS
   * (ocurrencia ya resuelta o cancelada) deja la transacción creada, sin vínculo, y marca la fila
   * `IMPORT_OCCURRENCE_LINK_SKIPPED`.
   */
  private async linkOccurrences(
    workspaceId: string,
    links: readonly { rowId: string; transactionId: string; occurrenceId: string }[],
    approvedBy: string,
  ): Promise<void> {
    const { deps } = this;
    for (const link of links) {
      let outcome: 'LINKED' | 'SKIPPED' = 'LINKED';
      try {
        await deps.uow.runDetached(workspaceId, () =>
          deps.occurrenceLinks.link({
            workspaceId,
            occurrenceId: link.occurrenceId,
            transactionId: link.transactionId,
            userId: approvedBy,
          }),
        );
      } catch (err) {
        if (!isDomainError(err)) throw err;
        outcome = 'SKIPPED';
      }
      await deps.uow.runDetached(workspaceId, () =>
        deps.staging.markOccurrenceOutcome(workspaceId, [{ rowId: link.rowId, outcome }]),
      );
      if (outcome === 'LINKED') {
        await deps.uow.runDetached(workspaceId, () =>
          deps.audit.append({
            workspaceId,
            action: 'imports.row.occurrence_linked',
            aggregateType: 'ImportRow',
            aggregateId: link.rowId,
            aggregateVersion: null,
            actor: { type: 'USER', userId: approvedBy },
            changes: [
              { field: 'transactionId', before: null, after: link.transactionId },
              { field: 'occurrenceId', before: null, after: link.occurrenceId },
            ],
          }),
        );
      }
    }
  }

  /** La fila efectiva (edición sobre propuesta) en el formato del lote de TRANSACTIONS. */
  private toRecordRow(row: StagedRow, format: string | null, timeZone: string): ImportedTransactionRowDto {
    if (!row.bookingDate || !row.amount || !row.direction || !row.currency || !row.fingerprint) {
      throw new DomainError('VALIDATION_FAILED', 'a staged row to create is incomplete');
    }
    const effective = effectiveRow(row.proposal ?? EMPTY_PROPOSAL, row.edits, row.description);
    const kind = effective.kind ?? (row.direction === 'OUT' ? 'EXPENSE' : 'INCOME');
    const externalRef = row.externalId
      ? { namespace: `${IMPORT_EXTERNAL_NAMESPACE_PREFIX}${format ?? 'CSV'}`, id: row.externalId }
      : { namespace: IMPORT_ROW_NAMESPACE, id: row.fingerprint };
    const base = {
      rowRef: row.id,
      date: row.bookingDate,
      direction: row.direction,
      amount: { amount: row.amount, currency: row.currency },
      description: row.description,
      externalRef,
    };
    if (kind === 'TRANSFER' && effective.transfer) {
      return { ...base, kind, transfer: { counterAccountId: effective.transfer.counterAccountId } };
    }
    if (kind === 'CONVERSION' && effective.conversion) {
      const c = effective.conversion;
      return {
        ...base,
        kind,
        conversion: {
          counterAccountId: c.counterAccountId,
          counterAmount: c.counterAmount,
          ...(c.fee ? { fee: c.fee } : {}),
          ...(c.quotedRate ? { quotedRate: c.quotedRate } : {}),
          // Con hora en el extracto, esa hora; sin ella, el fin del día de negocio (D326).
          executedAt: executionInstant(row.bookingDate, row.bookingTime, timeZone).toString(),
        },
      };
    }
    const category = effective.category;
    const categoryId = category?.value ?? null;
    const originOf = (o: { type: string }): ImportedClassificationDto['categoryOrigin'] =>
      o.type === 'MANUAL' || o.type === 'RULE' || o.type === 'COUNTERPARTY_DEFAULT'
        ? o.type
        : 'SYSTEM_DEFAULT';
    // Referencias de reglas a los campos del split (TAG:<id>, COUNTERPARTY, DESCRIPTION, NOTES).
    const ruleRefs: { field: string; ruleId: string; ruleVersion: number }[] = [];
    const ref = (field: string, o: FieldOrigin | undefined) => {
      if (o?.type === 'RULE') ruleRefs.push({ field, ruleId: o.ruleId, ruleVersion: o.ruleVersion });
    };
    for (const tag of effective.tags?.value ?? []) ref('TAG:' + tag, effective.tags?.origin);
    ref('COUNTERPARTY', effective.counterparty?.origin);
    ref('DESCRIPTION', effective.description?.origin);
    ref('NOTES', effective.notes?.origin);
    const categoryOrigin =
      categoryId === null ? 'SYSTEM_DEFAULT' : originOf(category?.origin ?? { type: 'SYSTEM_DEFAULT' });
    const classification: ImportedClassificationDto = {
      categoryId,
      categoryOrigin,
      ...(category?.origin.type === 'RULE'
        ? { categoryRule: { ruleId: category.origin.ruleId, ruleVersion: category.origin.ruleVersion } }
        : {}),
      counterpartyId: effective.counterparty?.value ?? null,
      tagIds: effective.tags?.value ?? [],
      // Los valores de campos personalizados de las reglas no se proponen en la vista previa: se crean sin ellos.
      customFields: [],
      ...(effective.description &&
      effective.description.value !== row.description &&
      effective.description.value
        ? { description: effective.description.value }
        : {}),
      ...(effective.notes?.value ? { notes: effective.notes.value } : {}),
      needsReview: row.proposal?.needsReview ?? null,
      ruleRefs,
    };
    return { ...base, kind: kind === 'INCOME' ? 'INCOME' : 'EXPENSE', classification };
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
