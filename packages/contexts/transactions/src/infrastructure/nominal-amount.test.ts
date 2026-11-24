import { currency, Money } from '@pf/shared-kernel';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeFlowAmount } from './nominal-amount.js';

/*
 * Contingencia de `fix-trends-report-perf` (tarea 5.2): el armado de las filas de `summarizeNominalFlows` normaliza
 * el NUMERIC(38,18) de PostgreSQL a la escala de la moneda sin pasar por `Decimal` en el caso habitual. La salida debe
 * ser exactamente la de `Money.parse(...).toJSON()` (referencia).
 */

const reference = (amount: string, code: string, scale: number): string => {
  const m = Money.parse(amount, currency(code, scale)).toJSON();
  return m.amount;
};
const outcome = (fn: () => string): string => {
  try {
    return fn();
  } catch (e) {
    return `error:${(e as { code?: string }).code ?? String(e)}`;
  }
};

describe('normalizeFlowAmount (contingencia de TC-REPORTING-REPORTS-055)', () => {
  it('[TC-REPORTING-REPORTS-055] recorta los ceros del NUMERIC(38,18) a la escala de la moneda', () => {
    expect(normalizeFlowAmount('685.000000000000000000', 'BOB', 2).amount).toBe('685.00');
    expect(normalizeFlowAmount('0.001000000000000000', 'BTC', 8).amount).toBe('0.00100000');
    expect(normalizeFlowAmount('-12.500000000000000000', 'USD', 2).amount).toBe('-12.50');
    expect(normalizeFlowAmount('7.000000000000000000', 'JPY', 0).amount).toBe('7');
  });

  it('[TC-REPORTING-REPORTS-055] rechaza más decimales significativos que la escala igual que Money.parse', () => {
    expect(outcome(() => normalizeFlowAmount('1.005000000000000000', 'BOB', 2).amount)).toBe(
      outcome(() => reference('1.005000000000000000', 'BOB', 2)),
    );
    expect(outcome(() => normalizeFlowAmount('1.005000000000000000', 'BOB', 2).amount)).toBe(
      'error:AMOUNT_SCALE_EXCEEDED',
    );
  });

  it('[TC-REPORTING-REPORTS-055] coincide con Money.parse(...).toJSON() en montos generados (también cero negativo y formatos raros)', () => {
    const digits = fc.stringMatching(/^[0-9]{1,12}$/);
    const text = fc.oneof(
      fc
        .tuple(fc.constantFrom('', '-'), digits, fc.stringMatching(/^[0-9]{0,18}$/))
        .map(([sign, int, frac]) => `${sign}${int}${frac === '' ? '' : `.${frac}`}`),
      fc.constantFrom(
        '0',
        '-0',
        '0.000000000000000000',
        '-0.000000000000000000',
        '+5.00',
        '1e3',
        ' 5',
        '5.',
        '.5',
        '',
      ),
    );
    fc.assert(
      fc.property(text, fc.constantFrom(0, 2, 6, 8), (amount, scale) => {
        expect(outcome(() => normalizeFlowAmount(amount, 'XXX', scale).amount)).toBe(
          outcome(() => reference(amount, 'XXX', scale)),
        );
      }),
      { numRuns: 2_000, seed: 20_261_126 },
    );
  }, 60_000);
});
