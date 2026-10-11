import { describe, expect, it } from 'vitest';
import { resourcePath } from '../../notifications/logic';
import {
  availableOccurrenceActions,
  canRegisterLoanPayment,
  isCardPayment,
  isLoanInstallment,
} from '../../recurring/logic';
import {
  buildCardInput,
  buildCardPatch,
  buildInstallmentInput,
  buildPlanInput,
  buildReportedPatch,
  cardHref,
  cardOfAccount,
  cardOfDefinition,
  cardPaymentName,
  changedFigures,
  conflictsOf,
  emptyCardForm,
  EMPTY_CARD_ACCOUNT,
  looksLikeCardPayment,
  normalizePercent,
  paymentSuggestions,
  pendingInstallments,
  planFormOf,
  termsFormOf,
  utilizationView,
  type CardForm,
} from './logic';
import { bob, card, cardAccount, figures, opts, statement, usd, util } from './fixtures';

describe('rutas y nombres', () => {
  it('el detalle de la tarjeta enlaza el estado de cuenta con ?statementId=', () => {
    expect(cardHref('c1')).toBe('/debts/tarjetas/c1');
    expect(cardHref('c1', 's1')).toBe('/debts/tarjetas/c1?statementId=s1');
  });

  it('el pago de tarjeta se nombra con el prefijo de Deuda y se reconoce por él', () => {
    expect(looksLikeCardPayment('Pago de tarjeta · Visa Oro BOB')).toBe(true);
    expect(looksLikeCardPayment('Pago Visa')).toBe(false);
    expect(cardPaymentName('Pago de tarjeta · Visa Oro (BOB)')).toBe('Visa Oro (BOB)');
    expect(cardPaymentName('Visa sin prefijo')).toBe('Visa sin prefijo');
  });

  it('encuentra la tarjeta por cuenta del ledger y por la definición de su plan de pago', () => {
    const withPlan = card({
      accounts: [
        cardAccount({
          paymentPlan: {
            sourceAccountId: 'acc-bank',
            policy: 'NO_INTEREST',
            materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null, leadDays: null },
            definitionId: 'def-1',
            enabledAt: '2026-10-01T10:00:00Z',
          },
        }),
      ],
    });
    expect(cardOfAccount([withPlan], 'acc-bob')?.id).toBe('card-1');
    expect(cardOfAccount([card({ status: 'ARCHIVED' })], 'acc-bob')).toBeUndefined();
    expect(cardOfDefinition([withPlan], 'def-1')?.account.currency).toBe('BOB');
    expect(cardOfDefinition([withPlan], 'otra')).toBeUndefined();
  });
});

describe('utilización: texto y barra, nunca solo color', () => {
  it('30,53 % con umbrales 30 y 80 es "atención"; la barra mide el porcentaje redondeado', () => {
    const v = utilizationView(util());
    expect(v).toMatchObject({ level: 'warn', percent: '30.53', width: 31, overdrawn: false });
  });

  it('por debajo del umbral menor es normal y desde el mayor es crítica', () => {
    expect(utilizationView(util({ utilization: '12.00' })).level).toBe('ok');
    expect(utilizationView(util({ utilization: '80.00' })).level).toBe('danger');
    expect(utilizationView(util({ utilization: '100.00' })).width).toBe(100);
  });

  it('usa los umbrales configurados de la tarjeta', () => {
    expect(utilizationView(util({ utilization: '45.00' }), ['50.00']).level).toBe('ok');
    expect(utilizationView(util({ utilization: '55.00' }), ['50.00']).level).toBe('danger');
  });

  it('[TC-DEBT-CARD-020] sin tasa para valorar el límite compartido no hay porcentaje: se dice cuál falta', () => {
    const v = utilizationView(
      util({ scope: 'SHARED', utilization: null, used: null, missingRates: ['USD'] }),
    );
    expect(v).toMatchObject({ level: 'unknown', percent: null, width: 0, missingRates: ['USD'] });
  });

  it('sobre el límite es crítica aunque el porcentaje no llegue al umbral y la barra se topa en 100', () => {
    const v = utilizationView(util({ utilization: '120.00', overdrawn: true }));
    expect(v).toMatchObject({ level: 'danger', width: 100, overdrawn: true });
  });

  it('sin dato de utilización (cuenta sin límite) queda sin dato', () => {
    expect(utilizationView(null).level).toBe('unknown');
  });
});

