import { describe, expect, it } from 'vitest';
import { problemMessage } from '../../errors/error-messages';
import { resourcePath } from '../notifications/logic';
import { transactionsQuery, EMPTY_TRANSACTION_FILTERS } from '../transactions/logic';
import type { Account, Transaction } from '../common/types';
import { bob, goal, IDS, movement, plan, reservation, suggestion, tracking, usd } from './fixtures';
import {
  availableGoalActions,
  barWidth,
  buildContributionInput,
  buildCreateInput,
  buildPlanInput,
  buildReassignInput,
  buildSimulationInput,
  buildUpdateInput,
  buildWithdrawInput,
  compareGoals,
  confirmBody,
  earmarkDetails,
  eligibilityReasons,
  emptyContributionForm,
  emptyGoalForm,
  emptyReassignForm,
  emptyWithdrawForm,
  exceedsTarget,
  expectedView,
  formFromGoal,
  goalsQuery,
  homeExpectedView,
  linkableAccounts,
  linkableContributions,
  linkableWithdrawals,
  pendingSuggestions,
  planFormFrom,
  reservationsHref,
  reversedIds,
  shortfallOf,
  sortGoals,
  sortReservations,
  statusView,
  parseTolerance,
} from './logic';

const o = { locale: 'es-BO', scale: 2 };
const scaleOf = (c: string) => (c === 'USDT' ? 6 : 2);
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({
    id,
    name: id,
    type: 'SAVINGS',
    classification: 'ASSET',
    status: 'ACTIVE',
    liquidity: 'LIQUID',
    currency: 'BOB',
    balance: bob('0.00'),
    includeInNetWorth: true,
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  }) as Account;
const accounts = new Map([
  [IDS.savings, { currency: 'BOB' }],
  [IDS.bank, { currency: 'BOB' }],
  ['usd', { currency: 'USD' }],
]);

