import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  EMPTY_CONVERSION_FORM,
  blockedOf,
  buildConversion,
  bulkFilterBody,
  bulkSupportsFilter,
  candidatesOf,
  createFromDocumentBody,
  differenceIsZero,
  effectiveField,
  effectiveRatePreview,
  filterIsEmpty,
  filterQuery,
  groupProfilesByInstitution,
  highConfidenceUniqueCount,
  isLowConfidence,
  isPreselectedLink,
  canRevert,
  originKey,
  qifDateOrderBody,
  ratioPercent,
  reconciliationHref,
  rowKindOf,
  rowNeedsCategory,
  ruleOptionsOf,
  stageProgressOf,
} from './pipeline-logic';
import { isCancellable, isPolling, previewPath, stepOf } from './logic';
import { checkStatementFile } from './document-upload';
import type { ImportDuplicateCandidate, ImportPreviewRow, ImportProfile } from './types';

const bob = (amount: string) => ({ amount, currency: 'BOB' });

function row(over: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    id: 'r1',
    lineNumber: 2,
    date: '2026-10-01',
    description: 'COMPRA',
    amount: bob('245.30'),
    direction: 'OUT',
    classification: 'NEW',
    decision: 'CREATE',
    issues: [],
    candidate: null,
    transactionId: null,
    failure: null,
    ...over,
  };
}

const candidate = (over: Partial<ImportDuplicateCandidate> = {}): ImportDuplicateCandidate => ({
  transactionId: 'tx-1',
  kind: 'EXPENSE',
  date: '2026-10-02',
  amount: bob('245.30'),
  description: 'Supermercado',
  score: '0.9000',
  confidence: 'HIGH',
  signals: {
    amount: '1.0000',
    date: '0.8000',
    description: '1.0000',
    counterparty: '0.5000',
    origin: '1.0000',
  },
  preselected: true,
  ...over,
});

describe('pipeline: pasos y estados', () => {
  it('[TC-IMPORTS-PIPELINE-007] el progreso por etapa informa la etapa, la posición y las filas procesadas', () => {
    const p = stageProgressOf({
      stage: 'NORMALIZE',
      progress: { attempt: 0, batchCount: 0, batchesDone: 0, processedRows: 1000, totalRows: 3000 },
    });
    expect(p).toMatchObject({
      stage: 'NORMALIZE',
      position: 2,
      processed: 1000,
      fileRows: 3000,
      percent: 33,
    });
    expect(
      stageProgressOf({ stage: null, progress: { attempt: 0, batchCount: 0, batchesDone: 0 } }),
    ).toMatchObject({
      position: 0,
      percent: 0,
    });
  });

  it('subida y procesando son el paso 1 y se consultan; la lectura fallida es el paso 1 y no se consulta', () => {
    expect(stepOf('UPLOADED')).toBe(1);
    expect(stepOf('PROCESSING')).toBe(1);
    expect(stepOf('PARSE_FAILED')).toBe(1);
    expect(stepOf('COMPLETED_WITH_DIFFERENCE')).toBe(4);
    expect(stepOf('ROLLED_BACK')).toBe(4);
    expect(isPolling('PROCESSING')).toBe(true);
    expect(isPolling('REVERTING')).toBe(true);
    expect(isPolling('PARSE_FAILED')).toBe(false);
    expect(isCancellable('PROCESSING')).toBe(true);
    expect(isCancellable('COMPLETED')).toBe(false);
  });

  it('deshacer solo para quien escribe y con la importación terminada o deshecha parcialmente', () => {
    expect(canRevert('COMPLETED', true)).toBe(true);
    expect(canRevert('COMPLETED_WITH_DIFFERENCE', true)).toBe(true);
    expect(canRevert('PARTIALLY_ROLLED_BACK', true)).toBe(true);
    expect(canRevert('COMPLETED', false)).toBe(false);
    expect(canRevert('ROLLED_BACK', true)).toBe(false);
    expect(canRevert('PERSISTING', true)).toBe(false);
  });
});

