import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { RolloverCalculator } from './rollover-calculator.js';

const out = (policy: 'NONE' | 'CARRY_POSITIVE' | 'CARRY_ALL', actual: string, cap: string | null = null) =>
  RolloverCalculator.carryOut({
    policy,
    cap: cap === null ? null : dec(cap),
    reference: dec('600'),
    actual: dec(actual),
  });
const effective = (carried: ReturnType<typeof out>) =>
  RolloverCalculator.effectivePlanned(dec('600'), carried).toFixed(2);

describe('RolloverCalculator', () => {
  it('[TC-PLANNING-BUDGET-017] remanente positivo: 600 - 520 = 80 => planificado efectivo 680.00', () => {
    expect(effective(out('CARRY_POSITIVE', '520'))).toBe('680.00');
  });

  it('[TC-PLANNING-BUDGET-017] con tope de 50.00 el planificado efectivo es 650.00', () => {
    expect(effective(out('CARRY_POSITIVE', '520', '50'))).toBe('650.00');
  });

  it('[TC-PLANNING-BUDGET-017] exceso de 50.00: CARRY_ALL => 550.00 y CARRY_POSITIVE => 600.00', () => {
    expect(effective(out('CARRY_ALL', '650'))).toBe('550.00');
    expect(effective(out('CARRY_POSITIVE', '650'))).toBe('600.00');
  });

  it('el tope también acota el exceso trasladado y el planificado efectivo nunca baja de 0.00', () => {
    expect(out('CARRY_ALL', '900', '100').toFixed()).toBe('-100');
    expect(RolloverCalculator.effectivePlanned(dec('600'), dec('-900')).toFixed()).toBe('0');
  });

  it('sin política no hay traslado', () => {
    expect(out('NONE', '100').toFixed()).toBe('0');
  });
});