describe('Metas: progreso y estados (lógica pura)', () => {
  it('[TC-GOALS-SAVINGS-030] el ancho de la barra sale del porcentaje decimal sin redondear hacia arriba', () => {
    expect(barWidth('33.33')).toBe(33);
    expect(barWidth('6.67')).toBe(6);
    expect(barWidth('99.99')).toBe(99);
    expect(barWidth('100.00')).toBe(100);
    expect(barWidth('106.67')).toBe(100);
    expect(barWidth('12345.00')).toBe(100);
    expect(barWidth('no es numero')).toBe(0);
    expect(exceedsTarget('104.17')).toBe(true);
    expect(exceedsTarget('100.00')).toBe(false);
    expect(exceedsTarget('33.33')).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-034] el estado de avance solo se muestra en metas activas; una pausada muestra "pausada"', () => {
    expect(statusView(tracking({ status: 'BEHIND' }))).toEqual({ kind: 'TRACKING', value: 'BEHIND' });
    expect(statusView(tracking({ status: 'ON_TRACK' }))).toEqual({ kind: 'TRACKING', value: 'ON_TRACK' });
    expect(statusView(tracking({ status: 'AHEAD' }))).toEqual({ kind: 'TRACKING', value: 'AHEAD' });
    // Sin fecha objetivo no hay estado de avance: se informa el de ciclo de vida.
    expect(statusView(tracking({ status: null }))).toEqual({ kind: 'LIFECYCLE', value: 'ACTIVE' });
    expect(statusView(tracking({ status: null, lifecycleStatus: 'PAUSED' }))).toEqual({
      kind: 'LIFECYCLE',
      value: 'PAUSED',
    });
    // Aunque llegara un estado de avance, una meta no activa se muestra por su ciclo de vida.
    expect(statusView(tracking({ status: 'BEHIND', lifecycleStatus: 'PAUSED' })).kind).toBe('LIFECYCLE');
    expect(statusView(tracking({ status: null, lifecycleStatus: 'ACHIEVED' }))).toEqual({
      kind: 'LIFECYCLE',
      value: 'ACHIEVED',
    });
  });

  it('[TC-GOALS-SAVINGS-033] la fecha esperada es la estimada, la de alcance, o "sin ritmo suficiente"', () => {
    expect(expectedView(goal())).toEqual({ kind: 'DATE', date: '2027-07-31' });
    expect(expectedView(goal({ expectedDate: { date: null, reason: 'NO_PACE' } }))).toEqual({
      kind: 'NO_PACE',
    });
    expect(expectedView(goal({ expectedDate: { date: null, reason: 'BEYOND_HORIZON' } }))).toEqual({
      kind: 'BEYOND_HORIZON',
    });
    expect(
      expectedView(
        goal({ status: 'ACHIEVED', achievedOn: '2026-12-01', expectedDate: { date: null, reason: null } }),
      ),
    ).toEqual({ kind: 'ACHIEVED', date: '2026-12-01' });
    expect(expectedView(goal({ status: 'CLOSED', expectedDate: { date: null, reason: null } }))).toEqual({
      kind: 'NONE',
    });
    // Home: el bloque Q9 trae la fecha plana; sin fecha en una meta activa ⇒ sin ritmo suficiente.
    expect(homeExpectedView({ lifecycleStatus: 'ACTIVE', expectedDate: null })).toEqual({ kind: 'NO_PACE' });
    expect(homeExpectedView({ lifecycleStatus: 'ACHIEVED', expectedDate: null })).toEqual({ kind: 'NONE' });
    expect(homeExpectedView({ lifecycleStatus: 'ACTIVE', expectedDate: '2027-01-31' })).toEqual({
      kind: 'DATE',
      date: '2027-01-31',
    });
  });

  it('[TC-GOALS-SAVINGS-004] las acciones disponibles siguen el ciclo de vida; las metas terminales no admiten movimientos', () => {
    const active = availableGoalActions(goal());
    expect(active).toMatchObject({
      contribute: true,
      pause: true,
      resume: false,
      close: true,
      archive: false,
    });
    expect(availableGoalActions(goal({ status: 'PAUSED' }))).toMatchObject({
      contribute: true,
      pause: false,
      resume: true,
    });
    expect(availableGoalActions(goal({ status: 'ACHIEVED' }))).toMatchObject({ close: true, cancel: true });
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      const a = availableGoalActions(goal({ status }));
      expect(a).toMatchObject({
        contribute: false,
        withdraw: false,
        reassign: false,
        link: false,
        plan: false,
        edit: false,
        pause: false,
        close: false,
        cancel: false,
        archive: true,
      });
    }
    expect(availableGoalActions(goal({ status: 'CLOSED', archivedAt: '2026-12-01T00:00:00Z' })).archive).toBe(
      false,
    );
  });

  it('ordena por prioridad, fecha objetivo (sin fecha al final) y nombre', () => {
    const a = goal({ name: 'Auto', priority: 3, targetDate: null });
    const b = goal({ name: 'Viaje a Cusco', priority: 2, targetDate: '2027-06-30' });
    const c = goal({ name: 'Laptop', priority: 2, targetDate: null });
    const d = goal({ name: 'Fondo de emergencia', priority: 1, targetDate: '2027-03-31' });
    const e = goal({ name: 'Bicicleta', priority: 2, targetDate: '2027-06-30' });
    expect(sortGoals([a, b, c, d, e]).map((g) => g.name)).toEqual([
      'Fondo de emergencia',
      'Bicicleta',
      'Viaje a Cusco',
      'Laptop',
      'Auto',
    ]);
    expect(compareGoals(d, d)).toBe(0);
  });

  it('el filtro por estado arma la consulta de listGoals', () => {
    expect(goalsQuery('OPEN', false).toString()).toBe('');
    expect(goalsQuery('PAUSED', false).toString()).toBe('status=PAUSED');
    expect(goalsQuery('CLOSED', false).toString()).toBe('status=CLOSED&includeArchived=true');
    expect(goalsQuery('OPEN', true).toString()).toBe('includeArchived=true');
    expect(goalsQuery('ALL', false).get('status')).toBe('ACTIVE,PAUSED,ACHIEVED,CLOSED,CANCELLED');
  });
});

