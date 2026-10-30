import { describe, expect, it } from 'vitest';
import { statementDifference, verifyRunningBalance } from './running-balance.js';

describe('saldo corrido y saldo del extracto', () => {
  it('[TC-IMPORTS-PIPELINE-036] una ruptura se advierte en la línea exacta con su diferencia de 10.00', () => {
    const gaps = verifyRunningBalance(
      [
        { line: 5, amount: '-245.30', runningBalance: '754.70' },
        { line: 6, amount: '-18.00', runningBalance: '726.70' },
      ],
      'BOB',
      2,
    );
    expect(gaps).toEqual([
      {
        line: 6,
        actual: '726.70',
        expected: '736.70',
        difference: '-10.00',
        absoluteDifference: '10.00',
      },
    ]);
  });

  it('[TC-IMPORTS-PIPELINE-036] sin ruptura no hay advertencias; el saldo inicial valida la primera fila', () => {
    const rows = [
      { line: 2, amount: '-245.30', runningBalance: '754.70' },
      { line: 3, amount: '1000.00', runningBalance: '1754.70' },
    ];
    expect(verifyRunningBalance(rows, 'BOB', 2)).toEqual([]);
    expect(verifyRunningBalance(rows, 'BOB', 2, '1000.00')).toEqual([]);
    expect(verifyRunningBalance(rows, 'BOB', 2, '900.00').map((g) => g.line)).toEqual([2]);
  });

  it('una ruptura se advierte una sola vez (la base pasa a ser el saldo declarado) y las filas inválidas se saltan', () => {
    const gaps = verifyRunningBalance(
      [
        { line: 1, amount: '-10.00', runningBalance: '90.00' },
        { line: 2, amount: null, runningBalance: null },
        { line: 3, amount: '-10.00', runningBalance: '70.00' },
        { line: 4, amount: '-10.00', runningBalance: '60.00' },
      ],
      'BOB',
      2,
    );
    expect(gaps.map((g) => [g.line, g.absoluteDifference])).toEqual([[3, '10.00']]);
  });

  it('[TC-IMPORTS-PIPELINE-037] la diferencia entre 11700.70 y el saldo resultante 11718.70 es de 18.00', () => {
    const diff = statementDifference('11700.70', '11718.70', 'BOB', 2);
    expect(diff.absoluteDifference).toBe('18.00');
    expect(diff.difference).toBe('-18.00');
    expect(diff.matches).toBe(false);
    expect(statementDifference('11964.00', '11964.00', 'BOB', 2).matches).toBe(true);
  });
});
