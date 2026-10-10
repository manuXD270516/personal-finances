import { describe, expect, it } from 'vitest';
import {
  EMPTY_MAPPING_FORM,
  MAX_FILE_BYTES,
  allowedDecisions,
  applyDecision,
  buildMapping,
  canApprove,
  canDecide,
  candidateKindKey,
  checkFile,
  columnNames,
  errorLines,
  firstMappingError,
  hasTransferCandidates,
  initialMappingOf,
  isCancellable,
  isPolling,
  issueKey,
  mappingFormOf,
  needsDecision,
  pendingDecisionsOf,
  previewPath,
  progressPercent,
  roleOfColumn,
  stepOf,
  summaryPath,
  truncate,
  type MappingForm,
} from './logic';
import type { ImportMapping, ImportPreviewRow, ImportPreviewSummary, ImportRowDecisionResult } from './types';

const bob = (amount: string) => ({ amount, currency: 'BOB' });

const signedForm: MappingForm = {
  ...EMPTY_MAPPING_FORM,
  dateIndex: '0',
  descriptionIndex: '1',
  amountMode: 'SIGNED',
  amountIndex: '2',
  signConvention: 'NEGATIVE_IS_OUTFLOW',
  dateFormat: 'dd/MM/yyyy',
  decimalSeparator: ',',
};

function summary(over: Partial<ImportPreviewSummary['counts']> = {}): ImportPreviewSummary {
  return {
    counts: {
      rows: 4,
      new: 3,
      alreadyImported: 0,
      probableDuplicates: 1,
      invalid: 0,
      pendingDecisions: 1,
      toCreate: 3,
      skipped: 0,
      excluded: 0,
      ...over,
    },
    outflows: bob('36.00'),
    inflows: bob('8000.00'),
    currentBalance: bob('4000.00'),
    resultingBalance: bob('11964.00'),
  };
}

function row(over: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    id: 'r1',
    lineNumber: 2,
    date: '2026-10-01',
    description: 'COMPRA SUPERMERCADO',
    amount: bob('245.30'),
    direction: 'OUT',
    classification: 'DUPLICATE_PROBABLE',
    decision: null,
    issues: [],
    candidate: null,
    transactionId: null,
    failure: null,
    ...over,
  };
}

describe('Importar CSV: archivo (TC-IMPORTS-CSV-001, -003, -005)', () => {
  it('[TC-IMPORTS-CSV-001] acepta .csv/.txt/.tsv hasta 2 MiB y rechaza vacío, grande y otras extensiones', () => {
    expect(checkFile(null)).toBe('none');
    expect(checkFile({ name: 'a.csv', size: 0 })).toBe('empty');
    expect(checkFile({ name: 'EXTRACTO.CSV', size: 10 })).toBe('ok');
    expect(checkFile({ name: 'a.txt', size: 10 })).toBe('ok');
    expect(checkFile({ name: 'a.tsv', size: 10 })).toBe('ok');
    expect(checkFile({ name: 'a.csv', size: MAX_FILE_BYTES })).toBe('ok');
    expect(checkFile({ name: 'a.csv', size: MAX_FILE_BYTES + 1 })).toBe('tooLarge');
    expect(checkFile({ name: 'foto.png', size: 10 })).toBe('extension');
    expect(checkFile({ name: 'extracto', size: 10 })).toBe('extension');
  });
});

