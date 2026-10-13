import { Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { contribution, reversalOf, withdrawal, type GoalMovement } from './goal-movement.js';
import { calculateVoidImpact } from './void-impact-calculator.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
let seq = 0;
const id = () => `m-${(seq += 1)}`;
const GOAL = 'goal-fondo';
const AHORRO = 'acct-ahorro';
const BANCO = 'acct-banco';

const contrib = (amount: string, tx: string, accountId = AHORRO, goalId = GOAL) =>
  contribution({
    id: id(),
    goalId,
    fund: 'REAL',
    amount: bob(amount),
    accountId,
    occurredOn: '2026-10-01',
    origin: 'USER',
    transactionId: tx,
    transactionRevision: 1,
  });
const withdrew = (amount: string, tx: string, accountId = AHORRO) =>
  withdrawal({
    id: id(),
    goalId: GOAL,
    fund: 'REAL',
    amount: bob(amount),
    accountId,
    occurredOn: '2026-10-10',
    origin: 'USER',
    transactionId: tx,
    transactionRevision: 1,
  });

const byGoal = (movements: readonly GoalMovement[]) => {
  const out = new Map<string, GoalMovement[]>();
  for (const m of movements) out.set(m.goalId, [...(out.get(m.goalId) ?? []), m]);
  return out;
};

describe('VoidImpactCalculator (fix-phase-4-gaps, decisión 3)', () => {
  it('[TC-GOALS-SAVINGS-051] anular un aporte de 1000.00 con un retiro posterior de 400.00 deja −400.00 BOB, negativo', () => {
    const aporte = contrib('1000.00', 'tx-aporte');
    const retiro = withdrew('400.00', 'tx-retiro');
    const [line, ...rest] = calculateVoidImpact([aporte], byGoal([aporte, retiro]));
    expect(rest).toEqual([]);
    expect(line?.goalId).toBe(GOAL);
    expect(line?.accountId).toBe(AHORRO);
    expect(line?.fund).toBe('REAL');
    expect(line?.currentFunds.toFixed(2)).toBe('600.00');
    expect(line?.fundsAfterVoid.toFixed(2)).toBe('-400.00');
    expect(line?.negative).toBe(true);
  });

  it('[TC-GOALS-SAVINGS-051] sin retiros posteriores los fondos quedan en cero y no es negativo', () => {
    const aporte = contrib('1000.00', 'tx-aporte');
    const [line] = calculateVoidImpact([aporte], byGoal([aporte]));
    expect(line?.fundsAfterVoid.toFixed(2)).toBe('0.00');
    expect(line?.negative).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-051] anular un retiro sube los fondos (el inverso de un movimiento negativo es positivo)', () => {
    const aporte = contrib('1000.00', 'tx-aporte');
    const retiro = withdrew('400.00', 'tx-retiro');
    const [line] = calculateVoidImpact([retiro], byGoal([aporte, retiro]));
    expect(line?.currentFunds.toFixed(2)).toBe('600.00');
    expect(line?.fundsAfterVoid.toFixed(2)).toBe('1000.00');
    expect(line?.negative).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-051] por cuenta: solo la cuenta de la transacción cambia; otra cuenta de la meta no figura', () => {
    const aporte = contrib('1000.00', 'tx-aporte');
    const otro = contrib('300.00', 'tx-otro', BANCO);
    const lines = calculateVoidImpact([aporte], byGoal([aporte, otro]));
    expect(lines.map((l) => [l.accountId, l.fundsAfterVoid.toFixed(2)])).toEqual([[AHORRO, '0.00']]);
  });

  it('[TC-GOALS-SAVINGS-051] la anulación de una transferencia que respalda aportes a dos metas informa cada meta', () => {
    const a = contrib('600.00', 'tx-doble', AHORRO, 'goal-a');
    const b = contrib('400.00', 'tx-doble', AHORRO, 'goal-b');
    const lines = calculateVoidImpact([b, a], byGoal([a, b]));
    expect(lines.map((l) => [l.goalId, l.fundsAfterVoid.toFixed(2)])).toEqual([
      ['goal-a', '0.00'],
      ['goal-b', '0.00'],
    ]);
  });

  it('[TC-GOALS-SAVINGS-051] los movimientos inversos ya registrados cuentan en los fondos actuales', () => {
    const aporte = contrib('1000.00', 'tx-aporte');
    const segundo = contrib('500.00', 'tx-segundo');
    const inverso = reversalOf(segundo, { id: id(), occurredOn: '2026-10-12', origin: 'SYSTEM' });
    const [line] = calculateVoidImpact([aporte], byGoal([aporte, segundo, inverso]));
    expect(line?.currentFunds.toFixed(2)).toBe('1000.00');
    expect(line?.fundsAfterVoid.toFixed(2)).toBe('0.00');
  });

  it('[TC-GOALS-SAVINGS-051] sin movimientos vigentes no hay impacto', () => {
    expect(calculateVoidImpact([], new Map())).toEqual([]);
  });

  it('[TC-GOALS-SAVINGS-051] PBT: fondos después = fondos actuales − aporte y negativo ⇔ después < 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (contributionCents, withdrawnCents) => {
          const money = (cents: number) => Money.ofMinorUnits(BigInt(cents), BOB).toFixed();
          const aporte = contrib(money(contributionCents), 'tx-pbt');
          const movements = [aporte];
          if (withdrawnCents > 0) movements.push(withdrew(money(withdrawnCents), 'tx-pbt-retiro'));
          const [line] = calculateVoidImpact([aporte], byGoal(movements));
          expect(line?.currentFunds.toFixed(2)).toBe(
            Money.ofMinorUnits(BigInt(contributionCents - withdrawnCents), BOB).toFixed(),
          );
          expect(line?.fundsAfterVoid.toFixed(2)).toBe(
            Money.ofMinorUnits(BigInt(-withdrawnCents), BOB).toFixed(),
          );
          expect(line?.negative).toBe(withdrawnCents > 0);
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
