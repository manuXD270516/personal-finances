import { DomainError, LocalDate, Money, currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CardInstallmentPlan } from './card-installment-plan.js';
import { CardCycleCalendar } from './card-cycle-calendar.js';
import { computeCycleFigures } from './card-cycle-calculator.js';
import { CreditCard, type RegisterCardInput } from './credit-card.js';

const d = (s: string) => LocalDate.parse(s);
const BOB = currency('BOB', 2);
const AT = '2026-10-10T14:00:00.000Z';
const SCALES: Record<string, number> = { BOB: 2, USD: 2, USDT: 6 };
const scaleOf = (code: string) => SCALES[code] ?? null;

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (err) {
    return err instanceof DomainError ? err.code : 'other';
  }
};

const pctRule = (floor: string) => ({ type: 'PERCENT', percent: '5.00', floor });

function input(overrides: Partial<RegisterCardInput> = {}): RegisterCardInput {
  return {
    id: 'card-1',
    workspaceId: 'ws-1',
    name: 'Visa Oro',
    accounts: [
      {
        id: 'ca-bob',
        accountId: 'acct-bob',
        currency: 'BOB',
        scale: 2,
        creditLimit: '10000.00',
        minimumRule: pctRule('50.00'),
      },
    ],
    statementDay: 25,
    dueDay: 15,
    scaleOf,
    at: AT,
    by: 'user-1',
    ...overrides,
  };
}

const bimoneda = (overrides: Partial<RegisterCardInput> = {}) =>
  input({
    accounts: [
      { id: 'ca-bob', accountId: 'acct-bob', currency: 'BOB', scale: 2, minimumRule: pctRule('50.00') },
      { id: 'ca-usd', accountId: 'acct-usd', currency: 'USD', scale: 2, minimumRule: pctRule('10.00') },
    ],
    ...overrides,
  });

