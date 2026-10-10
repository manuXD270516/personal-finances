import { DomainError, LocalDate, currency as makeCurrency } from '@pf/shared-kernel';
import {
  classifyRows,
  dataRecords,
  hasErrors,
  normalizeRow,
  occurrenceIndexes,
  rowFingerprint,
  validateRow,
  type ClassifiableRow,
  type Classification,
  type CsvMapping,
  type CsvRecord,
  type Decision,
  type DuplicateCandidate,
  type ExistingLink,
  type ImportCounters,
  type NormalizedRow,
} from '../domain/index.js';
import type { ImportsDeps, RowNormalization, StagingSummary } from './ports/index.js';

/** Filas por consulta set-based de candidatos de duplicado. */
const CANDIDATE_CHUNK = 1000;

export interface StagedForMapping {
  readonly id: string;
  readonly rowNumber: number;
  readonly raw: readonly string[];
  readonly fingerprint: string | null;
  readonly classification: Classification | null;
  readonly decision: Decision | null;
}

export interface PipelineResult {
  readonly items: readonly RowNormalization[];
  /** Filas de encabezado o saltadas: quedan sin clasificar. */
  readonly resetIds: readonly string[];
}

/** Conteos del job a partir del resumen del staging (los de persistencia solo los fija la persistencia). */
export function countersOf(summary: StagingSummary): ImportCounters {
  return {
    rows: summary.rows,
    newRows: summary.byClassification.NEW,
    alreadyImported: summary.byClassification.DUPLICATE_EXACT,
    probableDuplicates: summary.byClassification.DUPLICATE_PROBABLE,
    invalid: summary.byClassification.INVALID,
    toCreate: summary.toCreate,
    skipped: summary.skipped,
    excluded: summary.excluded,
    created: summary.created,
    failed: summary.failed,
  };
}

/**
 * Pipeline síncrono del mapeo (decisión 16 de add-basic-csv-import): normaliza y valida cada fila, calcula huellas y
 * ordinales, clasifica contra los vínculos de imports previos y los movimientos existentes (candidatos set-based) y
 * decide el estado inicial de cada fila. Debe correr dentro de una unidad de trabajo. NO escribe en el staging: devuelve
 * lo que el llamador persiste. Las decisiones previas de una fila cuya huella no cambió se conservan al re-mapear.
 */
