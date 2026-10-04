import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { EXCHANGE_RATE_LIFECYCLE } from './exchange-rate-lifecycle.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : 'OTHER';
  }
  return undefined;
};

describe('Máquina de estados ExchangeRate (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-010] una tasa manual se registra y solo puede reemplazarse una vez (SUPERSEDED es terminal)', () => {
    const d = EXCHANGE_RATE_LIFECYCLE.definition;
    expect(d.aggregateType).toBe('ExchangeRate');
    expect(d.states).toEqual([
      { code: 'RECORDED', terminal: false },
      { code: 'SUPERSEDED', terminal: true },
    ]);
    expect(EXCHANGE_RATE_LIFECYCLE.transition('RECORD', null)).toEqual({
      transition: 'RECORD',
      from: null,
      to: 'RECORDED',
    });
    expect(EXCHANGE_RATE_LIFECYCLE.transition('SUPERSEDE', 'RECORDED').to).toBe('SUPERSEDED');
    expect(codeOf(() => EXCHANGE_RATE_LIFECYCLE.transition('SUPERSEDE', 'SUPERSEDED'))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });
});