describe('Importar CSV: mapeo de columnas (TC-IMPORTS-CSV-006, -007, -008)', () => {
  it('[TC-IMPORTS-CSV-006] arma el mapeo del contrato con una columna con signo (índices base 0)', () => {
    const r = buildMapping(signedForm, 3);
    expect(r).toEqual({
      ok: true,
      mapping: {
        hasHeader: true,
        skipRows: 0,
        columns: {
          date: { index: 0 },
          description: { index: 1 },
          amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
        },
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
      },
    });
  });

  it('[TC-IMPORTS-CSV-007] arma el mapeo con débito y crédito y no exige convención de signo', () => {
    const r = buildMapping(
      {
        ...EMPTY_MAPPING_FORM,
        dateIndex: '0',
        descriptionIndex: '1',
        amountMode: 'DEBIT_CREDIT',
        debitIndex: '2',
        creditIndex: '3',
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        skipRows: '3',
        hasHeader: false,
      },
      4,
    );
    expect(r).toEqual({
      ok: true,
      mapping: {
        hasHeader: false,
        skipRows: 3,
        columns: {
          date: { index: 0 },
          description: { index: 1 },
          amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 },
        },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
      },
    });
  });

  it('[TC-IMPORTS-CSV-008] el formato de fecha, el separador y el signo son explícitos: sin elegir no hay mapeo', () => {
    const r = buildMapping(EMPTY_MAPPING_FORM, 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      dateIndex: 'required',
      descriptionIndex: 'required',
      amountIndex: 'required',
      signConvention: 'required',
      dateFormat: 'required',
      decimalSeparator: 'required',
    });
    expect(firstMappingError(r.errors)).toBe('dateIndex');
  });

  it('rechaza columnas fuera de rango, repetidas, débito igual a crédito y filas a saltar inválidas', () => {
    const out = buildMapping({ ...signedForm, amountIndex: '9' }, 3);
    expect(out.ok === false && out.errors.amountIndex).toBe('range');

    const dup = buildMapping({ ...signedForm, descriptionIndex: '0' }, 3);
    expect(dup.ok === false && dup.errors.descriptionIndex).toBe('duplicate');

    const same = buildMapping(
      { ...signedForm, amountMode: 'DEBIT_CREDIT', debitIndex: '2', creditIndex: '2' },
      3,
    );
    expect(same.ok === false && same.errors.creditIndex).toBe('duplicate');

    expect(buildMapping({ ...signedForm, skipRows: '51' }, 3).ok).toBe(false);
    expect(buildMapping({ ...signedForm, skipRows: 'x' }, 3).ok).toBe(false);
    expect(buildMapping({ ...signedForm, skipRows: '50' }, 3).ok).toBe(true);
  });

  it('precarga el formulario desde el mapeo sugerido y reproduce el mismo mapeo', () => {
    const suggested: ImportMapping = {
      hasHeader: true,
      skipRows: 2,
      columns: {
        date: { index: 1 },
        description: { index: 0 },
        amount: { mode: 'SIGNED', index: 3, signConvention: 'POSITIVE_IS_OUTFLOW' },
      },
      dateFormat: 'MM/dd/yyyy',
      decimalSeparator: '.',
    };
    const form = mappingFormOf(suggested);
    expect(form).toMatchObject({ dateIndex: '1', descriptionIndex: '0', amountIndex: '3', skipRows: '2' });
    expect(buildMapping(form, 4)).toEqual({ ok: true, mapping: suggested });
    expect(initialMappingOf({ suggestedMapping: suggested, mapping: null })).toEqual(form);
    expect(initialMappingOf({ suggestedMapping: null, mapping: null })).toEqual(EMPTY_MAPPING_FORM);
  });

  it('el encabezado solo nombra las columnas cuando el primer registro es el encabezado', () => {
    const header = ['Fecha', 'Descripción', ''];
    expect(columnNames(header, true, '0')).toEqual(['Fecha', 'Descripción', undefined]);
    expect(columnNames(header, false, '0')).toEqual([undefined, undefined, undefined]);
    expect(columnNames(header, true, '2')).toEqual([undefined, undefined, undefined]);
  });

  it('rotula el papel de cada columna según el formulario', () => {
    expect(roleOfColumn(signedForm, 0)).toBe('date');
    expect(roleOfColumn(signedForm, 1)).toBe('description');
    expect(roleOfColumn(signedForm, 2)).toBe('amount');
    expect(roleOfColumn(signedForm, 3)).toBeUndefined();
    const dc: MappingForm = { ...signedForm, amountMode: 'DEBIT_CREDIT', debitIndex: '2', creditIndex: '3' };
    expect(roleOfColumn(dc, 2)).toBe('debit');
    expect(roleOfColumn(dc, 3)).toBe('credit');
  });

  it('recorta textos largos del archivo sin cortar caracteres', () => {
    expect(truncate('corto', 10)).toBe('corto');
    expect(truncate('ab', 1)).toBe('…');
    expect(Array.from(truncate('ñ'.repeat(50), 40))).toHaveLength(40);
  });
});