describe('estados de cuenta', () => {
  it('lista solo las cifras que cambiaron entre lo emitido y el recálculo', () => {
    const s = statement();
    expect(changedFigures(s)).toEqual([]);
    const changed = statement({
      difference: figures({
        purchases: bob('300.00'),
        closingBalance: bob('300.00'),
        billedBalance: bob('300.00'),
        minimumDue: bob('0.00'),
        noInterestPayment: bob('300.00'),
      }),
    });
    expect(changedFigures(changed)).toEqual([
      'purchases',
      'closingBalance',
      'billedBalance',
      'noInterestPayment',
    ]);
    expect(changedFigures(statement({ difference: null }))).toEqual([]);
  });

  it('el pendiente por pagar sale del último estado emitido', () => {
    const sug = paymentSuggestions(card(), 'acc-bob');
    expect(sug).toMatchObject({
      cardId: 'card-1',
      cardName: 'Visa Oro',
      statementId: 'st-1',
      dueDate: '2026-11-15',
      noInterest: bob('1200.00'),
      minimum: bob('60.00'),
    });
  });

  it('[TC-DEBT-CARD-015] ya pagado: no hay sugerencias de monto', () => {
    const paid = card({
      accounts: [
        cardAccount({
          lastStatement: statement({
            status: 'PAID',
            remainingNoInterest: bob('0.00'),
            remainingMinimum: bob('0.00'),
          }),
        }),
      ],
    });
    expect(paymentSuggestions(paid, 'acc-bob')).toMatchObject({
      noInterest: null,
      minimum: null,
      status: 'PAID',
    });
  });

  it('sin estado emitido o con otra cuenta no hay sugerencias', () => {
    expect(
      paymentSuggestions(card({ accounts: [cardAccount({ lastStatement: null })] }), 'acc-bob'),
    ).toBeNull();
    expect(paymentSuggestions(card(), 'otra')).toBeNull();
    expect(paymentSuggestions(undefined, 'acc-bob')).toBeNull();
  });
});

describe('porcentajes', () => {
  const range = { min: '0.01', max: '100.00' };
  it('normaliza a dos decimales tolerando la coma', () => {
    expect(normalizePercent('5', 'es-BO', range)).toBe('5.00');
    expect(normalizePercent('5,5', 'es-BO', range)).toBe('5.50');
    expect(normalizePercent('100', 'es-BO', range)).toBe('100.00');
  });
  it('rechaza lo inválido, lo negativo, el cero, más de 2 decimales y el pasarse de 100', () => {
    expect(normalizePercent('abc', 'es-BO', range)).toBe('INVALID');
    expect(normalizePercent('-1', 'es-BO', range)).toBe('RANGE');
    expect(normalizePercent('0', 'es-BO', range)).toBe('RANGE');
    expect(normalizePercent('5,123', 'es-BO', range)).toBe('RANGE');
    expect(normalizePercent('100,01', 'es-BO', range)).toBe('RANGE');
  });
});

