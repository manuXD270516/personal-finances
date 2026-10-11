import { DomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GOAL_LIFECYCLE, GOAL_STATUSES, type GoalStatus } from './goal-lifecycle.js';
import { SavingsGoal, type GoalCreateInput } from './savings-goal.js';

const AT = '2026-10-01T13:00:00.000Z';
const USER = 'user-1';
const AHORRO = 'acct-ahorro';

const input = (over: Partial<GoalCreateInput> = {}): GoalCreateInput => ({
  id: 'goal-1',
  workspaceId: 'ws-1',
  name: 'Fondo de emergencia',
  type: 'EMERGENCY_FUND',
  target: { amount: '15000.00', currency: 'BOB' },
  currencyScale: 2,
  startDate: '2026-10-01',
  targetDate: '2027-03-31',
  linkedAccountIds: [AHORRO],
  priority: 1,
  at: AT,
  by: USER,
  ...over,
});

function code(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return null;
}

const ctx = { hasMovements: false, currencyScale: 2, at: AT, by: USER };

describe('SavingsGoal (FR-GOALS-001)', () => {
  it('[TC-GOALS-SAVINGS-001] el fondo de emergencia nace ACTIVE, versión 1, con la transición CREATE', () => {
    const g = SavingsGoal.create(input());
    expect(g.snapshot).toMatchObject({
      name: 'Fondo de emergencia',
      type: 'EMERGENCY_FUND',
      targetAmount: '15000.00',
      currency: 'BOB',
      status: 'ACTIVE',
      version: 1,
      priority: 1,
      tolerancePercent: '5.00',
      pacePeriods: 3,
      linkedAccountIds: [AHORRO],
    });
    expect(g.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
  });

  it('[TC-GOALS-SAVINGS-002] rechaza objetivo con más decimales, cero, fechas invertidas y nombre vacío o largo', () => {
    expect(code(() => SavingsGoal.create(input({ target: { amount: '9000.005', currency: 'BOB' } })))).toBe(
      'AMOUNT_SCALE_EXCEEDED',
    );
    expect(code(() => SavingsGoal.create(input({ target: { amount: '0.00', currency: 'BOB' } })))).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
    expect(code(() => SavingsGoal.create(input({ target: { amount: '-5.00', currency: 'BOB' } })))).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
    expect(code(() => SavingsGoal.create(input({ startDate: '2026-10-01', targetDate: '2026-09-30' })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => SavingsGoal.create(input({ startDate: '2026-10-01', targetDate: '2026-10-01' })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => SavingsGoal.create(input({ name: '   ' })))).toBe('VALIDATION_FAILED');
    expect(code(() => SavingsGoal.create(input({ name: 'x'.repeat(121) })))).toBe('VALIDATION_FAILED');
    expect(code(() => SavingsGoal.create(input({ type: 'HOUSE' })))).toBe('VALIDATION_FAILED');
    expect(code(() => SavingsGoal.create(input({ priority: 6 })))).toBe('VALIDATION_FAILED');
    expect(code(() => SavingsGoal.create(input({ pacePeriods: 13 })))).toBe('VALIDATION_FAILED');
    expect(code(() => SavingsGoal.create(input({ tolerancePercent: '50.01' })))).toBe('VALIDATION_FAILED');
  });

  it('el nombre se recorta, el objetivo conserva la escala de su moneda y las cuentas se de-duplican', () => {
    const g = SavingsGoal.create(
      input({
        name: '  Laptop  ',
        target: { amount: '9000', currency: 'BOB' },
        linkedAccountIds: [AHORRO, AHORRO],
      }),
    );
    expect(g.snapshot.name).toBe('Laptop');
    expect(g.snapshot.targetAmount).toBe('9000.00');
    expect(g.snapshot.linkedAccountIds).toEqual([AHORRO]);
  });

  it('[TC-GOALS-SAVINGS-005] editar: la moneda se bloquea con movimientos y los cambios suben la versión', () => {
    const g = SavingsGoal.restore(SavingsGoal.create(input()).snapshot);
    expect(
      code(() =>
        g.update({ target: { amount: '10000.00', currency: 'USD' } }, { ...ctx, hasMovements: true }),
      ),
    ).toBe('GOAL_CURRENCY_LOCKED');
    expect(g.version).toBe(1);
    g.update({ target: { amount: '12000.00' }, name: 'Emergencias' }, ctx);
    expect(g.snapshot).toMatchObject({ targetAmount: '12000.00', name: 'Emergencias', version: 2 });
    expect(g.changedFields).toEqual(['name', 'targetAmount']);
    // sin cambios reales no sube la versión
    g.update({ name: 'Emergencias' }, ctx);
    expect(g.version).toBe(2);
    expect(g.changedFields).toEqual([]);
    // sin movimientos sí puede cambiar la moneda
    g.update({ target: { amount: '10000.00', currency: 'USD' } }, ctx);
    expect(g.snapshot.currency).toBe('USD');
  });

  it('[TC-GOALS-SAVINGS-008] una meta terminal no se edita ni acepta movimientos (GOAL_CLOSED)', () => {
    const g = SavingsGoal.create(input());
    g.cancel('2026-10-10', 'Compra postergada', AT, USER);
    expect(g.snapshot).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Compra postergada',
      cancelledOn: '2026-10-10',
    });
    expect(code(() => g.assertAcceptsMovements())).toBe('GOAL_CLOSED');
    expect(code(() => g.update({ name: 'Otro' }, ctx))).toBe('GOAL_CLOSED');
  });

  it('[TC-GOALS-SAVINGS-006] pausar y reanudar son transiciones; una meta pausada sigue aceptando movimientos', () => {
    const g = SavingsGoal.create(input());
    g.pause(AT, USER);
    expect(g.lastTransition).toEqual({ transition: 'PAUSE', from: 'ACTIVE', to: 'PAUSED' });
    expect(code(() => g.assertAcceptsMovements())).toBeNull();
    g.resume(AT, USER);
    expect(g.status).toBe('ACTIVE');
    expect(code(() => g.resume(AT, USER))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-GOALS-SAVINGS-008] cerrar una meta activa e archivar una en curso se rechazan con INVALID_STATUS_TRANSITION', () => {
    const g = SavingsGoal.create(input());
    expect(code(() => g.close('2026-10-10', AT, USER))).toBe('INVALID_STATUS_TRANSITION');
    expect(code(() => g.archive(AT, USER))).toBe('INVALID_STATUS_TRANSITION');
    g.reach('2026-10-20', AT, USER);
    expect(g.snapshot.achievedOn).toBe('2026-10-20');
    g.close('2026-10-25', AT, USER);
    expect(g.snapshot).toMatchObject({ status: 'CLOSED', closedOn: '2026-10-25' });
    g.archive('2026-10-26T00:00:00.000Z', USER);
    expect(g.snapshot.archivedAt).toBe('2026-10-26T00:00:00.000Z');
    expect(g.lastTransition).toBeNull();
    expect(code(() => g.archive(AT, USER))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-GOALS-SAVINGS-037] alcanzar y reabrir por el sistema', () => {
    const g = SavingsGoal.create(input());
    g.reach('2026-10-20', AT, 'SYSTEM');
    expect(g.lastTransition).toEqual({ transition: 'REACH', from: 'ACTIVE', to: 'ACHIEVED' });
    g.reopen(AT, 'SYSTEM');
    expect(g.snapshot).toMatchObject({ status: 'ACTIVE', achievedOn: null });
    expect(code(() => g.reopen(AT, 'SYSTEM'))).toBe('INVALID_STATUS_TRANSITION');
    g.pause(AT, USER);
    g.reach('2026-10-21', AT, 'SYSTEM');
    expect(g.status).toBe('ACHIEVED');
  });

  it('touch sube la versión sin cambiar datos (una versión por movimiento)', () => {
    const g = SavingsGoal.create(input());
    g.touch(['movement'], AT, USER);
    expect(g.version).toBe(2);
    expect(g.lastTransition).toBeNull();
    expect(g.changedFields).toEqual(['movement']);
  });

  it('[TC-GOALS-SAVINGS-004] PBT: ninguna secuencia de transiciones sale de CLOSED ni de CANCELLED', () => {
    const steps = fc.constantFrom('pause', 'resume', 'reach', 'reopen', 'close', 'cancel');
    fc.assert(
      fc.property(fc.array(steps, { minLength: 1, maxLength: 30 }), (seq) => {
        const g = SavingsGoal.create(input());
        let terminal: GoalStatus | null = null;
        for (const step of seq) {
          const before = g.status;
          try {
            if (step === 'pause') g.pause(AT, USER);
            else if (step === 'resume') g.resume(AT, USER);
            else if (step === 'reach') g.reach('2026-10-20', AT, USER);
            else if (step === 'reopen') g.reopen(AT, USER);
            else if (step === 'close') g.close('2026-10-20', AT, USER);
            else g.cancel('2026-10-20', null, AT, USER);
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect(g.status).toBe(before);
          }
          expect(GOAL_STATUSES).toContain(g.status);
          if (terminal !== null) expect(g.status).toBe(terminal);
          if (g.status === 'CLOSED' || g.status === 'CANCELLED') terminal = g.status;
        }
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('la máquina declarada es alcanzable y coherente con los estados', () => {
    expect([...GOAL_LIFECYCLE.reachableStates()].sort()).toEqual([...GOAL_STATUSES].sort());
    expect(GOAL_LIFECYCLE.isTerminal('CLOSED')).toBe(true);
    expect(GOAL_LIFECYCLE.isTerminal('ACHIEVED')).toBe(false);
  });
});
