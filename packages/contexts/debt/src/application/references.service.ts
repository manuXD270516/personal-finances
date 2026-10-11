import type { AuditPort } from '@pf/audit/contracts';
import { DomainError, currency as makeCurrency } from '@pf/shared-kernel';
import {
  MAX_REFERENCE_BYTES,
  compareSchedules,
  comparisonToCsv,
  deriveComparisonStatus,
  detectReferenceTable,
  isExactMatch,
  parseReferenceSchedule,
  suggestExplanations,
  validateReferenceRows,
  type DecimalSeparator,
  type ManualReferenceRow,
  type ReferenceColumnMapping,
  type ReferenceDateFormat,
  type ReferenceRowError,
  type ReferenceScheduleRow,
  type ScheduleComparison,
  type ScheduleInstallment,
} from '../domain/index.js';
import type { Loan } from '../domain/index.js';
import type { ComparisonRecord, DebtDeps, ReferenceRecord } from './ports/index.js';
import { LOAN_AGGREGATE } from './recorder.js';
import { computeSchedule, scheduleInputOf } from './schedule-support.js';
import type { ComparisonView, ReferenceView } from './views.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

export interface UploadReferenceCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly source: 'CSV' | 'PASTE' | 'MANUAL';
  /** CSV/PASTE: contenido de texto (UTF-8) de la tabla. */
  readonly text?: string | undefined;
  readonly delimiter?: ',' | ';' | '\t' | undefined;
  readonly hasHeader?: boolean | undefined;
  readonly mapping?: ReferenceColumnMapping | undefined;
  readonly dateFormat?: ReferenceDateFormat | undefined;
  readonly decimalSeparator?: DecimalSeparator | undefined;
  /** MANUAL: filas ingresadas una a una. */
  readonly rows?: readonly ManualReferenceRow[] | undefined;
}

/** Errores de fila del parser → `LOAN_REFERENCE_INVALID` con `details.rows[]` (o `UPLOAD_TOO_LARGE`). */
export function referenceProblem(errors: readonly ReferenceRowError[]): DomainError {
  if (errors.some((e) => e.code === 'TOO_LARGE')) {
    return new DomainError('UPLOAD_TOO_LARGE', `the table exceeds ${MAX_REFERENCE_BYTES} bytes`);
  }
  const first = errors[0];
  return new DomainError('LOAN_REFERENCE_INVALID', first?.message ?? 'the bank schedule is not valid', {
    details: {
      rows: errors.map((e) => ({
        row: e.row,
        field: e.field,
        code: e.code,
        message: e.message,
        details: e.details,
      })),
    },
  });
}

/**
 * Casos de uso sobre la tabla de amortización del banco (openspec add-loans, decisión 12; exit criterion de Phase 4):
 * cargarla como referencia, compararla con el cronograma (fijado o, en borrador, la vista previa), sugerir
 * explicaciones y registrar la explicación de una diferencia. Nunca cambia el préstamo.
 */
export class ReferencesService {
  constructor(private readonly deps: DebtDeps) {}

  private get audit(): AuditPort {
    return this.deps.audit;
  }

