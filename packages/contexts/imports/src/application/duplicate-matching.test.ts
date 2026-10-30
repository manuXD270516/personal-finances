import { describe, expect, it } from 'vitest';
import { classifyWithScores, type MatchableRow, type ScoredCandidate } from './duplicate-matching.js';

const THRESHOLDS = { high: '0.9000', low: '0.6000' };
const SIGNALS = { amount: '0.40', date: '0.20', description: '0.20', counterparty: '0.05', origin: '0.05' };

const row = (n: number, patch: Partial<MatchableRow> = {}): MatchableRow => ({
  rowRef: `r${n}`,
  lineNumber: n,
  bookingDate: '2026-10-02',
  fingerprint: `fp${n}`,
  externalId: null,
  ...patch,
});
const candidate = (id: string, score: string, date = '2026-10-02'): ScoredCandidate => ({
  transactionId: id,
  kind: 'EXPENSE',
  date,
  amount: { amount: '245.30', currency: 'BOB' },
  description: 'Supermercado',
  score,
  signals: SIGNALS,
});

const classify = (
  rows: MatchableRow[],
  candidates: Record<string, ScoredCandidate[]> = {},
  extra: Partial<Parameters<typeof classifyWithScores>[0]> = {},
) =>
  classifyWithScores({
    rows,
    fingerprintLinks: new Map(),
    externalLinks: new Map(),
    candidates: new Map(Object.entries(candidates)),
    thresholds: THRESHOLDS,
    ...extra,
  });

describe('classifyWithScores', () => {
  it('[TC-IMPORTS-PIPELINE-002] un único candidato de confianza alta queda preseleccionado como decisión', () => {
    const [r] = classify([row(1)], { r1: [candidate('t1', '0.9000')] }).rows;
    expect(r).toMatchObject({
      classification: 'DUPLICATE_PROBABLE',
      matchedTransactionId: 't1',
      preselected: true,
      decidedScore: '0.9000',
    });
    expect(r?.candidates[0]).toMatchObject({ confidence: 'HIGH', preselected: true });
  });

  it('[TC-TRANSACTIONS-DEDUPE-011] un candidato de confianza baja sigue siendo posible duplicado sin preselección', () => {
    const [r] = classify([row(1)], { r1: [candidate('t1', '0.5750')] }).rows;
    expect(r).toMatchObject({ classification: 'DUPLICATE_PROBABLE', preselected: false, decidedScore: null });
    expect(r?.candidates[0]?.confidence).toBe('LOW');
  });

  it('dos candidatos de confianza alta no preseleccionan ninguno', () => {
    const [r] = classify([row(1)], { r1: [candidate('t1', '0.9500'), candidate('t2', '0.9100')] }).rows;
    expect(r?.classification).toBe('DUPLICATE_PROBABLE');
    expect(r?.preselected).toBe(false);
  });

  it('cada movimiento existente se empareja con una sola fila (asignación por puntaje)', () => {
    const result = classify([row(1), row(2)], {
      r1: [candidate('t1', '0.7000')],
      r2: [candidate('t1', '0.9000')],
    });
    expect(result.rows.map((r) => [r.classification, r.matchedTransactionId])).toEqual([
      ['NEW', null],
      ['DUPLICATE_PROBABLE', 't1'],
    ]);
  });

  it('[TC-IMPORTS-PIPELINE-052] el mismo identificador del banco con otra descripción es ya importado', () => {
    const [r] = classify(
      [row(1, { externalId: '2026030100017', fingerprint: 'otra' })],
      {},
      {
        externalLinks: new Map([['2026030100017', { transactionId: 'tx9', transactionStatus: 'POSTED' }]]),
      },
    ).rows;
    expect(r).toMatchObject({ classification: 'DUPLICATE_EXACT', matchedTransactionId: 'tx9' });
  });

  it('un vínculo hacia una transacción anulada se supera y la fila se evalúa de nuevo', () => {
    const result = classify(
      [row(1)],
      {},
      {
        fingerprintLinks: new Map([
          ['fp1', { fingerprint: 'fp1', transactionId: 'tx1', transactionStatus: 'VOIDED' }],
        ]),
      },
    );
    expect(result.rows[0]?.classification).toBe('NEW');
    expect(result.supersededFingerprints).toEqual(['fp1']);
  });

  it('[TC-TRANSACTIONS-DEDUPE-012] el segundo movimiento del archivo con el mismo identificador no crea', () => {
    const result = classify([row(5, { externalId: 'X1' }), row(9, { externalId: 'X1' })]);
    expect(result.rows[0]?.classification).toBe('NEW');
    expect(result.rows[1]).toMatchObject({ classification: 'DUPLICATE_EXACT', duplicateOfRow: 5 });
  });

  it('[TC-IMPORTS-PIPELINE-053] sin identificador las dos filas iguales no se tratan como duplicado entre sí', () => {
    const result = classify([row(1), row(2)]);
    expect(result.rows.map((r) => r.classification)).toEqual(['NEW', 'NEW']);
  });

  it('es determinista: el orden de entrada de los candidatos no cambia el resultado', () => {
    const a = classify([row(1), row(2)], {
      r1: [candidate('t1', '0.9000'), candidate('t2', '0.9000')],
      r2: [candidate('t2', '0.9000'), candidate('t1', '0.9000')],
    });
    const b = classify([row(1), row(2)], {
      r1: [candidate('t2', '0.9000'), candidate('t1', '0.9000')],
      r2: [candidate('t1', '0.9000'), candidate('t2', '0.9000')],
    });
    expect(a.rows.map((r) => r.matchedTransactionId)).toEqual(b.rows.map((r) => r.matchedTransactionId));
  });
});