describe('pipeline: archivo', () => {
  it('[TC-IMPORTS-PIPELINE-012] valida tamaño y tipo antes de subir (la API decide el formato por contenido)', () => {
    expect(checkStatementFile({ name: 'extracto.ofx', size: 900 })).toBe('ok');
    expect(checkStatementFile({ name: 'extracto.qif', size: 900 })).toBe('ok');
    expect(checkStatementFile({ name: 'extracto.pdf', size: 900 })).toBe('ok'); // PDF con texto: desde add-pdf-statement-parser se lee en el worker
    expect(checkStatementFile({ name: 'x.exe', size: 10 })).toBe('type');
    expect(checkStatementFile({ name: 'x.csv', size: 0 })).toBe('empty');
    expect(checkStatementFile({ name: 'x.csv', size: 21 * 1024 * 1024 })).toBe('tooLarge');
    expect(checkStatementFile(null)).toBe('none');
  });

  it('el cuerpo de crear desde documento incluye el perfil solo si se eligió', () => {
    expect(createFromDocumentBody({ accountId: 'a', documentId: 'd' })).toEqual({
      accountId: 'a',
      documentId: 'd',
    });
    expect(createFromDocumentBody({ accountId: 'a', documentId: 'd', mappingProfileId: 'p' })).toEqual({
      accountId: 'a',
      documentId: 'd',
      mappingProfileId: 'p',
    });
  });

  it('el cuerpo de QIF solo lleva el orden de la fecha', () => {
    expect(qifDateOrderBody('DMY')).toEqual({ version: 'imports.profile.v1', dateOrder: 'DMY' });
  });
});

describe('pipeline: filtros y edición en lote', () => {
  it('[TC-IMPORTS-PIPELINE-042] el filtro vacío no envía parámetros y el de sin categoría viaja a la lista y al lote', () => {
    expect(filterIsEmpty(EMPTY_FILTER)).toBe(true);
    expect(filterQuery(EMPTY_FILTER)).toEqual({});
    const f = { ...EMPTY_FILTER, needsCategory: true, ruleId: 'r-1' };
    expect(filterQuery(f)).toEqual({ needsCategory: true, ruleId: 'r-1' });
    expect(bulkFilterBody(f)).toEqual({ needsCategory: true, ruleId: 'r-1' });
    expect(previewPath('/w/1', 'i1', { ...filterQuery(f), limit: 50 })).toBe(
      '/w/1/imports/i1/preview?needsCategory=true&ruleId=r-1&limit=50',
    );
  });

  it('el filtro por confianza se manda a la lista pero no a la edición en lote', () => {
    const f = { ...EMPTY_FILTER, confidence: 'LOW' as const };
    expect(filterQuery(f)).toEqual({ candidateConfidence: 'LOW' });
    expect(bulkSupportsFilter(f)).toBe(false);
    expect(bulkSupportsFilter(EMPTY_FILTER)).toBe(true);
  });

  it('las opciones del filtro por regla salen de las filas cargadas, sin repetir', () => {
    const withRule = (id: string, v: number) =>
      row({
        id,
        proposal: {
          needsCategory: false,
          categoryId: { value: 'c', origin: 'RULE', ruleId: 'rule-1', ruleVersion: v },
        },
      });
    expect(ruleOptionsOf([withRule('a', 2), withRule('b', 2), row()])).toEqual([
      { ruleId: 'rule-1', version: 2 },
    ]);
  });
});