describe('Metas: alta y edición', () => {
  const valid = {
    ...emptyGoalForm('BOB', '2026-10-01'),
    name: ' Fondo de emergencia ',
    type: 'EMERGENCY_FUND' as const,
    target: '15.000,00',
    targetDate: '2027-03-31',
    linkedAccountIds: [IDS.savings],
    priority: '1',
  };

  it('[TC-GOALS-SAVINGS-001] el alta arma el cuerpo con monto string, fechas, cuenta vinculada y valores por omisión', () => {
    const r = buildCreateInput(valid, o);
    expect(r).toEqual({
      ok: true,
      input: {
        name: 'Fondo de emergencia',
        type: 'EMERGENCY_FUND',
        target: { amount: '15000.00', currency: 'BOB' },
        startDate: '2026-10-01',
        targetDate: '2027-03-31',
        linkedAccountIds: [IDS.savings],
        priority: 1,
        tolerancePercent: '5.00',
        pacePeriods: 3,
      },
    });
  });

  it('[TC-GOALS-SAVINGS-002] rechaza objetivo con más decimales, cero, nombre vacío, fechas invertidas y rangos', () => {
    const bad = (patch: object) => {
      const r = buildCreateInput({ ...valid, ...patch }, o);
      return r.ok ? {} : r.errors;
    };
    expect(bad({ target: '100,005' })).toEqual({ target: 'SCALE' });
    expect(bad({ target: '0' })).toEqual({ target: 'NOT_POSITIVE' });
    expect(bad({ target: '' })).toEqual({ target: 'REQUIRED' });
    expect(bad({ target: 'abc' })).toEqual({ target: 'INVALID' });
    expect(bad({ name: '  ' })).toEqual({ name: 'REQUIRED' });
    expect(bad({ name: 'x'.repeat(121) })).toEqual({ name: 'RANGE' });
    expect(bad({ targetDate: '2026-09-30' })).toEqual({ targetDate: 'DATE_ORDER' });
    expect(bad({ priority: '6' })).toEqual({ priority: 'RANGE' });
    expect(bad({ pacePeriods: '13' })).toEqual({ pacePeriods: 'RANGE' });
    expect(bad({ tolerancePercent: '5,555' })).toEqual({ tolerancePercent: 'SCALE' });
    expect(bad({ tolerancePercent: '50,01' })).toEqual({ tolerancePercent: 'RANGE' });
    expect(bad({ tolerancePercent: '51' })).toEqual({ tolerancePercent: 'RANGE' });
    expect(bad({ target: '', name: '' })).toEqual({ name: 'REQUIRED', target: 'REQUIRED' });
  });

  it('la tolerancia acepta el formato del locale y se normaliza a 2 decimales', () => {
    expect(parseTolerance('5', 'es-BO')).toEqual({ ok: true, value: '5.00' });
    expect(parseTolerance('7,5', 'es-BO')).toEqual({ ok: true, value: '7.50' });
    expect(parseTolerance('50', 'es-BO')).toEqual({ ok: true, value: '50.00' });
    expect(parseTolerance('0', 'es-BO')).toEqual({ ok: true, value: '0.00' });
    expect(parseTolerance('-1', 'es-BO')).toEqual({ ok: false, error: 'RANGE' });
    expect(parseTolerance('', 'es-BO')).toEqual({ ok: false, error: 'REQUIRED' });
  });

  it('[TC-GOALS-SAVINGS-004] la edición envía solo lo que cambió y quitar la fecha objetivo envía null', () => {
    const g = goal();
    const base = formFromGoal(g);
    expect(buildUpdateInput({ ...base, target: '12000,00' }, g, o)).toEqual({
      ok: true,
      input: { target: { amount: '12000.00', currency: 'BOB' } },
    });
    expect(buildUpdateInput({ ...base, targetDate: '' }, g, o)).toEqual({
      ok: true,
      input: { targetDate: null },
    });
    expect(buildUpdateInput({ ...base, linkedAccountIds: [] }, g, o)).toEqual({
      ok: true,
      input: { linkedAccountIds: [] },
    });
    expect(buildUpdateInput({ ...base, name: 'Colchón', priority: '2' }, g, o)).toEqual({
      ok: true,
      input: { name: 'Colchón', priority: 2 },
    });
    expect(buildUpdateInput(base, g, o)).toEqual({ ok: false, errors: { form: 'NO_CHANGES' } });
  });

  it('[TC-GOALS-SAVINGS-003] solo se pueden vincular cuentas activas de naturaleza activo', () => {
    const list = [
      acc('a'),
      acc('b', { classification: 'LIABILITY', type: 'CREDIT_CARD' }),
      acc('c', { status: 'CLOSED' }),
      acc('d', { status: 'ARCHIVED' }),
    ];
    expect(linkableAccounts(list).map((a) => a.id)).toEqual(['a']);
  });

  it('[TC-GOALS-SAVINGS-005] los errores de cuenta con fondos y moneda bloqueada salen por código en los tres idiomas', () => {
    for (const code of ['GOAL_ACCOUNT_HAS_FUNDS', 'GOAL_CURRENCY_LOCKED', 'GOAL_CLOSED'] as const) {
      const es = problemMessage({ code }, 'es');
      const en = problemMessage({ code }, 'en');
      const pt = problemMessage({ code }, 'pt');
      for (const text of [es, en, pt]) {
        expect(text).not.toBe('');
        expect(text).not.toContain(code);
      }
      expect(new Set([es, en, pt]).size).toBe(3);
    }
  });
});