describe('Importar CSV: revisión, duplicados y aprobación (TC-IMPORTS-CSV-015, -020, -021, -022)', () => {
  it('[TC-IMPORTS-CSV-020] un posible duplicado admite crear, omitir o excluir; una nueva, crear o excluir', () => {
    expect(allowedDecisions(row())).toEqual(['CREATE', 'SKIP', 'EXCLUDE']);
    expect(allowedDecisions(row({ classification: 'NEW', decision: 'CREATE' }))).toEqual([
      'CREATE',
      'EXCLUDE',
    ]);
    expect(allowedDecisions(row({ classification: 'DUPLICATE_EXACT' }))).toEqual([]);
    expect(allowedDecisions(row({ classification: 'INVALID' }))).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-021] el posible duplicado sin decisión espera una decisión', () => {
    expect(needsDecision(row())).toBe(true);
    expect(needsDecision(row({ decision: 'SKIP' }))).toBe(false);
    expect(needsDecision(row({ classification: 'NEW', decision: 'CREATE' }))).toBe(false);
  });

  it('[TC-IMPORTS-CSV-027] solo quien escribe, en revisión, puede decidir', () => {
    expect(canDecide(row(), true, 'AWAITING_REVIEW')).toBe(true);
    expect(canDecide(row(), false, 'AWAITING_REVIEW')).toBe(false);
    expect(canDecide(row(), true, 'APPROVED')).toBe(false);
    expect(canDecide(row({ classification: 'INVALID' }), true, 'AWAITING_REVIEW')).toBe(false);
  });

  it('[TC-IMPORTS-CSV-022] aprobar se bloquea con decisiones pendientes, sin rol, fuera de revisión o sin nada que importar', () => {
    const ok = { canEdit: true, status: 'AWAITING_REVIEW' as const, busy: false };
    expect(canApprove({ ...ok, summary: summary({ pendingDecisions: 1 }) })).toBe(false);
    expect(canApprove({ ...ok, summary: summary({ pendingDecisions: 0 }) })).toBe(true);
    expect(canApprove({ ...ok, summary: undefined })).toBe(false);
    expect(canApprove({ ...ok, summary: summary({ pendingDecisions: 0 }), busy: true })).toBe(false);
    expect(canApprove({ ...ok, canEdit: false, summary: summary({ pendingDecisions: 0 }) })).toBe(false);
    expect(canApprove({ ...ok, status: 'APPROVED', summary: summary({ pendingDecisions: 0 }) })).toBe(false);
    expect(canApprove({ ...ok, summary: summary({ pendingDecisions: 0, toCreate: 0, skipped: 0 }) })).toBe(
      false,
    );
    expect(canApprove({ ...ok, summary: summary({ pendingDecisions: 0, toCreate: 0, skipped: 1 }) })).toBe(
      true,
    );
  });

  it('[TC-IMPORTS-CSV-022] lee pendingDecisions del problema (raíz o details)', () => {
    expect(pendingDecisionsOf({ code: 'IMPORT_REVIEW_INCOMPLETE', pendingDecisions: 2 })).toBe(2);
    expect(pendingDecisionsOf({ code: 'IMPORT_REVIEW_INCOMPLETE', details: { pendingDecisions: 5 } })).toBe(
      5,
    );
    expect(pendingDecisionsOf({ code: 'IMPORT_REVIEW_INCOMPLETE' })).toBeUndefined();
    expect(pendingDecisionsOf({ pendingDecisions: '3' })).toBeUndefined();
  });

  it('aplica el resultado de una decisión solo a su fila', () => {
    const result = {
      ...row({ decision: 'SKIP' }),
      version: 4,
      counters: {
        rows: 4,
        newRows: 3,
        alreadyImported: 0,
        probableDuplicates: 1,
        invalid: 0,
        toCreate: 3,
        skipped: 1,
        excluded: 0,
        created: 0,
        failed: 0,
      },
    } satisfies ImportRowDecisionResult;
    const rows = [row(), row({ id: 'r2', lineNumber: 3 })];
    const next = applyDecision(rows, result);
    expect(next[0]?.decision).toBe('SKIP');
    expect(next[0]).not.toHaveProperty('version');
    expect(next[1]).toBe(rows[1]);
  });

  it('avisa de candidatos que son transferencias o conversiones', () => {
    const cand = (kind: string | null) => ({
      transactionId: 't',
      kind,
      date: null,
      amount: null,
      description: null,
    });
    expect(hasTransferCandidates([row({ candidate: cand('EXPENSE') })])).toBe(false);
    expect(hasTransferCandidates([row({ candidate: cand('TRANSFER') })])).toBe(true);
    expect(hasTransferCandidates([row({ candidate: cand('CONVERSION') })])).toBe(true);
    expect(hasTransferCandidates([row()])).toBe(false);
    expect(candidateKindKey('INCOME')).toBe('candidate.kind.INCOME');
    expect(candidateKindKey('OTRO')).toBe('candidate.kind.UNKNOWN');
    expect(candidateKindKey(null)).toBe('candidate.kind.UNKNOWN');
  });

  it('traduce los motivos de fila conocidos y cae en un texto genérico para los desconocidos', () => {
    expect(issueKey('IMPORT_INVALID_DATE')).toBe('issues.IMPORT_INVALID_DATE');
    expect(issueKey('PERIOD_CLOSED')).toBe('issues.PERIOD_CLOSED');
    expect(issueKey('NUEVO')).toBe('issues.UNKNOWN');
  });

  it('arma las consultas de la vista previa con filtro, cursor y límite', () => {
    expect(previewPath('/workspaces/w', 'i1', {})).toBe('/workspaces/w/imports/i1/preview?limit=50');
    expect(previewPath('/workspaces/w', 'i1', { classification: 'DUPLICATE_PROBABLE', cursor: 'abc' })).toBe(
      '/workspaces/w/imports/i1/preview?classification=DUPLICATE_PROBABLE&cursor=abc&limit=50',
    );
    expect(summaryPath('/workspaces/w', 'i1')).toBe('/workspaces/w/imports/i1/preview?limit=1');
  });
});

