import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { MatchSuggestion } from './match-suggestion.js';
import type { MatchCandidate } from './occurrence-matcher.js';

const AT = '2026-10-19T16:00:00.000Z';

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    occurrenceId: 'occ-1',
    definitionId: 'def-1',
    transactionId: 'tx-1',
    score: '85.00',
    confidence: 'HIGH',
    amountDelta: '0.00',
    currency: 'BOB',
    dateDeltaDays: 1,
    counterparty: 'UNKNOWN',
    ambiguous: false,
    businessDate: '2026-10-19',
    dueDate: '2026-10-20',
    ...over,
  };
}

const propose = (over: Partial<MatchCandidate> = {}) =>
  MatchSuggestion.propose({
    id: 'sug-1',
    workspaceId: 'ws',
    candidate: candidate(over),
    sourceEventId: 'evt-1',
    at: AT,
  });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('MatchSuggestion: estados y transiciones', () => {
  it('nace PROPOSED en versión 1 con el puntaje, la confianza y los motivos del matcher', () => {
    const s = propose();
    expect(s.snapshot).toMatchObject({
      id: 'sug-1',
      workspaceId: 'ws',
      occurrenceId: 'occ-1',
      definitionId: 'def-1',
      transactionId: 'tx-1',
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: '0.00',
      currency: 'BOB',
      dateDeltaDays: 1,
      counterparty: 'UNKNOWN',
      ambiguous: false,
      status: 'PROPOSED',
      expireReason: null,
      sourceEventId: 'evt-1',
      createdAt: AT,
      decidedAt: null,
      decidedBy: null,
      version: 1,
    });
  });

  it('[TC-COMMITMENTS-MATCH-006] confirmar la deja CONFIRMED con quién y cuándo decidió', () => {
    const s = propose();
    s.confirm('user-1', AT);
    expect(s.snapshot).toMatchObject({ status: 'CONFIRMED', decidedBy: 'user-1', decidedAt: AT, version: 2 });
  });

  it('[TC-COMMITMENTS-MATCH-008] descartar la deja DISMISSED', () => {
    const s = propose();
    s.dismiss('user-1', AT);
    expect(s.snapshot).toMatchObject({ status: 'DISMISSED', decidedBy: 'user-1', version: 2 });
  });

  it('[TC-COMMITMENTS-MATCH-007] solo una PROPOSED se confirma o se descarta: si no, MATCH_SUGGESTION_NOT_PENDING', () => {
    for (const make of [
      () => {
        const s = propose();
        s.confirm('u', AT);
        return s;
      },
      () => {
        const s = propose();
        s.dismiss('u', AT);
        return s;
      },
      () => {
        const s = propose();
        s.expire('OCCURRENCE_RESOLVED');
        return s;
      },
    ]) {
      expect(codeOf(() => make().confirm('u', AT))).toBe('MATCH_SUGGESTION_NOT_PENDING');
      expect(codeOf(() => make().dismiss('u', AT))).toBe('MATCH_SUGGESTION_NOT_PENDING');
    }
  });

  it('[TC-COMMITMENTS-MATCH-010] expirar guarda el motivo; solo una PROPOSED expira', () => {
    for (const reason of [
      'TRANSACTION_VOIDED',
      'OCCURRENCE_RESOLVED',
      'OCCURRENCE_CANCELLED',
      'INCOMPATIBLE',
      'SUPERSEDED',
    ] as const) {
      const s = propose();
      s.expire(reason);
      expect(s.snapshot).toMatchObject({ status: 'EXPIRED', expireReason: reason, version: 2 });
      expect(codeOf(() => s.expire('SUPERSEDED'))).toBe('MATCH_SUGGESTION_NOT_PENDING');
    }
  });

  it('[TC-COMMITMENTS-MATCH-010] REPROPOSE solo desde EXPIRED(INCOMPATIBLE): vuelve a PROPOSED con el puntaje nuevo', () => {
    const s = propose();
    s.expire('INCOMPATIBLE');
    s.repropose(candidate({ score: '90.00', dateDeltaDays: 0 }), 'evt-2');
    expect(s.snapshot).toMatchObject({
      status: 'PROPOSED',
      expireReason: null,
      score: '90.00',
      dateDeltaDays: 0,
      sourceEventId: 'evt-2',
      version: 3,
    });
  });

  it('[TC-COMMITMENTS-MATCH-008] una descartada, confirmada o expirada por otro motivo nunca se re-propone', () => {
    const dismissed = propose();
    dismissed.dismiss('u', AT);
    const confirmed = propose();
    confirmed.confirm('u', AT);
    const voided = propose();
    voided.expire('TRANSACTION_VOIDED');
    const proposed = propose();
    for (const s of [dismissed, confirmed, voided, proposed]) {
      expect(codeOf(() => s.repropose(candidate(), 'evt-2'))).toBe('INVALID_STATUS_TRANSITION');
    }
    expect(dismissed.status).toBe('DISMISSED');
  });

  it('refresh recalcula una PROPOSED sin cambiar su estado; sin diferencias no sube la versión', () => {
    const s = propose();
    expect(s.refresh(candidate())).toBe(false);
    expect(s.version).toBe(1);
    expect(s.refresh(candidate({ score: '70.00', confidence: 'MEDIUM', ambiguous: true }))).toBe(true);
    expect(s.snapshot).toMatchObject({
      status: 'PROPOSED',
      score: '70.00',
      confidence: 'MEDIUM',
      ambiguous: true,
    });
    expect(s.version).toBe(2);
    const done = propose();
    done.dismiss('u', AT);
    expect(codeOf(() => done.refresh(candidate({ score: '10.00' })))).toBe('MATCH_SUGGESTION_NOT_PENDING');
  });
});