describe('Metas: aportes, retiros y reasignaciones', () => {
  it('[TC-GOALS-SAVINGS-009] un aporte real lleva origen, destino vinculado y monto en la moneda de la cuenta', () => {
    const form = {
      ...emptyContributionForm('2026-10-05'),
      amount: '1.000,00',
      sourceAccountId: IDS.bank,
      destinationAccountId: IDS.savings,
      note: 'Octubre',
    };
    expect(buildContributionInput(form, { locale: 'es-BO', scaleOf }, accounts)).toEqual({
      ok: true,
      input: {
        fund: 'REAL',
        amount: { amount: '1000.00', currency: 'BOB' },
        businessDate: '2026-10-05',
        sourceAccountId: IDS.bank,
        destinationAccountId: IDS.savings,
        note: 'Octubre',
      },
    });
  });

  it('[TC-GOALS-SAVINGS-010] un aporte real exige cuenta de destino distinta de la de origen', () => {
    const base = { ...emptyContributionForm('2026-10-05'), amount: '10', sourceAccountId: IDS.bank };
    const r = buildContributionInput(base, { locale: 'es-BO', scaleOf }, accounts);
    expect(r).toEqual({ ok: false, errors: { destinationAccountId: 'REQUIRED' } });
    const same = buildContributionInput(
      { ...base, destinationAccountId: IDS.bank },
      { locale: 'es-BO', scaleOf },
      accounts,
    );
    expect(same).toEqual({ ok: false, errors: { destinationAccountId: 'SAME_GOAL' } });
  });

  it('[TC-GOALS-SAVINGS-012] una reserva no envía cuenta de destino y usa la moneda de la cuenta reservada', () => {
    const form = {
      ...emptyContributionForm('2026-10-05', { fund: 'EARMARK' }),
      amount: '250,50',
      sourceAccountId: 'usd',
      destinationAccountId: IDS.savings,
    };
    const r = buildContributionInput(form, { locale: 'es-BO', scaleOf }, accounts);
    expect(r).toEqual({
      ok: true,
      input: {
        fund: 'EARMARK',
        amount: { amount: '250.50', currency: 'USD' },
        businessDate: '2026-10-05',
        sourceAccountId: 'usd',
      },
    });
    expect(
      buildContributionInput({ ...form, amount: '0,001' }, { locale: 'es-BO', scaleOf }, accounts),
    ).toEqual({
      ok: false,
      errors: { amount: 'SCALE' },
    });
  });

  it('[TC-GOALS-SAVINGS-014] EARMARK_EXCEEDS_BALANCE muestra saldo, reservado y disponible del detalle del problema', () => {
    expect(
      earmarkDetails({
        code: 'EARMARK_EXCEEDS_BALANCE',
        details: { balance: '1000.00', reserved: '800.00', available: '200.00' },
      }),
    ).toEqual({ balance: '1000.00', reserved: '800.00', available: '200.00' });
    expect(
      earmarkDetails({
        code: 'EARMARK_EXCEEDS_BALANCE',
        details: { balance: { amount: '1.00', currency: 'BOB' } },
      }),
    ).toBeNull();
    expect(problemMessage({ code: 'EARMARK_EXCEEDS_BALANCE' }, 'es')).toContain('supera el saldo disponible');
  });

  it('[TC-GOALS-SAVINGS-020] los motivos de GOAL_TRANSACTION_NOT_ELIGIBLE salen de details.reasons', () => {
    expect(
      eligibilityReasons({
        code: 'GOAL_TRANSACTION_NOT_ELIGIBLE',
        details: { reasons: ['KIND', 'ACCOUNT'] },
      }),
    ).toEqual(['KIND', 'ACCOUNT']);
    expect(eligibilityReasons({ code: 'GOAL_TRANSACTION_NOT_ELIGIBLE' })).toEqual([]);
    expect(eligibilityReasons({ code: 'x', details: { reasons: ['status', 42, 'STATUS'] } })).toEqual([
      'STATUS',
    ]);
  });

  const tx = (over: Partial<Transaction>): Transaction =>
    ({
      id: 't',
      kind: 'TRANSFER',
      status: 'POSTED',
      amount: bob('500.00'),
      legs: [
        { accountId: IDS.bank, amount: bob('-500.00'), role: 'SOURCE' },
        { accountId: IDS.savings, amount: bob('500.00'), role: 'TARGET' },
      ],
      splits: [],
      source: 'MANUAL',
      revision: 1,
      version: 1,
      createdAt: '',
      transactionDate: '2026-10-05',
      ...over,
    }) as Transaction;

  it('[TC-GOALS-SAVINGS-019] solo se ofrecen para vincular transferencias posteadas hacia una cuenta vinculada', () => {
    const list = [
      tx({ id: 'ok' }),
      tx({ id: 'pend', status: 'PENDING' }),
      tx({ id: 'voided', status: 'VOIDED' }),
      tx({ id: 'exp', kind: 'EXPENSE' }),
      tx({
        id: 'other',
        legs: [
          { accountId: IDS.savings, amount: bob('-1.00'), role: 'SOURCE' },
          { accountId: 'x', amount: bob('1.00'), role: 'TARGET' },
        ],
      }),
      tx({ id: 'rec', status: 'RECONCILED' }),
    ];
    expect(linkableContributions(list, [IDS.savings]).map((t) => t.id)).toEqual(['ok', 'rec']);
  });

  it('[TC-GOALS-SAVINGS-026] para respaldar un retiro se ofrecen gastos y transferencias posteadas que salen de la cuenta', () => {
    const expense = tx({
      id: 'trip',
      kind: 'EXPENSE',
      legs: [{ accountId: IDS.savings, amount: bob('-2500.00'), role: 'MAIN' }],
    });
    const income = tx({
      id: 'inc',
      kind: 'INCOME',
      legs: [{ accountId: IDS.savings, amount: bob('50.00'), role: 'MAIN' }],
    });
    const transferIn = tx({ id: 'in' });
    expect(linkableWithdrawals([expense, income, transferIn], IDS.savings).map((t) => t.id)).toEqual([
      'trip',
    ]);
  });

  it('[TC-GOALS-SAVINGS-024] el retiro por transferencia, vínculo o liberación arma su modo; liberar solo aplica a reservas', () => {
    const base = {
      ...emptyWithdrawForm('2026-10-06'),
      accountId: IDS.savings,
      amount: '500,00',
      reason: 'Emergencia',
    };
    const opts = { locale: 'es-BO', scaleOf };
    expect(buildWithdrawInput({ ...base, toAccountId: IDS.bank }, opts, accounts)).toEqual({
      ok: true,
      input: {
        fund: 'REAL',
        accountId: IDS.savings,
        amount: { amount: '500.00', currency: 'BOB' },
        mode: { type: 'TRANSFER', toAccountId: IDS.bank, businessDate: '2026-10-06' },
        reason: 'Emergencia',
      },
    });
    expect(buildWithdrawInput({ ...base, mode: 'TRANSFER' }, opts, accounts)).toEqual({
      ok: false,
      errors: { toAccountId: 'REQUIRED' },
    });
    expect(
      buildWithdrawInput({ ...base, mode: 'LINK', transactionId: IDS.tx }, opts, accounts),
    ).toMatchObject({
      ok: true,
      input: { mode: { type: 'LINK', transactionId: IDS.tx } },
    });
    expect(buildWithdrawInput({ ...base, mode: 'LINK' }, opts, accounts)).toEqual({
      ok: false,
      errors: { transactionId: 'REQUIRED' },
    });
    // RELEASE solo con reservas.
    expect(buildWithdrawInput({ ...base, mode: 'RELEASE' }, opts, accounts)).toEqual({
      ok: false,
      errors: { mode: 'INVALID' },
    });
    expect(buildWithdrawInput({ ...base, fund: 'EARMARK', mode: 'RELEASE' }, opts, accounts)).toMatchObject({
      ok: true,
      input: { fund: 'EARMARK', mode: { type: 'RELEASE' } },
    });
  });

  it('[TC-GOALS-SAVINGS-025] los fondos insuficientes se muestran por código en los tres idiomas', () => {
    expect(problemMessage({ code: 'GOAL_INSUFFICIENT_FUNDS' }, 'es')).toContain(
      'no tiene fondos suficientes',
    );
    expect(problemMessage({ code: 'GOAL_INSUFFICIENT_FUNDS' }, 'en')).not.toBe(
      problemMessage({ code: 'GOAL_INSUFFICIENT_FUNDS' }, 'es'),
    );
  });

  it('[TC-GOALS-SAVINGS-027] la reasignación exige otra meta, cuenta y monto en la moneda de la cuenta', () => {
    const opts = { locale: 'es-BO', scaleOf };
    const form = {
      ...emptyReassignForm(),
      targetGoalId: IDS.laptop,
      accountId: IDS.savings,
      amount: '1000',
      reason: 'Prioridad',
    };
    expect(buildReassignInput(form, IDS.emergency, opts, accounts)).toEqual({
      ok: true,
      input: {
        targetGoalId: IDS.laptop,
        fund: 'EARMARK',
        accountId: IDS.savings,
        amount: { amount: '1000.00', currency: 'BOB' },
        reason: 'Prioridad',
      },
    });
    expect(
      buildReassignInput({ ...form, targetGoalId: IDS.emergency }, IDS.emergency, opts, accounts),
    ).toEqual({
      ok: false,
      errors: { targetGoalId: 'SAME_GOAL' },
    });
    expect(buildReassignInput({ ...form, targetGoalId: '' }, IDS.emergency, opts, accounts)).toEqual({
      ok: false,
      errors: { targetGoalId: 'REQUIRED' },
    });
  });

  it('[TC-GOALS-SAVINGS-022] un movimiento cancelado por un inverso queda identificado sin borrarse', () => {
    const original = movement({ id: 'm1' });
    const inverse = movement({ id: 'm2', movement: 'REVERSAL', amount: bob('-1000.00'), reversesId: 'm1' });
    expect([...reversedIds([inverse, original])]).toEqual(['m1']);
  });
});