describe('Importar CSV: pasos, progreso y resultado (TC-IMPORTS-CSV-023, -024)', () => {
  it('cada estado cae en su paso y solo la persistencia consulta', () => {
    expect(stepOf(undefined)).toBe(1);
    expect(stepOf('AWAITING_MAPPING')).toBe(2);
    expect(stepOf('AWAITING_REVIEW')).toBe(3);
    for (const s of [
      'APPROVED',
      'PERSISTING',
      'COMPLETED',
      'PARTIALLY_FAILED',
      'COMPLETED_WITH_ERRORS',
      'CANCELLED',
    ] as const)
      expect(stepOf(s)).toBe(4);
    expect(isPolling('APPROVED')).toBe(true);
    expect(isPolling('PERSISTING')).toBe(true);
    expect(isPolling('COMPLETED')).toBe(false);
    expect(isPolling('PARTIALLY_FAILED')).toBe(false);
    expect(isCancellable('AWAITING_MAPPING')).toBe(true);
    expect(isCancellable('AWAITING_REVIEW')).toBe(true);
    expect(isCancellable('APPROVED')).toBe(false);
  });

  it('[TC-IMPORTS-CSV-023] el porcentaje de lotes queda acotado y sin lotes es cero', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(2, 5)).toBe(40);
    expect(progressPercent(5, 5)).toBe(100);
    expect(progressPercent(9, 5)).toBe(100);
  });

  it('[TC-IMPORTS-CSV-024] muestra las primeras líneas del grupo y cuántas más hay', () => {
    const lines = Array.from({ length: 100 }, (_, i) => i + 2);
    expect(errorLines({ count: 250, lines }, 10)).toEqual({ shown: lines.slice(0, 10), more: 240 });
    expect(errorLines({ count: 3, lines: [4, 5, 6] }, 10)).toEqual({ shown: [4, 5, 6], more: 0 });
  });
});
