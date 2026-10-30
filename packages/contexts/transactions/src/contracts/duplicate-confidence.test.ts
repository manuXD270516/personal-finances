import { describe, expect, it } from 'vitest';
import {
  classifyDuplicateCandidates,
  DEFAULT_DUPLICATE_HIGH_SCORE,
  DEFAULT_DUPLICATE_LOW_SCORE,
} from './duplicate-confidence.js';

describe('classifyDuplicateCandidates (confianza y preselección)', () => {
  const c = (id: string, score: string) => ({ transactionId: id, score });

  it('[TC-TRANSACTIONS-DEDUPE-006] un único candidato de 0.9000 queda preseleccionado', () => {
    const r = classifyDuplicateCandidates([c('a', '0.9000')]);
    expect(r.preselectedTransactionId).toBe('a');
    expect(r.confidences).toEqual([{ transactionId: 'a', confidence: 'HIGH' }]);
  });

  it('[TC-TRANSACTIONS-DEDUPE-007] con dos candidatos de confianza alta no hay preselección', () => {
    const r = classifyDuplicateCandidates([c('a', '0.9500'), c('b', '0.9000')]);
    expect(r.preselectedTransactionId).toBeNull();
    expect(r.confidences.map((x) => x.confidence)).toEqual(['HIGH', 'HIGH']);
  });

  it('[TC-TRANSACTIONS-DEDUPE-008] un candidato de 0.5750 es de confianza baja, sin preselección', () => {
    const r = classifyDuplicateCandidates([c('a', '0.5750')]);
    expect(r.preselectedTransactionId).toBeNull();
    expect(r.confidences).toEqual([{ transactionId: 'a', confidence: 'LOW' }]);
    // 0.6000 ya no es baja; los umbrales son configurables.
    expect(
      classifyDuplicateCandidates([c('a', DEFAULT_DUPLICATE_LOW_SCORE)]).confidences[0]?.confidence,
    ).toBe('MEDIUM');
    expect(
      classifyDuplicateCandidates([c('a', '0.8500')], { high: '0.8000', low: '0.5000' })
        .preselectedTransactionId,
    ).toBe('a');
    expect(DEFAULT_DUPLICATE_HIGH_SCORE).toBe('0.9000');
  });
});