describe('Metas: plan mensual, simulación y sugerencias', () => {
  const planOpts = { locale: 'es-BO', scale: 2, currency: 'BOB' };

  it('[TC-GOALS-SAVINGS-038] el plan manual solo necesita el aporte mensual en la moneda del objetivo', () => {
    const form = { ...planFormFrom(null), monthlyAmount: '1.500,00' };
    expect(buildPlanInput(form, planOpts)).toEqual({
      ok: true,
      input: { monthlyAmount: { amount: '1500.00', currency: 'BOB' }, fund: 'REAL', automation: 'NONE' },
    });
    expect(buildPlanInput({ ...form, monthlyAmount: '' }, planOpts)).toEqual({
      ok: false,
      errors: { monthlyAmount: 'REQUIRED' },
    });
  });

  it('[TC-GOALS-SAVINGS-039] el aporte recurrente exige aporte real, origen, destino, día y modo de creación', () => {
    const form = {
      ...planFormFrom(null),
      monthlyAmount: '1500',
      automation: 'RECURRING' as const,
      sourceAccountId: IDS.bank,
      destinationAccountId: IDS.savings,
      dayOfMonth: '5',
    };
    expect(buildPlanInput(form, planOpts)).toEqual({
      ok: true,
      input: {
        monthlyAmount: { amount: '1500.00', currency: 'BOB' },
        fund: 'REAL',
        automation: 'RECURRING',
        sourceAccountId: IDS.bank,
        destinationAccountId: IDS.savings,
        dayOfMonth: 5,
        materialization: { mode: 'PENDING_APPROVAL' },
      },
    });
    expect(
      buildPlanInput({ ...form, mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING' }, planOpts),
    ).toMatchObject({ input: { materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING' } } });
    expect(
      buildPlanInput({ ...form, sourceAccountId: '', destinationAccountId: '', dayOfMonth: '' }, planOpts),
    ).toEqual({
      ok: false,
      errors: { sourceAccountId: 'REQUIRED', destinationAccountId: 'REQUIRED', dayOfMonth: 'REQUIRED' },
    });
    expect(buildPlanInput({ ...form, fund: 'EARMARK' }, planOpts)).toEqual({
      ok: false,
      errors: { fund: 'INVALID' },
    });
    expect(buildPlanInput({ ...form, dayOfMonth: '32' }, planOpts)).toEqual({
      ok: false,
      errors: { dayOfMonth: 'RANGE' },
    });
    // El formulario se precarga con el plan vigente.
    expect(planFormFrom(plan())).toMatchObject({
      monthlyAmount: '1500.00',
      automation: 'RECURRING',
      dayOfMonth: '5',
      mode: 'PENDING_APPROVAL',
    });
  });

  it('[TC-GOALS-SAVINGS-035] la simulación exige al menos un valor y manda solo los indicados', () => {
    const sim = (monthlyContribution: string, targetAmount = '', targetDate = '') =>
      buildSimulationInput({ monthlyContribution, targetAmount, targetDate }, planOpts);
    expect(sim('1500')).toEqual({
      ok: true,
      input: { monthlyContribution: { amount: '1500.00', currency: 'BOB' } },
    });
    expect(sim('', '20000', '2027-12-31')).toEqual({
      ok: true,
      input: { targetAmount: { amount: '20000.00', currency: 'BOB' }, targetDate: '2027-12-31' },
    });
    expect(sim('')).toEqual({ ok: false, errors: { monthlyContribution: 'REQUIRED' } });
    expect(sim('1,234')).toEqual({ ok: false, errors: { monthlyContribution: 'SCALE' } });
  });

  it('[TC-GOALS-SAVINGS-040] las sugerencias pendientes salen de la más reciente y sin meta exigen elegirla', () => {
    const a = suggestion({ id: 'a', businessDate: '2026-10-05', goalId: null });
    const b = suggestion({ id: 'b', businessDate: '2026-10-09' });
    const c = suggestion({ id: 'c', status: 'DISMISSED' });
    const d = suggestion({ id: 'd', status: 'EXPIRED' });
    expect(pendingSuggestions([a, b, c, d]).map((s) => s.id)).toEqual(['b', 'a']);
    expect(confirmBody(b, '')).toEqual({});
    expect(confirmBody(a, '')).toBeNull();
    expect(confirmBody(a, IDS.emergency)).toEqual({ goalId: IDS.emergency });
    expect(problemMessage({ code: 'GOAL_SUGGESTION_NOT_PENDING' }, 'es')).toContain('ya fue confirmada');
  });
});

describe('Metas: reservas por cuenta y enlaces', () => {
  it('[TC-GOALS-SAVINGS-016] la cuenta sobre-asignada va primero y su faltante sale del dato o del disponible negativo', () => {
    const ok = reservation({
      accountId: 'ok',
      accountName: 'Alcancía',
      overAllocated: false,
      available: '100.00',
      shortfall: null,
      since: null,
    });
    const over = reservation();
    expect(sortReservations([ok, over]).map((r) => r.accountName)).toEqual(['Ahorro BOB', 'Alcancía']);
    expect(shortfallOf(over)).toBe('500.00');
    expect(shortfallOf({ overAllocated: true, shortfall: null, available: '-120.00' })).toBe('120.00');
    expect(shortfallOf(ok)).toBeNull();
  });

  it('[TC-GOALS-SAVINGS-042] los enlaces de notificación GOAL y GOAL_RESERVATIONS abren la meta y las reservas de la cuenta', () => {
    expect(
      resourcePath({ kind: 'GOAL', periodId: IDS.laptop, periodLabel: '2026-10', goalId: IDS.emergency }),
    ).toBe(`/goals/${IDS.emergency}`);
    // `periodId` es el id de la meta cuando falta `goalId`.
    expect(resourcePath({ kind: 'GOAL', periodId: IDS.laptop, periodLabel: '2026-10' })).toBe(
      `/goals/${IDS.laptop}`,
    );
    expect(
      resourcePath({
        kind: 'GOAL_RESERVATIONS',
        periodId: 'x',
        periodLabel: '2026-10',
        accountId: IDS.savings,
      }),
    ).toBe(`/goals/reservas?accountId=${IDS.savings}`);
    expect(resourcePath({ kind: 'GOAL_RESERVATIONS', periodId: IDS.bank, periodLabel: '2026-10' })).toBe(
      `/goals/reservas?accountId=${IDS.bank}`,
    );
    expect(reservationsHref()).toBe('/goals/reservas');
    expect(reservationsHref(IDS.savings)).toBe(`/goals/reservas?accountId=${IDS.savings}`);
  });

  it('[TC-GOALS-SAVINGS-049] el filtro por origen GOAL viaja como source=GOAL en el listado de transacciones', () => {
    const q = transactionsQuery({ ...EMPTY_TRANSACTION_FILTERS, source: 'GOAL' });
    expect(q.getAll('source')).toEqual(['GOAL']);
    expect(transactionsQuery(EMPTY_TRANSACTION_FILTERS).has('source')).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-036] los montos en USD se conservan como string con su moneda (nunca 1:1)', () => {
    const g = goal({
      target: usd('2050.00'),
      progress: {
        byCurrency: [usd('300.00'), bob('21000.00')],
        total: usd('2050.00'),
        percent: '100.00',
        remaining: usd('0.00'),
        complete: true,
        unconverted: [],
      },
    });
    expect(g.progress.byCurrency.map((m) => `${m.amount} ${m.currency}`)).toEqual([
      '300.00 USD',
      '21000.00 BOB',
    ]);
    expect(linkableAccounts([acc('u', { currency: 'USD' })])).toHaveLength(1);
  });
});