  private async scaleOf(code: string): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`);
    return scale;
  }

  /** Cronograma contra el que se compara: la versión vigente, o la vista previa de un borrador. */
  private async systemSchedule(
    loan: Loan,
    scale: number,
  ): Promise<{ version: number; installments: readonly ScheduleInstallment[] }> {
    const s = loan.snapshot;
    if (s.currentScheduleVersion !== null) {
      return {
        version: s.currentScheduleVersion,
        installments: await this.deps.schedules.installments(loan.id, s.currentScheduleVersion),
      };
    }
    return { version: 0, installments: computeSchedule(s, scale).installments };
  }

  private async load(workspaceId: string, loanId: string, lock = false): Promise<Loan> {
    const loan = await this.deps.loans.findById(workspaceId, loanId, lock ? { lock: 'update' } : undefined);
    if (!loan) throw notFound('loan', loanId);
    return loan;
  }

  private compare(
    loan: Loan,
    scale: number,
    system: readonly ScheduleInstallment[],
    reference: readonly ReferenceScheduleRow[],
  ): ScheduleComparison {
    const s = loan.snapshot;
    return compareSchedules({
      currency: makeCurrency(s.currency, scale),
      system,
      reference,
      loanPrincipal: s.principal,
    });
  }

  private recordOf(
    loan: Loan,
    referenceId: string,
    version: number,
    comparison: ScheduleComparison,
    previous: ComparisonRecord | null,
  ): ComparisonRecord {
    const explanation = previous?.explanation ?? null;
    const status = deriveComparisonStatus(comparison, explanation);
    return {
      id: previous?.id ?? this.deps.ids.next(),
      loanId: loan.id,
      referenceId,
      scheduleVersion: version,
      matched: comparison.summary.matching,
      totalRows: comparison.summary.totalRows,
      firstDifferenceNo: comparison.summary.firstDifference?.n ?? null,
      summary: JSON.parse(JSON.stringify(comparison.summary)) as Record<string, unknown>,
      status,
      explanation: status === 'EXPLAINED' ? explanation : null,
      explainedBy: status === 'EXPLAINED' ? (previous?.explainedBy ?? null) : null,
      explainedAt: status === 'EXPLAINED' ? (previous?.explainedAt ?? null) : null,
    };
  }

  // ───────────────────────────────────────────────────────────── cargar

  async upload(cmd: UploadReferenceCommand): Promise<ReferenceView & { comparison: ComparisonView }> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, cmd.loanId, true);
      const state = loan.snapshot;
      if (state.status === 'CANCELLED') {
        throw new DomainError('LOAN_NOT_ACTIVE', 'a cancelled loan cannot receive a bank schedule');
      }
      const scale = await this.scaleOf(state.currency);
      const currency = makeCurrency(state.currency, scale);
      let rows: readonly ReferenceScheduleRow[];
      let mapping: Record<string, unknown> | null = null;
      if (cmd.source === 'MANUAL') {
        if (!cmd.rows || cmd.rows.length === 0) {
          throw new DomainError('VALIDATION_FAILED', 'rows are required').at('/rows');
        }
        const result = validateReferenceRows(cmd.rows, currency);
        if (!result.ok) throw referenceProblem(result.errors);
        rows = result.rows;
      } else {
        if (typeof cmd.text !== 'string' || cmd.text.length === 0) {
          throw new DomainError('VALIDATION_FAILED', 'text is required').at('/text');
        }
        if (Buffer.byteLength(cmd.text, 'utf8') > MAX_REFERENCE_BYTES) {
          throw new DomainError('UPLOAD_TOO_LARGE', `the table exceeds ${MAX_REFERENCE_BYTES} bytes`);
        }
        if (!cmd.mapping || !cmd.dateFormat || !cmd.decimalSeparator) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'mapping, dateFormat and decimalSeparator are required',
          ).at('/mapping');
        }
        const parsed = parseReferenceSchedule({
          text: cmd.text,
          ...(cmd.delimiter ? { delimiter: cmd.delimiter } : {}),
          ...(cmd.hasHeader !== undefined ? { hasHeader: cmd.hasHeader } : {}),
          mapping: cmd.mapping,
          dateFormat: cmd.dateFormat,
          decimalSeparator: cmd.decimalSeparator,
          currency,
        });
        if (!parsed.ok) throw referenceProblem(parsed.errors);
        rows = parsed.rows;
        mapping = {
          mapping: cmd.mapping,
          dateFormat: cmd.dateFormat,
          decimalSeparator: cmd.decimalSeparator,
          delimiter: parsed.delimiter,
          hasHeader: cmd.hasHeader ?? true,
        } as unknown as Record<string, unknown>;
      }

      const reference: ReferenceRecord = {
        id: deps.ids.next(),
        loanId: loan.id,
        referenceVersion: await deps.references.nextVersion(loan.id),
        source: cmd.source,
        mapping,
        rowCount: rows.length,
        createdAt: at,
        createdBy: cmd.userId,
      };
      await deps.references.insert(workspaceId, reference, rows);

      const system = await this.systemSchedule(loan, scale);
      const comparison = this.compare(loan, scale, system.installments, rows);
      const record = this.recordOf(loan, reference.id, system.version, comparison, null);
      await deps.references.upsertComparison(workspaceId, record);
      await this.audit.append({
        workspaceId,
        action: 'debt.loan_reference.uploaded',
        aggregateType: 'LoanReferenceSchedule',
        aggregateId: reference.id,
        changes: [
          { field: 'loanId', before: null, after: loan.id },
          { field: 'referenceVersion', before: null, after: reference.referenceVersion },
          { field: 'source', before: null, after: reference.source },
          { field: 'rowCount', before: null, after: reference.rowCount },
        ],
      });
      return {
        id: reference.id,
        referenceVersion: reference.referenceVersion,
        source: reference.source,
        rowCount: reference.rowCount,
        createdAt: reference.createdAt,
        comparison: this.comparisonView(
          reference,
          record,
          comparison,
          suggestExplanations({
            comparison,
            reference: rows,
            calculatorInput: scheduleInputOf(state, scale),
          }) as unknown as Record<string, unknown>[],
        ),
      };
    });
  }

  /** Vista previa de la tabla pegada: separador detectado, encabezado y primeras filas (sin persistir nada). */
  detect(
    text: string,
    options: { delimiter?: ',' | ';' | '\t' | undefined; hasHeader?: boolean | undefined },
  ) {
    if (Buffer.byteLength(text, 'utf8') > MAX_REFERENCE_BYTES) {
      throw new DomainError('UPLOAD_TOO_LARGE', `the table exceeds ${MAX_REFERENCE_BYTES} bytes`);
    }
    return detectReferenceTable(text, {
      ...(options.delimiter ? { delimiter: options.delimiter } : {}),
      ...(options.hasHeader !== undefined ? { hasHeader: options.hasHeader } : {}),
    });
  }

  // ───────────────────────────────────────────────────────────── consultar

  async list(workspaceId: string, loanId: string): Promise<readonly ReferenceView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      await this.load(workspaceId, loanId);
      return (await this.deps.references.list(loanId)).map((r) => ({
        id: r.id,
        referenceVersion: r.referenceVersion,
        source: r.source,
        rowCount: r.rowCount,
        createdAt: r.createdAt,
      }));
    });
  }

  private comparisonView(
    reference: ReferenceRecord,
    record: ComparisonRecord,
    comparison: ScheduleComparison,
    suggestions: readonly Record<string, unknown>[],
  ): ComparisonView {
    return {
      referenceId: reference.id,
      referenceVersion: reference.referenceVersion,
      scheduleVersion: record.scheduleVersion,
      status: record.status,
      explanation: record.explanation,
      explainedBy: record.explainedBy,
      explainedAt: record.explainedAt,
      matched: comparison.summary.matching,
      totalRows: comparison.summary.totalRows,
      firstDifferenceNo: comparison.summary.firstDifference?.n ?? null,
      summary: JSON.parse(JSON.stringify(comparison.summary)) as Record<string, unknown>,
      rows: JSON.parse(JSON.stringify(comparison.rows)) as Record<string, unknown>[],
      suggestions,
    };
  }

  private async compute(workspaceId: string, loanId: string, referenceId: string) {
    const { deps } = this;
    const loan = await this.load(workspaceId, loanId);
    const reference = await deps.references.find(loanId, referenceId);
    if (!reference) throw notFound('reference', referenceId);
    const scale = await this.scaleOf(loan.snapshot.currency);
    const system = await this.systemSchedule(loan, scale);
    const rows = await deps.references.rows(referenceId);
    const comparison = this.compare(loan, scale, system.installments, rows);
    const stored = await deps.references.findComparison(referenceId, system.version);
    return { loan, reference, scale, system, rows, comparison, stored };
  }

  /** Comparación en vivo (el cronograma fijado nunca cambia); estado y explicación vienen de lo registrado. */
  async comparison(workspaceId: string, loanId: string, referenceId: string): Promise<ComparisonView> {
    return this.deps.uow.run(workspaceId, async () => {
      const { loan, reference, scale, system, rows, comparison, stored } = await this.compute(
        workspaceId,
        loanId,
        referenceId,
      );
      const record =
        stored && deriveComparisonStatus(comparison, stored.explanation) === stored.status
          ? stored
          : this.recordOf(loan, referenceId, system.version, comparison, stored);
      const suggestions = suggestExplanations({
        comparison,
        reference: rows,
        calculatorInput: scheduleInputOf(loan.snapshot, scale),
      });
      return this.comparisonView(
        reference,
        record,
        comparison,
        suggestions as unknown as Record<string, unknown>[],
      );
    });
  }

  async comparisonCsv(workspaceId: string, loanId: string, referenceId: string): Promise<string> {
    return this.deps.uow.run(workspaceId, async () => {
      const { comparison } = await this.compute(workspaceId, loanId, referenceId);
      return comparisonToCsv(comparison);
    });
  }

  // ───────────────────────────────────────────────────────────── explicar

  async explain(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly referenceId: string;
    readonly explanation: string;
  }): Promise<ComparisonView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const text = typeof cmd.explanation === 'string' ? cmd.explanation.trim() : '';
    if (text.length < 1 || text.length > 1000) {
      throw new DomainError('VALIDATION_FAILED', 'explanation must have between 1 and 1000 characters').at(
        '/explanation',
      );
    }
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const { loan, reference, scale, system, rows, comparison, stored } = await this.compute(
        workspaceId,
        cmd.loanId,
        cmd.referenceId,
      );
      if (isExactMatch(comparison)) {
        throw new DomainError('VALIDATION_FAILED', 'the comparison has no differences to explain').at(
          '/explanation',
        );
      }
      const base = this.recordOf(loan, reference.id, system.version, comparison, stored);
      await deps.references.upsertComparison(workspaceId, {
        ...base,
        status: 'UNEXPLAINED',
        explanation: null,
        explainedBy: null,
        explainedAt: null,
      });
      const persisted = (await deps.references.findComparison(
        reference.id,
        system.version,
      )) as ComparisonRecord;
      await deps.references.explain(workspaceId, persisted.id, {
        explanation: text,
        explainedBy: cmd.userId,
        explainedAt: at,
      });
      const record: ComparisonRecord = {
        ...persisted,
        status: 'EXPLAINED',
        explanation: text,
        explainedBy: cmd.userId,
        explainedAt: at,
      };
      await this.audit.append({
        workspaceId,
        action: 'debt.loan_comparison.explained',
        aggregateType: 'LoanScheduleComparison',
        aggregateId: persisted.id,
        changes: [
          { field: 'loanId', before: null, after: loan.id },
          { field: 'referenceVersion', before: null, after: reference.referenceVersion },
          { field: 'scheduleVersion', before: null, after: system.version },
          { field: 'status', before: persisted.status, after: 'EXPLAINED' },
          { field: 'explanation', before: null, after: text },
        ],
      });
      const suggestions = suggestExplanations({
        comparison,
        reference: rows,
        calculatorInput: scheduleInputOf(loan.snapshot, scale),
      });
      return this.comparisonView(
        reference,
        record,
        comparison,
        suggestions as unknown as Record<string, unknown>[],
      );
    });
  }

  /** Al fijar el cronograma v1 registra el resultado de la última referencia (el exit criterion queda anotado). */
  async snapshotLatest(workspaceId: string, loan: Loan, scale: number): Promise<void> {
    const { deps } = this;
    const reference = await deps.references.latest(loan.id);
    if (!reference) return;
    const system = await this.systemSchedule(loan, scale);
    const rows = await deps.references.rows(reference.id);
    const comparison = this.compare(loan, scale, system.installments, rows);
    const previous = await deps.references.findComparison(reference.id, system.version);
    await deps.references.upsertComparison(
      workspaceId,
      this.recordOf(loan, reference.id, system.version, comparison, previous),
    );
  }
}

export { LOAN_AGGREGATE };