describe('pipeline: origen por campo', () => {
  it('[TC-IMPORTS-PIPELINE-041] lo editado tiene origen manual y se impone a la propuesta de la regla', () => {
    const r = row({
      proposal: {
        needsCategory: false,
        categoryId: { value: 'cat-transporte', origin: 'RULE', ruleId: 'rule-1', ruleVersion: 3 },
      },
      edits: { categoryId: 'cat-hogar' },
    });
    expect(effectiveField(r, 'categoryId')).toMatchObject({ value: 'cat-hogar', origin: 'MANUAL' });
    expect(effectiveField(row({ proposal: r.proposal ?? null }), 'categoryId')).toMatchObject({
      value: 'cat-transporte',
      origin: 'RULE',
      ruleId: 'rule-1',
      ruleVersion: 3,
    });
    expect(originKey('RULE')).toBe('origin.RULE');
    expect(originKey(null)).toBe('origin.NONE');
  });

  it('una categoría vaciada a propósito cuenta como edición manual y la fila sigue sin categoría', () => {
    const r = row({ edits: { categoryId: null } });
    expect(effectiveField(r, 'categoryId')).toMatchObject({ value: null, origin: 'MANUAL' });
    expect(rowNeedsCategory(r)).toBe(true);
    expect(rowNeedsCategory(row({ edits: { categoryId: 'c' } }))).toBe(false);
  });

  it('el tipo efectivo sale del servidor, de la transferencia/conversión o de la dirección', () => {
    expect(rowKindOf(row())).toBe('EXPENSE');
    expect(rowKindOf(row({ direction: 'IN' }))).toBe('INCOME');
    expect(rowKindOf(row({ transfer: { counterAccountId: 'v' } }))).toBe('TRANSFER');
    expect(rowKindOf(row({ kind: 'CONVERSION' }))).toBe('CONVERSION');
  });
});

describe('pipeline: candidatos de duplicado', () => {
  it('[TC-IMPORTS-PIPELINE-002] una vinculación preseleccionada (SKIP sin autor) se reconoce como tal', () => {
    const r = row({
      classification: 'DUPLICATE_PROBABLE',
      decision: 'SKIP',
      decidedBy: null,
      candidates: [candidate()],
    });
    expect(isPreselectedLink(r)).toBe(true);
    expect(isPreselectedLink({ ...r, decidedBy: 'u1' })).toBe(false);
    expect(candidatesOf(row())).toEqual([]);
  });

  it('todos los candidatos de confianza baja rotulan la fila (igual exige decisión)', () => {
    const low = row({ candidates: [candidate({ confidence: 'LOW', score: '0.5750', preselected: false })] });
    expect(isLowConfidence(low)).toBe(true);
    expect(isLowConfidence(row({ candidates: [candidate()] }))).toBe(false);
    expect(isLowConfidence(row())).toBe(false);
  });
});

describe('pipeline: coincidencias con compromisos', () => {
  it('[TC-IMPORTS-PIPELINE-050] cuenta solo las filas con una única candidata de confianza alta y sin vínculo', () => {
    const occ = (confidence: 'HIGH' | 'LOW') => ({
      occurrenceId: 'o',
      confidence,
      dueDate: '2026-10-20',
      label: 'Internet',
    });
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row({ id: `h${i}`, occurrenceCandidates: [occ('HIGH')] })),
      row({ id: 'amb1', occurrenceCandidates: [occ('HIGH'), occ('HIGH')] }),
      row({ id: 'amb2', occurrenceCandidates: [occ('LOW')] }),
      row({ id: 'done', occurrenceCandidates: [occ('HIGH')], occurrenceLink: { occurrenceId: 'o' } }),
    ];
    expect(highConfidenceUniqueCount(rows)).toBe(5);
  });
});

