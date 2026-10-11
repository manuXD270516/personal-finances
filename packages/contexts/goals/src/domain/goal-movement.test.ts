import { DomainError, Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GoalFunds,
  assertSignConsistent,
  contribution,
  reassignment,
  reversalOf,
  withdrawal,
  type GoalMovement,
} from './goal-movement.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
let seq = 0;
const id = () => `m-${(seq += 1)}`;
const GOAL = 'goal-1';
const AHORRO = 'acct-ahorro';
const BANCO = 'acct-banco';

const real = (amount: string, accountId = AHORRO, tx = `tx-${seq}`) =>
  contribution({
    id: id(),
    goalId: GOAL,
    fund: 'REAL',
    amount: bob(amount),
    accountId,
    occurredOn: '2026-10-15',
    origin: 'USER',
    transactionId: tx,
    transactionRevision: 1,
  });
const earmark = (amount: string, accountId = BANCO) =>
  contribution({
    id: id(),
    goalId: GOAL,
    fund: 'EARMARK',
    amount: bob(amount),
    accountId,
    occurredOn: '2026-10-15',
    origin: 'USER',
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

describe('GoalMovement y GoalFunds (INV-018, FR-GOALS-005)', () => {
  it('[TC-GOALS-SAVINGS-029] saldo acumulado = +1000 +500 −500 (inverso) −400 (retiro) = 600.00 BOB', () => {
    const a = real('1000.00');
    const b = real('500.00');
    const inverse = reversalOf(b, { id: id(), occurredOn: '2026-10-21', origin: 'SYSTEM' });
    const w = withdrawal({
      id: id(),
      goalId: GOAL,
      fund: 'REAL',
      amount: bob('400.00'),
      accountId: AHORRO,
      occurredOn: '2026-10-22',
      origin: 'USER',
      transactionId: 'tx-w',
      transactionRevision: 1,
      note: 'Gasto médico',
    });
    const funds = new GoalFunds([a, b, inverse, w]);
    expect(funds.totalsByCurrency().map((m) => m.toString())).toEqual([bob('600.00').toString()]);
    expect(funds.balance(AHORRO, 'REAL').toFixed(2)).toBe('600.00');
    expect(inverse.amount.toFixed()).toBe('-500.00');
    expect(inverse.reversesId).toBe(b.id);
    expect(w.amount.toFixed()).toBe('-400.00');
    expect(w.note).toBe('Gasto médico');
  });

  it('una reserva no referencia ninguna transacción y un aporte real la exige', () => {
    expect(earmark('2000.00')).toMatchObject({ transactionId: null, transactionRevision: null });
    expect(
      code(() =>
        contribution({
          id: id(),
          goalId: GOAL,
          fund: 'REAL',
          amount: bob('10.00'),
          accountId: AHORRO,
          occurredOn: '2026-10-15',
          origin: 'USER',
        }),
      ),
    ).toBe('INTERNAL_ERROR');
    expect(
      code(() =>
        contribution({
          id: id(),
          goalId: GOAL,
          fund: 'EARMARK',
          amount: bob('10.00'),
          accountId: BANCO,
          occurredOn: '2026-10-15',
          origin: 'USER',
          transactionId: 'tx',
          transactionRevision: 1,
        }),
      ),
    ).toBe('INTERNAL_ERROR');
  });

  it('rechaza montos cero o negativos en aportes y retiros', () => {
    expect(code(() => earmark('0.00'))).toBe('AMOUNT_NOT_POSITIVE');
    expect(
      code(() =>
        withdrawal({
          id: id(),
          goalId: GOAL,
          fund: 'EARMARK',
          amount: bob('-1.00'),
          accountId: BANCO,
          occurredOn: '2026-10-15',
          origin: 'USER',
        }),
      ),
    ).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-GOALS-SAVINGS-025] un retiro mayor que los fondos de la meta en esa cuenta se rechaza aunque la cuenta tenga saldo', () => {
    const funds = new GoalFunds([real('1000.00')]);
    expect(code(() => funds.assertSufficient(AHORRO, 'REAL', bob('1200.00')))).toBe(
      'GOAL_INSUFFICIENT_FUNDS',
    );
    expect(code(() => funds.assertSufficient(AHORRO, 'REAL', bob('1000.00')))).toBeNull();
    // los fondos son por fondo: lo real no sirve para liberar una reserva
    expect(code(() => funds.assertSufficient(AHORRO, 'EARMARK', bob('1.00')))).toBe(
      'GOAL_INSUFFICIENT_FUNDS',
    );
  });

  it('[TC-GOALS-SAVINGS-027] la reasignación genera dos movimientos ligados que no cambian lo reservado de la cuenta', () => {
    const laptop = new GoalFunds([earmark('1500.00')]);
    const r = reassignment({
      reassignmentId: 'r-1',
      outId: id(),
      inId: id(),
      fromGoalId: GOAL,
      toGoalId: 'goal-2',
      fund: 'EARMARK',
      accountId: BANCO,
      amount: bob('1000.00'),
      occurredOn: '2026-10-16',
    });
    expect(r.out).toMatchObject({ kind: 'REASSIGN_OUT', goalId: GOAL, reassignmentId: 'r-1' });
    expect(r.in).toMatchObject({ kind: 'REASSIGN_IN', goalId: 'goal-2', reassignmentId: 'r-1' });
    expect(r.out.amount.toFixed()).toBe('-1000.00');
    const all = new GoalFunds([...laptop.movements, r.out, r.in]);
    expect(all.balance(BANCO, 'EARMARK').toFixed(2)).toBe('1500.00');
    expect(code(() => reassignment({ ...rArgs(), toGoalId: GOAL }))).toBe('VALIDATION_FAILED');
  });

  const rArgs = () => ({
    reassignmentId: 'r',
    outId: id(),
    inId: id(),
    fromGoalId: GOAL,
    toGoalId: 'goal-2',
    fund: 'EARMARK' as const,
    accountId: BANCO,
    amount: bob('1.00'),
    occurredOn: '2026-10-16',
  });

  it('liveByTransaction ignora los movimientos ya invertidos', () => {
    const a = real('500.00', AHORRO, 'tx-1');
    const inverse = reversalOf(a, { id: id(), occurredOn: '2026-10-21', origin: 'SYSTEM' });
    expect(new GoalFunds([a]).liveByTransaction('tx-1')).toEqual([a]);
    expect(new GoalFunds([a, inverse]).liveByTransaction('tx-1')).toEqual([]);
  });

  it('assertSignConsistent espeja el CHECK de la base', () => {
    expect(() => assertSignConsistent(real('1.00'))).not.toThrow();
    expect(code(() => assertSignConsistent({ kind: 'CONTRIBUTION', amount: bob('-1.00') }))).toBe(
      'INTERNAL_ERROR',
    );
    expect(code(() => assertSignConsistent({ kind: 'REVERSAL', amount: bob('0.00') }))).toBe(
      'INTERNAL_ERROR',
    );
  });

  it('suma por moneda sin mezclar monedas', () => {
    const usd = contribution({
      id: id(),
      goalId: GOAL,
      fund: 'REAL',
      amount: Money.parse('300.00', USD),
      accountId: 'caja-usd',
      occurredOn: '2026-10-15',
      origin: 'USER',
      transactionId: 'tx-u',
      transactionRevision: 1,
    });
    const funds = new GoalFunds([usd, earmark('7500.00')]);
    expect(funds.totalsByCurrency().map((m) => m.toString())).toEqual(['7500.00 BOB', '300.00 USD']);
  });

  it('[TC-GOALS-SAVINGS-029] PBT INV-018: tras cualquier secuencia de comandos aceptados, progreso = Σ(+) − Σ(−) y ningún (cuenta, fondo) queda negativo', () => {
    const command = fc.oneof(
      fc.record({
        type: fc.constant('contribute' as const),
        cents: fc.integer({ min: 1, max: 500_000 }),
        account: fc.constantFrom(AHORRO, BANCO),
        real: fc.boolean(),
      }),
      fc.record({
        type: fc.constant('withdraw' as const),
        cents: fc.integer({ min: 1, max: 700_000 }),
        account: fc.constantFrom(AHORRO, BANCO),
        real: fc.boolean(),
      }),
      fc.record({
        type: fc.constant('reassign' as const),
        cents: fc.integer({ min: 1, max: 700_000 }),
        account: fc.constantFrom(AHORRO, BANCO),
        real: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(fc.array(command, { minLength: 1, maxLength: 40 }), (commands) => {
        let mine: GoalMovement[] = [];
        let other: GoalMovement[] = [];
        let plus = dec('0');
        let minus = dec('0');
        for (const c of commands) {
          const fund = c.real ? ('REAL' as const) : ('EARMARK' as const);
          const amount = Money.ofMinorUnits(BigInt(c.cents), BOB);
          if (c.type === 'contribute') {
            mine = [
              ...mine,
              contribution({
                id: id(),
                goalId: GOAL,
                fund,
                amount,
                accountId: c.account,
                occurredOn: '2026-10-15',
                origin: 'USER',
                ...(fund === 'REAL' ? { transactionId: id(), transactionRevision: 1 } : {}),
              }),
            ];
            plus = plus.plus(amount.amount);
          } else if (c.type === 'withdraw') {
            if (code(() => new GoalFunds(mine).assertSufficient(c.account, fund, amount)) !== null) continue;
            mine = [
              ...mine,
              withdrawal({
                id: id(),
                goalId: GOAL,
                fund,
                amount,
                accountId: c.account,
                occurredOn: '2026-10-16',
                origin: 'USER',
                ...(fund === 'REAL' ? { transactionId: id(), transactionRevision: 1 } : {}),
              }),
            ];
            minus = minus.plus(amount.amount);
          } else {
            if (code(() => new GoalFunds(mine).assertSufficient(c.account, fund, amount)) !== null) continue;
            const r = reassignment({
              reassignmentId: id(),
              outId: id(),
              inId: id(),
              fromGoalId: GOAL,
              toGoalId: 'goal-2',
              fund,
              accountId: c.account,
              amount,
              occurredOn: '2026-10-16',
            });
            mine = [...mine, r.out];
            other = [...other, r.in];
            minus = minus.plus(amount.amount);
          }
          const funds = new GoalFunds(mine);
          for (const account of [AHORRO, BANCO]) {
            for (const f of ['REAL', 'EARMARK'] as const) {
              expect(funds.balance(account, f).gte(0)).toBe(true);
            }
          }
        }
        const sumAll = new GoalFunds(mine).totalsByCurrency()[0]?.amount ?? dec('0');
        expect(sumAll.toFixed(2)).toBe(plus.minus(minus).toFixed(2));
        // el dinero reasignado no se crea ni se destruye entre metas
        const moved = new GoalFunds(other).totalsByCurrency()[0]?.amount ?? dec('0');
        const outTotal = mine
          .filter((m) => m.kind === 'REASSIGN_OUT')
          .reduce((acc, m) => acc.plus(m.amount.amount), dec('0'));
        expect(moved.plus(outTotal).toFixed(2)).toBe('0.00');
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