describe('alta de la tarjeta', () => {
  const visaOro = (over: Partial<CardForm> = {}): CardForm => ({
    ...emptyCardForm(),
    name: ' Visa Oro ',
    selected: ['acc-bob'],
    accounts: { 'acc-bob': { ...EMPTY_CARD_ACCOUNT, creditLimit: '15.000,00', floor: '50' } },
    statementDay: '25',
    dueDay: '15',
    ...over,
  });

  it('arma el cuerpo de createCreditCard: límite por cuenta, mínimo 5 % con piso, días y recordatorio', () => {
    const r = buildCardInput(visaOro(), opts);
    expect(r).toEqual({
      ok: true,
      input: {
        name: 'Visa Oro',
        accounts: [
          {
            accountId: 'acc-bob',
            creditLimit: bob('15000.00'),
            minimumRule: { type: 'PERCENT', percent: '5.00', floor: bob('50.00') },
          },
        ],
        limitMode: 'SEPARATE',
        statementDay: 25,
        dueDay: 15,
        dueWeekendAdjustment: 'NONE',
        reminderDays: 3,
      },
    });
  });

  it('bimoneda con límite compartido en dólares y pago mínimo fijo en la cuenta en USD', () => {
    const r = buildCardInput(
      visaOro({
        selected: ['acc-bob', 'acc-usd'],
        limitMode: 'SHARED',
        sharedLimit: '2000',
        sharedCurrency: 'USD',
        accounts: {
          'acc-bob': EMPTY_CARD_ACCOUNT,
          'acc-usd': { ...EMPTY_CARD_ACCOUNT, minimumType: 'FIXED', fixed: '25' },
        },
        annualRate: '54,5',
        thresholds: '30; 80',
        reminderDays: '5',
        weekend: 'NEXT',
      }),
      opts,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({
      limitMode: 'SHARED',
      sharedLimit: usd('2000.00'),
      annualRate: '54.50',
      utilizationThresholds: ['30.00', '80.00'],
      reminderDays: 5,
      dueWeekendAdjustment: 'NEXT',
    });
    expect(r.input.accounts[1]).toEqual({
      accountId: 'acc-usd',
      minimumRule: { type: 'FIXED', amount: usd('25.00') },
    });
    expect(r.input.accounts[0]).not.toHaveProperty('creditLimit');
  });

  it('[TC-DEBT-CARD-002] valida nombre, cuentas, días 1–31 y límites antes de enviar', () => {
    const r = buildCardInput({ ...emptyCardForm(), statementDay: '32', dueDay: '0' }, opts);
    expect(r).toMatchObject({
      ok: false,
      errors: { name: 'REQUIRED', accounts: 'REQUIRED', statementDay: 'RANGE', dueDay: 'RANGE' },
    });
    const noLimit = buildCardInput(visaOro({ accounts: {} }), opts);
    expect(noLimit).toMatchObject({ ok: false, errors: { 'account.acc-bob.creditLimit': 'REQUIRED' } });
    const scale = buildCardInput(
      visaOro({ accounts: { 'acc-bob': { ...EMPTY_CARD_ACCOUNT, creditLimit: '100,123' } } }),
      opts,
    );
    expect(scale).toMatchObject({ ok: false, errors: { 'account.acc-bob.creditLimit': 'SCALE' } });
  });

  it('una sola cuenta por moneda y el límite compartido necesita dos cuentas', () => {
    const dup = buildCardInput(
      visaOro({
        selected: ['acc-bob', 'acc-bob2'],
        accounts: {
          'acc-bob': { ...EMPTY_CARD_ACCOUNT, creditLimit: '10' },
          'acc-bob2': { ...EMPTY_CARD_ACCOUNT, creditLimit: '10' },
        },
      }),
      { ...opts, accounts: [...opts.accounts, { id: 'acc-bob2', currency: 'BOB' }] },
    );
    expect(dup).toMatchObject({ ok: false, errors: { accounts: 'DUPLICATE_CURRENCY' } });
    const shared = buildCardInput(visaOro({ limitMode: 'SHARED', sharedLimit: '100' }), opts);
    expect(shared).toMatchObject({ ok: false, errors: { limitMode: 'SHARED_NEEDS_TWO' } });
  });

  it('el porcentaje del mínimo, la tasa, los umbrales y el recordatorio se validan', () => {
    const r = buildCardInput(
      visaOro({
        accounts: { 'acc-bob': { ...EMPTY_CARD_ACCOUNT, creditLimit: '10', percent: '0' } },
        annualRate: '1000',
        thresholds: '30; 30',
        reminderDays: '31',
      }),
      opts,
    );
    expect(r).toMatchObject({
      ok: false,
      errors: {
        'account.acc-bob.percent': 'RANGE',
        annualRate: 'RANGE',
        thresholds: 'RANGE',
        reminderDays: 'RANGE',
      },
    });
  });

  it('[TC-DEBT-CARD-018] el plan de pago exige la cuenta de origen y viaja con la política y el modo', () => {
    const missing = buildCardInput(
      visaOro({ accounts: { 'acc-bob': { ...EMPTY_CARD_ACCOUNT, creditLimit: '10', planEnabled: true } } }),
      opts,
    );
    expect(missing).toMatchObject({ ok: false, errors: { 'account.acc-bob.plan': 'REQUIRED' } });
    const ok = buildCardInput(
      visaOro({
        accounts: {
          'acc-bob': {
            ...EMPTY_CARD_ACCOUNT,
            creditLimit: '10',
            planEnabled: true,
            planSourceId: 'acc-bank',
            planPolicy: 'MINIMUM',
            planMode: 'AUTO_CREATE',
          },
        },
      }),
      opts,
    );
    expect(ok.ok && ok.input.accounts[0]?.paymentPlan).toEqual({
      sourceAccountId: 'acc-bank',
      policy: 'MINIMUM',
      materialization: { mode: 'AUTO_CREATE' },
    });
  });
});

describe('edición de los términos', () => {
  it('envía solo lo que cambió', () => {
    const c = card();
    const form = { ...termsFormOf(c), name: 'Visa Platinum', dueDay: '20' };
    expect(buildCardPatch(c, form, opts)).toEqual({ ok: true, patch: { name: 'Visa Platinum', dueDay: 20 } });
  });

  it('sin cambios devuelve un parche vacío', () => {
    const c = card({ annualRate: '54.50' });
    expect(buildCardPatch(c, termsFormOf(c), opts)).toEqual({ ok: true, patch: {} });
  });

  it('vaciar la tasa la borra con null y el límite y la regla de mínimo van por cuenta', () => {
    const c = card({ annualRate: '54.50' });
    const form = termsFormOf(c);
    const patch = buildCardPatch(
      c,
      {
        ...form,
        annualRate: '',
        accounts: {
          'acc-bob': {
            ...form.accounts['acc-bob']!,
            creditLimit: '20000',
            minimumType: 'FIXED',
            fixed: '100',
          },
        },
      },
      opts,
    );
    expect(patch).toEqual({
      ok: true,
      patch: {
        annualRate: null,
        accounts: [
          {
            accountId: 'acc-bob',
            creditLimit: bob('20000.00'),
            minimumRule: { type: 'FIXED', amount: bob('100.00') },
          },
        ],
      },
    });
  });

  it('valida los días y los umbrales', () => {
    const c = card();
    const r = buildCardPatch(c, { ...termsFormOf(c), statementDay: '40', thresholds: '' }, opts);
    expect(r).toMatchObject({ ok: false, errors: { statementDay: 'RANGE', thresholds: 'RANGE' } });
  });
});

describe('plan de pago', () => {
  it('el formulario parte del plan existente y construye el cuerpo del PUT', () => {
    const a = cardAccount({
      paymentPlan: {
        sourceAccountId: 'acc-bank',
        policy: 'MINIMUM',
        materialization: { mode: 'NOTIFY_ONLY', autoCreateStatus: null, leadDays: null },
        definitionId: 'def-1',
        enabledAt: '2026-10-01T10:00:00Z',
      },
    });
    expect(buildPlanInput(planFormOf(a))).toEqual({
      sourceAccountId: 'acc-bank',
      policy: 'MINIMUM',
      materialization: { mode: 'NOTIFY_ONLY' },
    });
    expect(planFormOf(cardAccount())).toEqual({
      sourceAccountId: '',
      policy: 'NO_INTEREST',
      mode: 'PENDING_APPROVAL',
    });
  });

  it('[TC-DEBT-CARD-018] del 409 CARD_PAYMENT_PLAN_CONFLICT salen las transferencias recurrentes a terminar', () => {
    expect(
      conflictsOf({ conflictingDefinitions: [{ definitionId: 'd1', name: 'Pago Visa' }, { x: 1 }] }),
    ).toEqual([{ definitionId: 'd1', name: 'Pago Visa' }]);
    expect(conflictsOf(undefined)).toEqual([]);
    expect(conflictsOf({ conflictingDefinitions: 'no' })).toEqual([]);
  });
});

describe('montos informados por el banco', () => {
  const o = { locale: 'es-BO', scales: { BOB: 2 } };
  it('envía los montos nuevos y borra con null lo que se vacía', () => {
    const r = buildReportedPatch({ billed: '1.250,50', minimum: '' }, 'BOB', o, {
      billed: null,
      minimum: '60.00',
    });
    expect(r).toEqual({
      ok: true,
      patch: { reportedBilledBalance: bob('1250.50'), reportedMinimumDue: null },
    });
  });
  it('no envía lo que no cambió y valida la escala', () => {
    expect(
      buildReportedPatch({ billed: '1250.50', minimum: '' }, 'BOB', o, { billed: '1250.50', minimum: null }),
    ).toEqual({ ok: true, patch: {} });
    expect(
      buildReportedPatch({ billed: '1,234', minimum: '' }, 'BOB', o, { billed: null, minimum: null }),
    ).toMatchObject({ ok: false, errors: { billed: 'SCALE' } });
  });
});

describe('plan de cuotas', () => {
  it('2–60 cuotas, tasa opcional y ciclo inicial', () => {
    expect(
      buildInstallmentInput(
        { purchaseTransactionId: 't1', count: '3', annualRate: '24', startCycle: 'NEXT' },
        'es-BO',
      ),
    ).toEqual({
      ok: true,
      input: { purchaseTransactionId: 't1', installmentCount: 3, annualRate: '24.00', startCycle: 'NEXT' },
    });
    expect(
      buildInstallmentInput(
        { purchaseTransactionId: 't1', count: '3', annualRate: '', startCycle: 'PURCHASE' },
        'es-BO',
      ),
    ).toEqual({
      ok: true,
      input: { purchaseTransactionId: 't1', installmentCount: 3, startCycle: 'PURCHASE' },
    });
  });
  it('rechaza compra vacía, cuotas fuera de 2–60 y tasas inválidas', () => {
    expect(
      buildInstallmentInput(
        { purchaseTransactionId: '', count: '1', annualRate: '1000', startCycle: 'PURCHASE' },
        'es-BO',
      ),
    ).toMatchObject({ ok: false, errors: { purchase: 'REQUIRED', count: 'RANGE', annualRate: 'RANGE' } });
    expect(
      buildInstallmentInput(
        { purchaseTransactionId: 't', count: '61', annualRate: '', startCycle: 'PURCHASE' },
        'es-BO',
      ),
    ).toMatchObject({ ok: false, errors: { count: 'RANGE' } });
  });
  it('cuenta las cuotas aún no facturadas', () => {
    const plan = {
      installments: [
        { billingClosingDate: '2026-10-25' },
        { billingClosingDate: '2026-11-25' },
        { billingClosingDate: '2026-12-25' },
      ],
    };
    expect(pendingInstallments(plan, '2026-11-01')).toBe(2);
  });
});

describe('Q8 y notificaciones', () => {
  it('el pago de tarjeta es un tipo administrado cuyas ocurrencias sí se aprueban, editan, omiten y vinculan', () => {
    const o = { kind: 'CARD_PAYMENT', managedBy: 'DEBT', status: 'SCHEDULED' } as const;
    expect(isCardPayment(o)).toBe(true);
    expect(isLoanInstallment(o)).toBe(false);
    expect(availableOccurrenceActions(o, true)).toEqual(['approve', 'link', 'skip', 'edit']);
    expect(availableOccurrenceActions(o, false)).toEqual([]);
    expect(canRegisterLoanPayment(o, true)).toBe(false);
  });

  it('las cuotas de préstamo siguen sin acciones y con "Registrar pago"', () => {
    const o = { kind: 'LOAN_PAYMENT', managedBy: 'DEBT', status: 'DUE' } as const;
    expect(isLoanInstallment(o)).toBe(true);
    expect(availableOccurrenceActions(o, true)).toEqual([]);
    expect(canRegisterLoanPayment(o, true)).toBe(true);
  });

  it('[TC-DEBT-CARD-034] la notificación CREDIT_CARD abre la tarjeta (con el estado de cuenta si viene)', () => {
    expect(
      resourcePath({
        kind: 'CREDIT_CARD',
        periodId: 'c1',
        periodLabel: '2026-11',
        cardId: 'c1',
        statementId: 's1',
      }),
    ).toBe('/debts/tarjetas/c1?statementId=s1');
    expect(resourcePath({ kind: 'CREDIT_CARD', periodId: 'c1', periodLabel: '2026-11', cardId: 'c1' })).toBe(
      '/debts/tarjetas/c1',
    );
    // `periodId` es el id de la tarjeta en este tipo: respaldo si falta `cardId`.
    expect(resourcePath({ kind: 'CREDIT_CARD', periodId: 'c9', periodLabel: '2026-11' })).toBe(
      '/debts/tarjetas/c9',
    );
  });
});