export async function runRowPipeline(
  deps: ImportsDeps,
  input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly currencyCode: string;
    readonly mapping: CsvMapping;
    readonly staged: readonly StagedForMapping[];
  },
): Promise<PipelineResult & { readonly supersededFingerprints: readonly string[] }> {
  const { workspaceId, accountId, mapping } = input;
  const scale = await deps.currencies.scaleOf(input.currencyCode);
  if (scale === null) throw new DomainError('VALIDATION_FAILED', 'the account currency is not active');
  const currency = makeCurrency(input.currencyCode, scale);

  const records: CsvRecord[] = input.staged.map((s) => ({ line: s.rowNumber, cells: s.raw }));
  const data = dataRecords(records, mapping);
  if (data.length > deps.settings.maxRows) {
    throw new DomainError(
      'IMPORT_TOO_MANY_ROWS',
      `the file has more than ${deps.settings.maxRows} data rows`,
    );
  }
  const dataLines = new Set(data.map((r) => r.line));
  const stagedByLine = new Map(input.staged.map((s) => [s.rowNumber, s] as const));
  const resetIds = input.staged.filter((s) => !dataLines.has(s.rowNumber)).map((s) => s.id);

  const timeZone = await deps.calendar.timeZoneOf(workspaceId);
  const today = LocalDate.ofInstant(deps.clock.now(), timeZone);
  const closedPeriods = await deps.periods.listClosed(workspaceId);
  const validation = { today, futureToleranceDays: deps.settings.futureToleranceDays, closedPeriods };

  interface Prepared {
    readonly staged: StagedForMapping;
    readonly row: NormalizedRow;
    readonly issues: ReturnType<typeof validateRow>;
    readonly valid: boolean;
  }
  const prepared: Prepared[] = data.map((record) => {
    const row = normalizeRow(record, mapping, currency);
    const issues = validateRow(row, validation);
    return {
      staged: stagedByLine.get(record.line) as StagedForMapping,
      row,
      issues,
      valid: !hasErrors(issues),
    };
  });

  const validRows = prepared.filter((p) => p.valid);
  const indexes = occurrenceIndexes(
    validRows.map((p) => ({
      bookingDate: p.row.bookingDate as string,
      signedAmount: p.row.signedAmount as string,
      description: p.row.description,
    })),
  );
  const fingerprints = new Map<string, { fingerprint: string; occurrenceIndex: number }>();
  validRows.forEach((p, i) => {
    const occurrenceIndex = indexes[i] as number;
    fingerprints.set(p.staged.id, {
      occurrenceIndex,
      fingerprint: rowFingerprint({
        workspaceId,
        accountId,
        bookingDate: p.row.bookingDate as string,
        signedAmount: p.row.signedAmount as string,
        currency: input.currencyCode,
        description: p.row.description,
        occurrenceIndex,
      }),
    });
  });

  // 1) Vínculos exactos y vínculos superados (la transacción vinculada se anuló).
  const links = new Map<string, ExistingLink>();
  const activeLinks = await deps.links.findActive(workspaceId, accountId, [
    ...new Set([...fingerprints.values()].map((f) => f.fingerprint)),
  ]);
  if (activeLinks.length > 0) {
    const statuses = await deps.statuses.statusOf({
      workspaceId,
      transactionIds: [...new Set(activeLinks.map((l) => l.transactionId))],
    });
    const statusById = new Map(statuses.map((s) => [s.transactionId, s.status] as const));
    for (const link of activeLinks) {
      links.set(link.fingerprint, {
        fingerprint: link.fingerprint,
        transactionId: link.transactionId,
        // Una transacción inexistente se trata como anulada: el vínculo no puede bloquear la fila.
        transactionStatus: statusById.get(link.transactionId) ?? 'VOIDED',
      });
    }
  }

  // 2) Candidatos de duplicado para las filas que no son exactas.
  const classifiable: ClassifiableRow[] = validRows.map((p) => ({
    rowRef: p.staged.id,
    lineNumber: p.row.lineNumber,
    bookingDate: p.row.bookingDate as string,
    direction: p.row.direction as 'IN' | 'OUT',
    description: p.row.description,
    fingerprint: (fingerprints.get(p.staged.id) as { fingerprint: string }).fingerprint,
  }));
  const needCandidates = validRows.filter((p) => {
    const fp = (fingerprints.get(p.staged.id) as { fingerprint: string }).fingerprint;
    const link = links.get(fp);
    return !link || link.transactionStatus === 'VOIDED';
  });
  const candidates = new Map<string, readonly DuplicateCandidate[]>();
  for (let i = 0; i < needCandidates.length; i += CANDIDATE_CHUNK) {
    const chunk = needCandidates.slice(i, i + CANDIDATE_CHUNK);
    const found = await deps.duplicates.findForImport({
      workspaceId,
      accountId,
      windowDays: deps.settings.duplicateWindowDays,
      rows: chunk.map((p) => ({
        rowRef: p.staged.id,
        date: p.row.bookingDate as string,
        direction: p.row.direction as 'IN' | 'OUT',
        amount: { amount: p.row.amount as string, currency: input.currencyCode },
      })),
    });
    const alreadyLinked = await deps.links.linkedTransactionIds(workspaceId, accountId, [
      ...new Set(found.flatMap((f) => f.candidates.map((c) => c.transactionId))),
    ]);
    for (const entry of found) {
      const usable = entry.candidates
        .filter((c) => !alreadyLinked.has(c.transactionId))
        .map((c) => ({
          transactionId: c.transactionId,
          kind: c.kind,
          date: c.date,
          description: c.description,
        }));
      if (usable.length > 0) candidates.set(entry.rowRef, usable);
    }
  }

  const classified = classifyRows({ rows: classifiable, links, candidates });
  const byRef = new Map(classified.rows.map((r) => [r.rowRef, r] as const));

  const items: RowNormalization[] = prepared.map((p): RowNormalization => {
    const common = {
      id: p.staged.id,
      bookingDate: p.row.bookingDate,
      amount: p.row.amount,
      currency: input.currencyCode,
      direction: p.row.direction,
      description: p.row.description,
      issues: p.issues,
    };
    if (!p.valid) {
      return {
        ...common,
        occurrenceIndex: null,
        fingerprint: null,
        classification: 'INVALID',
        decision: 'EXCLUDE',
        matchedTransactionId: null,
      };
    }
    const fp = fingerprints.get(p.staged.id) as { fingerprint: string; occurrenceIndex: number };
    const result = byRef.get(p.staged.id) as NonNullable<ReturnType<typeof byRef.get>>;
    const prior = p.staged.fingerprint === fp.fingerprint ? p.staged.decision : null;
    let decision: Decision | null;
    switch (result.classification) {
      case 'DUPLICATE_EXACT':
        decision = 'SKIP';
        break;
      case 'NEW':
        decision = prior === 'EXCLUDE' ? 'EXCLUDE' : 'CREATE';
        break;
      default:
        decision = prior;
    }
    return {
      ...common,
      occurrenceIndex: fp.occurrenceIndex,
      fingerprint: fp.fingerprint,
      classification: result.classification,
      decision,
      matchedTransactionId: result.matchedTransactionId,
    };
  });

  return { items, resetIds, supersededFingerprints: classified.supersededFingerprints };
}
