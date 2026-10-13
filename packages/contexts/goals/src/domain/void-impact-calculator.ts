import { dec, type Decimal } from '@pf/shared-kernel';
import { GoalFunds, type GoalMovement } from './goal-movement.js';
import type { GoalFund } from './goal-types.js';

/**
 * `VoidImpactCalculator` (openspec fix-phase-4-gaps, decisión 3; capability `goals/savings-goals`, requirement
 * "Anulación o revisión de la transacción de un movimiento"): efecto de anular una transacción sobre los fondos de cada
 * meta afectada, por cuenta y fondo. Puro y determinista; no escribe nada.
 *
 * Anular registra el inverso de cada movimiento vigente que respalda la transacción, así que los fondos de
 * `(meta, cuenta, fondo)` quedan en `fondos actuales − Σ monto firmado de esos movimientos` (un aporte baja los fondos;
 * un retiro, que es negativo, los sube). `negative` marca los fondos que quedarían por debajo de cero: la anulación NO
 * se bloquea (D222), solo se avisa.
 */
export interface VoidImpactLine {
  readonly goalId: string;
  readonly accountId: string;
  readonly fund: GoalFund;
  readonly currentFunds: Decimal;
  readonly fundsAfterVoid: Decimal;
  readonly negative: boolean;
}

/**
 * @param live movimientos vigentes (no invertidos) de aporte o retiro que respaldan la transacción.
 * @param movementsByGoal todos los movimientos de cada meta afectada (fuente de los fondos actuales).
 */
export function calculateVoidImpact(
  live: readonly GoalMovement[],
  movementsByGoal: ReadonlyMap<string, readonly GoalMovement[]>,
): VoidImpactLine[] {
  const delta = new Map<string, { goalId: string; accountId: string; fund: GoalFund; change: Decimal }>();
  for (const m of live) {
    const key = `${m.goalId}|${m.accountId}|${m.fund}`;
    const row = delta.get(key) ?? {
      goalId: m.goalId,
      accountId: m.accountId,
      fund: m.fund,
      change: dec('0'),
    };
    row.change = row.change.minus(m.amount.amount);
    delta.set(key, row);
  }
  const lines: VoidImpactLine[] = [];
  for (const row of delta.values()) {
    const funds = new GoalFunds(movementsByGoal.get(row.goalId) ?? []);
    const currentFunds = funds.balance(row.accountId, row.fund);
    const fundsAfterVoid = currentFunds.plus(row.change);
    lines.push({
      goalId: row.goalId,
      accountId: row.accountId,
      fund: row.fund,
      currentFunds,
      fundsAfterVoid,
      negative: fundsAfterVoid.isNegative() && !fundsAfterVoid.isZero(),
    });
  }
  return lines.sort((a, b) =>
    a.goalId === b.goalId
      ? a.accountId === b.accountId
        ? a.fund < b.fund
          ? -1
          : 1
        : a.accountId < b.accountId
          ? -1
          : 1
      : a.goalId < b.goalId
        ? -1
        : 1,
  );
}
