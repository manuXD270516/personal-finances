import { currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { computeCommitted, countsAsCommittedOutflow, type AccountClass } from './committed-calculator.js';

const currencyOf = (code: string) => currency(code, 2);
const liquid: AccountClass = { nature: 'ASSET', liquidity: 'LIQUID' };
const savings: AccountClass = { nature: 'ASSET', liquidity: 'SEMI_LIQUID' };
const card: AccountClass = { nature: 'LIABILITY', liquidity: 'ILLIQUID' };

describe('Total comprometido: cálculo exacto', () => {
  it('[TC-COMMITMENTS-RECUR-036] suma ocurrencias no resueltas y pendientes por separado, sin doble conteo', () => {
    const result = computeCommitted({
      lines: [
        { id: 'internet', source: 'OCCURRENCE', currency: 'BOB', amount: '199.00' },
        { id: 'luz', source: 'OCCURRENCE', currency: 'BOB', amount: '150.00' },
        { id: 'gym', source: 'OCCURRENCE', currency: 'BOB', amount: '180.00' },
        { id: 'pend', source: 'PENDING', currency: 'BOB', amount: '250.00' },
      ],
      income: [{ id: 'sueldo', source: 'OCCURRENCE', currency: 'BOB', amount: '9000.00' }],
      currencyOf,
    });
    expect(result.byCurrency).toEqual([
      { currency: 'BOB', occurrences: '529.00', pending: '250.00', total: '779.00' },
    ]);
    expect(result.expectedIncome).toEqual([{ currency: 'BOB', amount: '9000.00' }]);
    expect(result.withoutAmount).toEqual([]);
  });

  it('[TC-COMMITMENTS-RECUR-037] las ocurrencias VARIABLE no suman y se informan aparte', () => {
    const result = computeCommitted({
      lines: [
        { id: 'a', source: 'OCCURRENCE', currency: 'BOB', amount: '779.00' },
        { id: 'mayorista', source: 'OCCURRENCE', currency: 'BOB', amount: null },
        { id: 'spotify', source: 'OCCURRENCE', currency: 'USD', amount: '5.99' },
      ],
      income: [],
      currencyOf,
    });
    expect(result.byCurrency.map((c) => [c.currency, c.total])).toEqual([
      ['BOB', '779.00'],
      ['USD', '5.99'],
    ]);
    expect(result.withoutAmount.map((l) => l.id)).toEqual(['mayorista']);
  });

  it('[TC-COMMITMENTS-RECUR-052] sumas exactas sin float: 0.1 + 0.2 = 0.30', () => {
    const result = computeCommitted({
      lines: [
        { id: 'a', source: 'OCCURRENCE', currency: 'BOB', amount: '0.10' },
        { id: 'b', source: 'PENDING', currency: 'BOB', amount: '0.20' },
      ],
      income: [],
      currencyOf,
    });
    expect(result.byCurrency[0]?.total).toBe('0.30');
  });

  it('criterio de transferencias (D127): solo de cuenta líquida a no líquida; un egreso siempre', () => {
    expect(countsAsCommittedOutflow({ kind: 'EXPENSE', from: liquid })).toBe(true);
    expect(countsAsCommittedOutflow({ kind: 'TRANSFER', from: liquid, to: card })).toBe(true);
    expect(countsAsCommittedOutflow({ kind: 'TRANSFER', from: liquid, to: savings })).toBe(true);
    expect(countsAsCommittedOutflow({ kind: 'TRANSFER', from: liquid, to: liquid })).toBe(false);
    expect(countsAsCommittedOutflow({ kind: 'TRANSFER', from: savings, to: liquid })).toBe(false);
    expect(countsAsCommittedOutflow({ kind: 'INCOME', from: liquid })).toBe(false);
    expect(countsAsCommittedOutflow({ kind: 'TRANSFER', from: liquid })).toBe(false);
  });
});
