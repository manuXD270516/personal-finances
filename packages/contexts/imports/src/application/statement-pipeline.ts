import { LocalDate, Money } from '@pf/shared-kernel';
import {
  EMPTY_PROPOSAL,
  hasErrors,
  normalizeStatementRow,
  occurrenceIndexes,
  rowFingerprint,
  selectDataRecords,
  validateRow,
  verifyRunningBalance,
  type ClassificationProposal,
  type ClosedPeriodRange,
  type CsvRecord,
  type Decision,
  type ExistingLink,
  type NormalizedRow,
  type OccurrenceCandidateEntry,
  type ProfileMapping,
  type RowIssue,
  type RowKind,
  type StatementFormat,
  type StatementRecord,
} from '../domain/index.js';
import { classifyWithScores, type MatchableRow, type ScoredCandidate } from './duplicate-matching.js';
import { buildProposals, rulesSubjectKind } from './classification-stage.js';
import type { ImportsDeps, OccurrenceMatchRow, PipelineRowResult, StagedRow } from './ports/index.js';

/** Filas por consulta set-based de candidatos de duplicado y por llamada de vínculos. */
const CANDIDATE_CHUNK = 1000;
/** Filas por llamada de coincidencias con compromisos (`MAX_MATCH_CANDIDATE_ROWS`). */
const MATCH_CHUNK = 500;

export interface PipelineContext {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly currencyCode: string;
  readonly scale: number;
  readonly timeZone: string;
  readonly format: StatementFormat;
  /** Mapeo tabular efectivo (CSV/XLSX); `null` en los formatos autodescritos. */
  readonly mapping: ProfileMapping | null;
  /** Limpieza de descripción de un perfil aplicado a un formato autodescrito (prefijos literales). */
  readonly descriptionCleanup: readonly string[];
  readonly closedPeriods: readonly ClosedPeriodRange[];
  /** Saldo inicial del extracto, si se conoce (verificación del saldo corrido). */
  readonly openingBalance: string | null;
}

export type StageName = 'NORMALIZE' | 'VALIDATE' | 'CLASSIFY' | 'DEDUPE' | 'MATCH';

export interface PipelineOutput {
  readonly items: readonly PipelineRowResult[];
  /** Filas de encabezado, preámbulo o pie: quedan sin clasificar. */
  readonly resetIds: readonly string[];
  readonly supersededFingerprints: readonly string[];
  /** La evaluación de reglas falló (`IMPORT_RULES_UNAVAILABLE`). */
  readonly rulesUnavailable: boolean;
}

interface Prepared {
  readonly staged: StagedRow;
  readonly record: StatementRecord;
  readonly normalized: NormalizedRow;
  readonly issues: readonly RowIssue[];
  readonly valid: boolean;
}

/** Reconstruye el registro de un formato autodescrito a partir de las columnas ya guardadas en el staging. */
function recordOfStaged(row: StagedRow, ctx: PipelineContext): StatementRecord {
  const signed =
    row.amount === null || row.direction === null
      ? null
      : (() => {
          try {
            const magnitude = Money.parse(
              row.amount.includes('.') ? trimZeros(row.amount, ctx.scale) : row.amount,
              ctx.currencyCode,
              ctx.scale,
            ).toJSON().amount;
            return row.direction === 'OUT' ? `-${magnitude}` : magnitude;
          } catch {
            return null;
          }
        })();
  return {
    line: row.rowNumber,
    bookingDate: row.bookingDate,
    time: row.bookingTime,
    valueDate: row.valueDate,
    amount: signed,
    currency: ctx.currencyCode,
    description: row.description,
    externalId: row.externalId,
    reference: row.reference,
    counterparty: row.counterpartyText,
    runningBalance: row.runningBalance,
    issues: row.issues,
  };
}

/** `245.300000000000000000` → `245.30` si los decimales sobrantes son ceros; si no, se deja (y falla la escala). */
function trimZeros(amount: string, scale: number): string {
  const [int = '0', frac = ''] = amount.split('.');
  const extra = frac.slice(scale);
  if (/^0*$/.test(extra)) return scale === 0 ? int : `${int}.${frac.slice(0, scale).padEnd(scale, '0')}`;
  return amount;
}