describe('AR CreditCard: registro (add-credit-cards)', () => {
  it('[TC-DEBT-CARD-001] registra Visa Oro en BOB con límite, cierre 25, vencimiento 15 y mínimo 5.00 % con piso 50.00', () => {
    const card = CreditCard.register(input());
    const s = card.snapshot;
    expect(s.status).toBe('ACTIVE');
    expect(s.name).toBe('Visa Oro');
    expect(s.limitMode).toBe('SEPARATE');
    expect(s.accounts[0]?.creditLimit).toBe('10000.00');
    expect(s.accounts[0]?.minimumRule).toEqual({ type: 'PERCENT', percent: '5.00', floor: '50.00' });
    expect(card.currentTerms).toEqual({ statementDay: 25, dueDay: 15, dueWeekendAdjustment: 'NONE' });
    expect(s.utilizationThresholds).toEqual(['30.00', '80.00']);
    expect(s.reminderDays).toBe(3);
    expect(s.version).toBe(1);
  });

  it('[TC-DEBT-CARD-002] días fuera de 1..31 ⇒ VALIDATION_FAILED y el 31 es válido', () => {
    expect(code(() => CreditCard.register(input({ statementDay: 32 })))).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(input({ dueDay: 0 })))).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(input({ statementDay: 31, dueDay: 31 })))).toBe('ok');
  });

  it('[TC-DEBT-CARD-002] límite no positivo ⇒ AMOUNT_NOT_POSITIVE y con más decimales ⇒ AMOUNT_SCALE_EXCEEDED', () => {
    const withLimit = (creditLimit: string) =>
      input({
        accounts: [
          { id: 'ca', accountId: 'a', currency: 'BOB', scale: 2, creditLimit, minimumRule: pctRule('50.00') },
        ],
      });
    expect(code(() => CreditCard.register(withLimit('0.00')))).toBe('AMOUNT_NOT_POSITIVE');
    expect(code(() => CreditCard.register(withLimit('100.001')))).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-DEBT-CARD-002] tasa informativa de 0.00 a 999.99 %; fuera de rango ⇒ VALIDATION_FAILED', () => {
    expect(CreditCard.register(input({ annualRate: '54.50' })).snapshot.annualRate).toBe('54.50');
    expect(code(() => CreditCard.register(input({ annualRate: '1000.00' })))).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(input({ annualRate: '-1.00' })))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-CARD-003] bimoneda: dos cuentas, una por moneda, comparten calendario y cada una su regla de mínimo', () => {
    const card = CreditCard.register(
      bimoneda({ limitMode: 'SHARED', sharedLimit: { amount: '15000.00', currency: 'BOB' } }),
    );
    expect(card.snapshot.accounts.map((a) => a.currency)).toEqual(['BOB', 'USD']);
    expect(card.snapshot.accounts[1]?.minimumRule).toEqual({
      type: 'PERCENT',
      percent: '5.00',
      floor: '10.00',
    });
    const cycle = card.calendar.cycleClosingAt(d('2026-10-25'));
    expect(cycle.dueDate.toString()).toBe('2026-11-15');
  });

  it('[TC-DEBT-CARD-003] dos cuentas en la misma moneda ⇒ CREDIT_CARD_ACCOUNT_INVALID', () => {
    expect(
      code(() =>
        CreditCard.register(
          input({
            accounts: [
              {
                id: 'a1',
                accountId: 'x1',
                currency: 'BOB',
                scale: 2,
                creditLimit: '100.00',
                minimumRule: pctRule('1.00'),
              },
              {
                id: 'a2',
                accountId: 'x2',
                currency: 'BOB',
                scale: 2,
                creditLimit: '100.00',
                minimumRule: pctRule('1.00'),
              },
            ],
          }),
        ),
      ),
    ).toBe('CREDIT_CARD_ACCOUNT_INVALID');
  });

  it('[TC-DEBT-CARD-004] límite compartido en BOB: un único límite de 15000.00 BOB para ambas cuentas', () => {
    const card = CreditCard.register(
      bimoneda({ limitMode: 'SHARED', sharedLimit: { amount: '15000.00', currency: 'BOB' } }),
    );
    expect(card.snapshot.limitMode).toBe('SHARED');
    expect(card.snapshot.sharedLimit).toEqual({ amount: '15000.00', currency: 'BOB', scale: 2 });
    expect(card.snapshot.accounts.every((a) => a.creditLimit === null)).toBe(true);
  });

  it('[TC-DEBT-CARD-004] límite compartido en una moneda ajena (USDT) ⇒ VALIDATION_FAILED', () => {
    expect(
      code(() =>
        CreditCard.register(
          bimoneda({ limitMode: 'SHARED', sharedLimit: { amount: '2000.00', currency: 'USDT' } }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-CARD-004] una tarjeta de una sola cuenta debe tener límite separado; el separado exige un límite por cuenta', () => {
    expect(
      code(() =>
        CreditCard.register(
          input({ limitMode: 'SHARED', sharedLimit: { amount: '100.00', currency: 'BOB' } }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(bimoneda({ limitMode: 'SEPARATE' })))).toBe('VALIDATION_FAILED');
  });

  it('umbrales: 1 a 3 distintos entre 0.01 y 100.00, ordenados; recordatorio de 1 a 30 días', () => {
    const card = CreditCard.register(input({ utilizationThresholds: ['80', '25.5', '50'], reminderDays: 7 }));
    expect(card.snapshot.utilizationThresholds).toEqual(['25.50', '50.00', '80.00']);
    expect(card.snapshot.reminderDays).toBe(7);
    expect(code(() => CreditCard.register(input({ utilizationThresholds: [] })))).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(input({ utilizationThresholds: ['10', '20', '30', '40'] })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => CreditCard.register(input({ utilizationThresholds: ['30', '30.00'] })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => CreditCard.register(input({ utilizationThresholds: ['0'] })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => CreditCard.register(input({ reminderDays: 31 })))).toBe('VALIDATION_FAILED');
    expect(code(() => CreditCard.register(input({ reminderDays: 0 })))).toBe('VALIDATION_FAILED');
  });
});

describe('AR CreditCard: cambios, términos y archivado', () => {
  it('[TC-DEBT-CARD-028] cambiar el límite de 10000.00 a 12000.00 BOB sube la versión y marca creditLimit', () => {
    const card = CreditCard.register(input());
    card.update(
      { accounts: [{ accountId: 'acct-bob', creditLimit: '12000.00' }] },
      { at: AT, today: d('2026-10-10'), lastIssuedClosing: null },
    );
    expect(card.snapshot.accounts[0]?.creditLimit).toBe('12000.00');
    expect(card.changedFields).toContain('creditLimit');
    expect(card.version).toBe(2);
  });

  it('un update sin cambios no sube la versión', () => {
    const card = CreditCard.register(input());
    card.update({ name: 'Visa Oro' }, { at: AT, today: d('2026-10-10'), lastIssuedClosing: null });
    expect(card.version).toBe(1);
    expect(card.changedFields).toEqual([]);
  });

  it('[TC-DEBT-CARD-026] cambiar cierre 25→20 y vencimiento 15→10 desde el ciclo abierto conserva el estado emitido', () => {
    const card = CreditCard.register(input());
    card.update(
      { statementDay: 20, dueDay: 10 },
      { at: AT, today: d('2026-10-27'), lastIssuedClosing: d('2026-10-25') },
    );
    expect(card.termsChanged).toBe(true);
    expect(card.snapshot.terms).toHaveLength(2);
    const cal = card.calendar;
    expect(cal.cycleClosingAt(d('2026-10-25')).dueDate.toString()).toBe('2026-11-15');
    const open = cal.openCycle(d('2026-10-27'));
    expect([open.start.toString(), open.closing.toString(), open.dueDate.toString()]).toEqual([
      '2026-10-26',
      '2026-11-20',
      '2026-12-10',
    ]);
  });

  it('[TC-DEBT-CARD-027] archivar termina los planes de pago y no permite más cambios', () => {
    const card = CreditCard.register(input());
    card.setPaymentPlan(
      'acct-bob',
      {
        sourceAccountId: 'bank',
        policy: 'NO_INTEREST',
        materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null, leadDays: null },
        definitionId: 'def-1',
        enabledAt: AT,
      },
      AT,
    );
    expect(card.snapshot.accounts[0]?.paymentPlan?.definitionId).toBe('def-1');
    card.archive(AT);
    expect(card.status).toBe('ARCHIVED');
    expect(card.snapshot.accounts[0]?.paymentPlan).toBeNull();
    expect(() =>
      card.update({ name: 'Otra' }, { at: AT, today: d('2026-10-10'), lastIssuedClosing: null }),
    ).toThrow();
  });
});

describe('AR CardInstallmentPlan (add-credit-cards, decisión 13)', () => {
  const cal = CardCycleCalendar.single({ statementDay: 25, dueDay: 15, dueWeekendAdjustment: 'NONE' });
  const laptop = (overrides: Partial<Parameters<typeof CardInstallmentPlan.create>[0]> = {}) =>
    CardInstallmentPlan.create({
      id: 'plan-1',
      workspaceId: 'ws-1',
      cardAccountId: 'ca-bob',
      purchaseTransactionId: 'tx-laptop',
      purchaseDate: '2026-10-05',
      principal: Money.parse('1000.00', BOB),
      count: 3,
      annualRatePercent: '0',
      calendar: cal,
      at: AT,
      by: 'user-1',
      ...overrides,
    });

  it('[TC-DEBT-CARD-022] laptop en 3 cuotas: 333.33, 333.33, 333.34 facturadas en los cierres 25-10, 25-11 y 25-12', () => {
    const plan = laptop();
    const rows = plan.snapshot.installments;
    expect(rows.map((r) => r.total)).toEqual(['333.33', '333.33', '333.34']);
    expect(rows.map((r) => r.billingClosingDate)).toEqual(['2026-10-25', '2026-11-25', '2026-12-25']);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('con startCycle NEXT la primera cuota se factura un ciclo después', () => {
    const plan = laptop({ startCycle: 'NEXT' });
    expect(plan.snapshot.installments.map((r) => r.billingClosingDate)).toEqual([
      '2026-11-25',
      '2026-12-25',
      '2027-01-25',
    ]);
  });

  it('[TC-DEBT-CARD-024] saldo facturado del primer ciclo: 1000.00 − capital no facturado = 333.33; mínimo 50.00', () => {
    const plan = laptop();
    const unbilled = CardInstallmentPlan.unbilledCapital([plan], d('2026-10-25'), BOB);
    expect(unbilled.toFixed()).toBe('666.67');
    const figures = computeCycleFigures({
      currency: BOB,
      previousBalance: Money.zero(BOB),
      closingBalance: Money.parse('1000.00', BOB),
      movements: [{ businessDate: '2026-10-05', movementClass: 'PURCHASE', amount: '1000.00' }],
      unbilledInstallments: unbilled,
      minimumRule: { type: 'PERCENT', percent: '5.00', floor: '50.00' },
    });
    expect(figures.billedBalance.toFixed()).toBe('333.33');
    expect(figures.minimumDue.toFixed()).toBe('50.00');
  });

  it('una compra posterior al cierre no se descuenta en ese ciclo', () => {
    const plan = laptop({ purchaseDate: '2026-10-26' });
    expect(CardInstallmentPlan.unbilledCapital([plan], d('2026-10-25'), BOB).toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-024] calendario de cargos futuros al 2026-10-20: 333.33 el 15-11, 333.33 el 15-12 y 333.34 el 15-01', () => {
    const groups = CardInstallmentPlan.futureCharges([laptop()], d('2026-10-20'));
    expect(groups.map((g) => [g.dueDate, g.installments[0]?.total])).toEqual([
      ['2026-11-15', '333.33'],
      ['2026-12-15', '333.33'],
      ['2027-01-15', '333.34'],
    ]);
    expect(groups[1]?.installments[0]).toMatchObject({ n: 2, of: 3 });
  });

  it('[TC-DEBT-CARD-025] cancelar por compra anulada saca las cuotas del calendario futuro y del saldo facturado', () => {
    const plan = laptop();
    plan.cancel('PURCHASE_VOIDED', AT);
    expect(plan.status).toBe('CANCELLED');
    expect(plan.snapshot.cancelReason).toBe('PURCHASE_VOIDED');
    expect(CardInstallmentPlan.futureCharges([plan], d('2026-11-02'))).toEqual([]);
    expect(CardInstallmentPlan.unbilledCapital([plan], d('2026-10-25'), BOB).toFixed()).toBe('0.00');
    expect(() => plan.cancel('USER', AT)).toThrow();
  });

  it('[TC-DEBT-CARD-023] con interés el total facturado por ciclo incluye el interés proyectado', () => {
    const plan = laptop({ principal: Money.parse('1200.00', BOB), annualRatePercent: '24.00' });
    expect(CardInstallmentPlan.totalBilledAt([plan], d('2026-10-25'), BOB).toFixed()).toBe('416.11');
    expect(CardInstallmentPlan.unbilledCapital([plan], d('2026-10-25'), BOB).toFixed()).toBe('807.89');
  });

  it('cambio de términos: las cuotas no facturadas se reasignan en orden a los cierres nuevos', () => {
    const plan = laptop();
    const changed = cal.withTerms(
      { statementDay: 20, dueDay: 10, dueWeekendAdjustment: 'NONE' },
      { lastIssuedClosing: d('2026-10-25'), today: d('2026-10-27') },
    );
    expect(plan.reassign(changed, d('2026-10-25'), AT)).toBe(true);
    expect(plan.snapshot.installments.map((r) => r.billingClosingDate)).toEqual([
      '2026-10-25',
      '2026-11-20',
      '2026-12-20',
    ]);
    expect(plan.snapshot.installments.map((r) => r.dueDate)).toEqual([
      '2026-11-15',
      '2026-12-10',
      '2027-01-10',
    ]);
  });

  it('se completa cuando el ciclo de la última cuota ya se emitió', () => {
    const plan = laptop();
    expect(plan.completeIfBilled(d('2026-11-25'), AT)).toBe(false);
    expect(plan.completeIfBilled(d('2026-12-25'), AT)).toBe(true);
    expect(plan.status).toBe('COMPLETED');
    // Un plan COMPLETED conserva su efecto en ciclos antiguos recalculados.
    expect(CardInstallmentPlan.unbilledCapital([plan], d('2026-10-25'), BOB).toFixed()).toBe('666.67');
  });

  it('rechaza cuotas fuera de rango con INSTALLMENT_PLAN_INVALID', () => {
    expect(code(() => laptop({ count: 1 }))).toBe('INSTALLMENT_PLAN_INVALID');
    expect(code(() => laptop({ count: 61 }))).toBe('INSTALLMENT_PLAN_INVALID');
  });
});