describe('pipeline: conversión', () => {
  it('[TC-IMPORTS-PIPELINE-046] arma la conversión con montos como texto y la moneda de cada cuenta', () => {
    const built = buildConversion(
      { counterAccountId: 'usd', counterAmount: '100.00', fee: '', quotedRate: '' },
      { counterCurrency: 'USD', rowCurrency: 'BOB' },
    );
    expect(built).toEqual({
      ok: true,
      body: { counterAccountId: 'usd', counterAmount: { amount: '100.00', currency: 'USD' } },
    });
    const withExtras = buildConversion(
      { counterAccountId: 'usd', counterAmount: '100.00', fee: '1.50', quotedRate: '6.96' },
      { counterCurrency: 'USD', rowCurrency: 'BOB' },
    );
    expect(withExtras).toMatchObject({
      ok: true,
      body: { fee: { amount: '1.50', currency: 'BOB' }, quotedRate: '6.96' },
    });
  });

  it('rechaza cuenta vacía, montos no positivos o con formato inválido y moneda desconocida', () => {
    const bad = buildConversion(EMPTY_CONVERSION_FORM, { counterCurrency: undefined, rowCurrency: 'BOB' });
    expect(bad).toEqual({ ok: false, errors: { account: true, currency: true, amount: true } });
    const zero = buildConversion(
      { counterAccountId: 'u', counterAmount: '0.00', fee: '-1', quotedRate: 'abc' },
      { counterCurrency: 'USD', rowCurrency: 'BOB' },
    );
    expect(zero).toMatchObject({ ok: false, errors: { amount: true, fee: true, rate: true } });
  });

  it('[TC-IMPORTS-PIPELINE-046] la tasa efectiva de 696.00 BOB por 100.00 USD se muestra como 6.96 (sin number)', () => {
    expect(effectiveRatePreview('696.00', '100.00')).toBe('6.96');
    expect(effectiveRatePreview('100.00', '696.00')).toBe('6.96');
    expect(effectiveRatePreview('10', '3')).toBe('3.333333');
    expect(effectiveRatePreview('x', '1')).toBeNull();
  });
});

describe('pipeline: resultado', () => {
  it('[TC-IMPORTS-PIPELINE-069] la cobertura 0.7193 se muestra como 71.93 sin pasar por number', () => {
    expect(ratioPercent('0.7193')).toBe('71.93');
    expect(ratioPercent('0.0000')).toBe('0.00');
    expect(ratioPercent('1.0000')).toBe('100.00');
  });

  it('[TC-IMPORTS-PIPELINE-058] la diferencia cero se detecta por texto', () => {
    expect(differenceIsZero('0.00')).toBe(true);
    expect(differenceIsZero('-0.00')).toBe(true);
    expect(differenceIsZero('18.00')).toBe(false);
  });

  it('[TC-IMPORTS-PIPELINE-057] la oferta de reconciliación prellena fecha y saldo del extracto', () => {
    const href = reconciliationHref((p) => `/es${p}`, {
      accountId: 'acc-1',
      statementDate: '2026-03-31',
      statementBalance: bob('1019.32'),
    });
    expect(href).toBe('/es/cuentas/acc-1/reconciliar?fecha=2026-03-31&saldo=1019.32');
  });

  it('[TC-IMPORTS-PIPELINE-060] el 409 IMPORT_REVERT_BLOCKED entrega las filas bloqueadas en details.blocked', () => {
    const blocked = [{ rowId: 'r', lineNumber: 3, transactionId: 't', reason: 'RECONCILED' }];
    expect(blockedOf({ code: 'IMPORT_REVERT_BLOCKED', details: { blocked } })).toEqual(blocked);
    expect(blockedOf({ code: 'IMPORT_REVERT_BLOCKED' })).toEqual([]);
  });
});

describe('perfiles', () => {
  const profile = (id: string, institutionId: string | null): ImportProfile => ({
    id,
    name: id,
    format: 'CSV',
    institutionId,
    accountId: null,
    version: 1,
    options: {},
    optionsSchemaVersion: 1,
    archivedAt: null,
    versions: [],
    createdAt: '2026-10-20T14:00:00Z',
    updatedAt: '2026-10-20T14:00:00Z',
  });

  it('[TC-IMPORTS-PIPELINE-025] agrupa por institución conservando el orden recibido', () => {
    const groups = groupProfilesByInstitution([profile('a', 'i1'), profile('b', null), profile('c', 'i1')]);
    expect(groups.map((g) => [g.institutionId, g.profiles.map((p) => p.id)])).toEqual([
      ['i1', ['a', 'c']],
      ['', ['b']],
    ]);
  });
});