function toNormalized(record: StatementRecord, ctx: PipelineContext): NormalizedRow {
  let amount: string | null = null;
  let signed: string | null = null;
  let direction: 'IN' | 'OUT' | null = null;
  const issues: RowIssue[] = [...record.issues];
  if (record.amount !== null) {
    try {
      const money = Money.parse(record.amount, ctx.currencyCode, ctx.scale);
      amount = money.abs().toJSON().amount;
      if (!money.isZero()) {
        direction = money.isNegative() ? 'OUT' : 'IN';
        signed = money.toJSON().amount;
      }
    } catch {
      if (!issues.some((i) => i.code === 'IMPORT_INVALID_AMOUNT')) {
        issues.push({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
      }
    }
  } else if (!hasErrors(issues)) {
    issues.push({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
  }
  if (record.bookingDate === null && !issues.some((i) => i.code === 'IMPORT_INVALID_DATE')) {
    if (!hasErrors(issues)) issues.push({ code: 'IMPORT_INVALID_DATE', severity: 'ERROR' });
  }
  return {
    lineNumber: record.line,
    bookingDate: record.bookingDate,
    amount,
    direction,
    signedAmount: signed,
    description: record.description,
    issues,
  };
}

/**
 * Pipeline de etapas del import (openspec add-import-pipeline decisiones 7–10 y 13): normalización → validación →
 * clasificación (alias, reglas, categoría por defecto) → duplicados (huella, identificador del banco, puntaje) →
 * coincidencias con compromisos. Orden de la decisión 8: las reglas corren ANTES de los duplicados y de las
 * coincidencias, para que la contraparte y el tipo propuestos entren en el puntaje y en el matching. No escribe en el
 * staging: devuelve lo que el llamador persiste (por bloques). Idempotente: el mismo staging produce el mismo resultado.
 * `onStage` se invoca al empezar cada etapa (punto de control y cancelación).
 */
export async function runStatementPipeline(
  deps: ImportsDeps,
  ctx: PipelineContext,
  staged: readonly StagedRow[],
  hooks: { readonly onStage: (stage: StageName, processedRows: number) => Promise<void> },
): Promise<PipelineOutput> {
  const { workspaceId, accountId } = ctx;
  const stagedByLine = new Map(staged.map((s) => [s.rowNumber, s] as const));
  const today = LocalDate.ofInstant(deps.clock.now(), ctx.timeZone);
  const validation = {
    today,
    futureToleranceDays: deps.settings.futureToleranceDays,
    closedPeriods: ctx.closedPeriods,
  };

  // ── NORMALIZE: registros de datos (tabular: celdas + mapeo; autodescrito: columnas ya guardadas).
  await hooks.onStage('NORMALIZE', 0);
  let records: { readonly staged: StagedRow; readonly record: StatementRecord }[];
  const resetIds: string[] = [];
  if (ctx.mapping !== null) {
    const csv: CsvRecord[] = staged.map((s) => ({ line: s.rowNumber, cells: s.raw }));
    const data = selectDataRecords(csv, ctx.mapping);
    const dataLines = new Set(data.map((r) => r.line));
    for (const s of staged) if (!dataLines.has(s.rowNumber)) resetIds.push(s.id);
    records = data.map((r) => ({
      staged: stagedByLine.get(r.line) as StagedRow,
      record: normalizeStatementRow(r, ctx.mapping as ProfileMapping, {
        currencyCode: ctx.currencyCode,
        scale: ctx.scale,
      }),
    }));
  } else {
    records = staged.map((s) => ({ staged: s, record: recordOfStaged(s, ctx) }));
  }

  // ── VALIDATE
  await hooks.onStage('VALIDATE', records.length);
  const prepared: Prepared[] = records.map(({ staged: s, record }) => {
    const normalized = toNormalized(cleaned(record, ctx), ctx);
    const issues = validateRow(normalized, validation);
    return { staged: s, record, normalized, issues, valid: !hasErrors(issues) };
  });
  const valid = prepared.filter((p) => p.valid);

  // Saldo corrido en el orden del archivo (advertencia por quiebre, sin bloquear).
  const gapIssues = new Map<number, RowIssue>();
  if (valid.some((p) => p.record.runningBalance !== null)) {
    const gaps = verifyRunningBalance(
      valid.map((p) => ({
        line: p.normalized.lineNumber,
        amount: p.normalized.signedAmount,
        runningBalance: p.record.runningBalance,
      })),
      ctx.currencyCode,
      ctx.scale,
      ctx.openingBalance,
    );
    for (const gap of gaps) {
      gapIssues.set(gap.line, {
        code: 'IMPORT_RUNNING_BALANCE_GAP',
        severity: 'WARNING',
        detail: gap.absoluteDifference,
      });
    }
  }

  // Huellas y ordinales de ocurrencia.
  const indexes = occurrenceIndexes(
    valid.map((p) => ({
      bookingDate: p.normalized.bookingDate as string,
      signedAmount: p.normalized.signedAmount as string,
      description: p.normalized.description,
    })),
  );
  const fingerprints = new Map<string, { fingerprint: string; occurrenceIndex: number }>();
  valid.forEach((p, i) => {
    const occurrenceIndex = indexes[i] as number;
    fingerprints.set(p.staged.id, {
      occurrenceIndex,
      fingerprint: rowFingerprint({
        workspaceId,
        accountId,
        bookingDate: p.normalized.bookingDate as string,
        signedAmount: p.normalized.signedAmount as string,
        currency: ctx.currencyCode,
        description: p.normalized.description,
        ...(p.record.externalId ? { externalId: p.record.externalId } : {}),
        occurrenceIndex,
      }),
    });
  });

  // ── CLASSIFY: alias → reglas → categoría por defecto → «sin categoría».
  await hooks.onStage('CLASSIFY', valid.length);
  const classification = await buildProposals(deps, {
    workspaceId,
    accountId,
    currencyCode: ctx.currencyCode,
    rows: valid.map((p) => ({
      id: p.staged.id,
      kind: rulesSubjectKind(p.normalized.direction as 'IN' | 'OUT'),
      date: p.normalized.bookingDate as string,
      amount: p.normalized.amount as string,
      description: p.normalized.description,
      externalSource: p.record.externalId ? `imports.ext:${ctx.format}` : null,
      edits: p.staged.edits,
    })),
  });

  // ── DEDUPE: vínculos por huella y por identificador, y candidatos con puntaje.
  await hooks.onStage('DEDUPE', valid.length);
  const fingerprintLinks = new Map<string, ExistingLink>();
  const externalLinks = new Map<string, { transactionId: string; transactionStatus: string }>();
  const activeLinks = await deps.links.findActive(workspaceId, accountId, [
    ...new Set([...fingerprints.values()].map((f) => f.fingerprint)),
  ]);
  const externalIds = [...new Set(valid.map((p) => p.record.externalId).filter((e): e is string => !!e))];
  const activeExternal =
    externalIds.length > 0 ? await deps.links.findActiveByExternal(workspaceId, accountId, externalIds) : [];
  const linkedIds = [
    ...new Set([...activeLinks.map((l) => l.transactionId), ...activeExternal.map((l) => l.transactionId)]),
  ];
  const statusById = new Map<string, string>();
  if (linkedIds.length > 0) {
    const statuses = await deps.statuses.statusOf({ workspaceId, transactionIds: linkedIds });
    for (const s of statuses) statusById.set(s.transactionId, s.status);
  }
  for (const link of activeLinks) {
    fingerprintLinks.set(link.fingerprint, {
      fingerprint: link.fingerprint,
      transactionId: link.transactionId,
      // Una transacción inexistente se trata como anulada: el vínculo no puede bloquear la fila.
      transactionStatus: statusById.get(link.transactionId) ?? 'VOIDED',
    });
  }
  for (const link of activeExternal) {
    externalLinks.set(link.externalId, {
      transactionId: link.transactionId,
      transactionStatus: statusById.get(link.transactionId) ?? 'VOIDED',
    });
  }

  const scored = new Map<string, readonly ScoredCandidate[]>();
  const needCandidates = valid.filter((p) => {
    const fp = (fingerprints.get(p.staged.id) as { fingerprint: string }).fingerprint;
    const byFp = fingerprintLinks.get(fp);
    if (byFp && byFp.transactionStatus !== 'VOIDED') return false;
    const ext = p.record.externalId ? externalLinks.get(p.record.externalId) : undefined;
    return !(ext && ext.transactionStatus !== 'VOIDED');
  });
  for (let i = 0; i < needCandidates.length; i += CANDIDATE_CHUNK) {
    const chunk = needCandidates.slice(i, i + CANDIDATE_CHUNK);
    const found = await deps.duplicates.findForImport({
      workspaceId,
      accountId,
      windowDays: deps.settings.duplicateWindowDays,
      rows: chunk.map((p) => {
        const effective = classification.get(p.staged.id);
        return {
          rowRef: p.staged.id,
          date: p.normalized.bookingDate as string,
          direction: p.normalized.direction as 'IN' | 'OUT',
          amount: { amount: p.normalized.amount as string, currency: ctx.currencyCode },
          description: p.normalized.description,
          counterpartyId: effective?.effectiveCounterpartyId ?? null,
          externalId: p.record.externalId,
          scoring: true,
        };
      }),
    });
    const alreadyLinked = await deps.links.mergedTransactionIds(workspaceId, accountId, [
      ...new Set(found.flatMap((f) => f.candidates.map((c) => c.transactionId))),
    ]);
    for (const entry of found) {
      const usable = entry.candidates
        .filter(
          (c) => !alreadyLinked.has(c.transactionId) && c.score !== undefined && c.signals !== undefined,
        )
        .map((c): ScoredCandidate => ({
          transactionId: c.transactionId,
          kind: c.kind,
          date: c.date,
          amount: c.amount,
          description: c.description,
          score: c.score as string,
          signals: c.signals as ScoredCandidate['signals'],
        }));
      if (usable.length > 0) scored.set(entry.rowRef, usable);
    }
  }
  const matchable: MatchableRow[] = valid.map((p) => ({
    rowRef: p.staged.id,
    lineNumber: p.normalized.lineNumber,
    bookingDate: p.normalized.bookingDate as string,
    fingerprint: (fingerprints.get(p.staged.id) as { fingerprint: string }).fingerprint,
    externalId: p.record.externalId,
  }));
  const matched = classifyWithScores({
    rows: matchable,
    fingerprintLinks,
    externalLinks,
    candidates: scored,
    thresholds: { high: deps.settings.duplicateHighScore, low: deps.settings.duplicateLowScore },
  });
  const byRef = new Map(matched.rows.map((r) => [r.rowRef, r] as const));

  // ── MATCH: ocurrencias de compromisos candidatas (hasta 3 por fila; nunca se vinculan solas, D121).
  await hooks.onStage('MATCH', valid.length);
  const occurrenceCandidates = new Map<string, readonly OccurrenceCandidateEntry[]>();
  const toMatch = valid.filter((p) => {
    const r = byRef.get(p.staged.id);
    return r !== undefined && r.classification !== 'DUPLICATE_EXACT';
  });
  for (let i = 0; i < toMatch.length; i += MATCH_CHUNK) {
    const chunk = toMatch.slice(i, i + MATCH_CHUNK);
    const rows: OccurrenceMatchRow[] = chunk.map((p) => {
      const edits = p.staged.edits;
      const kind: RowKind =
        edits.kind ?? ((p.normalized.direction === 'IN' ? 'INCOME' : 'EXPENSE') as RowKind);
      const transfer = kind === 'TRANSFER' ? edits.transfer : undefined;
      return {
        rowRef: p.staged.id,
        kind: kind === 'TRANSFER' ? 'TRANSFER' : kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
        accountId,
        ...(transfer ? { toAccountId: transfer.counterAccountId } : {}),
        amount: { amount: p.normalized.amount as string, currency: ctx.currencyCode },
        businessDate: p.normalized.bookingDate as string,
        counterpartyId: classification.get(p.staged.id)?.effectiveCounterpartyId ?? null,
      };
    });
    const result = await deps.matching.findCandidates({ workspaceId, rows });
    for (const entry of result) occurrenceCandidates.set(entry.rowRef, entry.candidates.slice(0, 3));
  }

  // ── Resultado por fila.
  const items: PipelineRowResult[] = prepared.map((p): PipelineRowResult => {
    const base = {
      id: p.staged.id,
      bookingDate: p.normalized.bookingDate,
      bookingTime: p.record.time,
      valueDate: p.record.valueDate,
      amount: p.normalized.amount,
      currency: ctx.currencyCode,
      direction: p.normalized.direction,
      description: p.normalized.description,
      externalId: p.record.externalId,
      reference: p.record.reference,
      counterpartyText: p.record.counterparty,
      runningBalance: p.record.runningBalance,
    };
    if (!p.valid) {
      return {
        ...base,
        occurrenceIndex: null,
        fingerprint: null,
        classification: 'INVALID',
        decision: 'EXCLUDE',
        issues: p.issues,
        matchedTransactionId: null,
        proposal: null,
        candidates: [],
        occurrenceCandidates: [],
        duplicateOfRow: null,
        decidedScore: null,
        warnings: [],
        kind: null,
      };
    }
    const fp = fingerprints.get(p.staged.id) as { fingerprint: string; occurrenceIndex: number };
    const result = byRef.get(p.staged.id) as NonNullable<ReturnType<typeof byRef.get>>;
    const proposed = classification.get(p.staged.id);
    const proposal: ClassificationProposal = proposed?.proposal ?? EMPTY_PROPOSAL;
    // Una decisión previa se conserva solo si la fila es la misma (misma huella): re-mapear no pisa al usuario.
    const prior = p.staged.fingerprint === fp.fingerprint ? p.staged.decision : null;
    let decision: Decision | null;
    switch (result.classification) {
      case 'DUPLICATE_EXACT':
        decision = 'SKIP';
        break;
      case 'NEW':
        decision = prior === 'EXCLUDE' ? 'EXCLUDE' : proposal.exclude ? 'EXCLUDE' : 'CREATE';
        break;
      default:
        decision = prior ?? (result.preselected ? 'SKIP' : null);
    }
    const gap = gapIssues.get(p.normalized.lineNumber);
    const issues = gap ? [...p.issues, gap] : p.issues;
    const warnings: RowIssue[] = proposed?.rulesUnavailable
      ? [{ code: 'IMPORT_RULES_UNAVAILABLE', severity: 'WARNING' }]
      : [];
    return {
      ...base,
      occurrenceIndex: fp.occurrenceIndex,
      fingerprint: fp.fingerprint,
      classification: result.classification,
      decision,
      issues,
      matchedTransactionId: result.matchedTransactionId,
      proposal,
      candidates: result.candidates,
      occurrenceCandidates: occurrenceCandidates.get(p.staged.id) ?? [],
      duplicateOfRow: result.duplicateOfRow,
      decidedScore: prior === null && result.preselected ? result.decidedScore : null,
      warnings,
      kind: p.normalized.direction === 'IN' ? 'INCOME' : 'EXPENSE',
    };
  });

  return {
    items,
    resetIds,
    supersededFingerprints: matched.supersededFingerprints,
    rulesUnavailable: [...classification.values()].some((c) => c.rulesUnavailable),
  };
}

/** Limpieza de prefijos literales de la descripción de un formato autodescrito (el CSV la aplica en el normalizador). */
function cleaned(record: StatementRecord, ctx: PipelineContext): StatementRecord {
  if (ctx.mapping !== null || ctx.descriptionCleanup.length === 0 || record.description === null)
    return record;
  let text = record.description;
  for (const prefix of ctx.descriptionCleanup) {
    if (prefix !== '' && text.toLowerCase().startsWith(prefix.toLowerCase())) {
      text = text.slice(prefix.length).trimStart();
      break;
    }
  }
  return text === record.description ? record : { ...record, description: text === '' ? null : text };
}
