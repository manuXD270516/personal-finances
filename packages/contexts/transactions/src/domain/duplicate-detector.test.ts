import { describe, expect, it } from 'vitest';
import { findDuplicates, normalizeText } from './duplicate-detector.js';
import { BANK_A, bob, CARD } from './fixtures.test-support.js';

const base = {
  id: 'a',
  accountId: BANK_A,
  amount: bob('85.40'),
  businessDate: '2026-09-28',
  description: 'Farmacia Chávez',
  counterpartyId: null,
  status: 'POSTED' as const,
};

describe('DuplicateDetector', () => {
  it('[TC-TRANSACTIONS-DUPLICATE-001] misma cuenta, monto y ±3 días con descripción similar ⇒ candidato', () => {
    const probe = {
      accountId: BANK_A,
      amount: bob('85.40'),
      businessDate: '2026-09-30',
      description: 'FARMACIA chavez',
    };
    expect(findDuplicates(probe, [base]).map((c) => c.id)).toEqual(['a']);
    expect(findDuplicates({ ...probe, businessDate: '2026-10-02' }, [base])).toEqual([]);
    expect(findDuplicates({ ...probe, accountId: CARD }, [base])).toEqual([]);
    expect(findDuplicates({ ...probe, amount: bob('85.41') }, [base])).toEqual([]);
    expect(findDuplicates(probe, [{ ...base, status: 'VOIDED' }])).toEqual([]);
    expect(findDuplicates({ ...probe, excludeTransactionId: 'a' }, [base])).toEqual([]);
    expect(
      findDuplicates({ ...probe, description: 'Otro', counterpartyId: 'cp' }, [
        { ...base, counterpartyId: 'cp' },
      ]),
    ).toHaveLength(1);
    expect(findDuplicates({ ...probe, description: 'Farm' }, [base])).toEqual([]);
  });

  it('normaliza acentos, mayúsculas y espacios', () => {
    expect(normalizeText('  Ñandú   CAFÉ ')).toBe('nandu cafe');
  });
});
