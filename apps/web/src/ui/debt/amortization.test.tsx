import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { VersionsSection } from './AmortizationPanels';
import { LoanFields } from './LoanForm';
import { BalanceChart, StrategiesResult } from './Simulator';
import { PaymentsTable } from './Tables';
import {
  buildCustomRows,
  buildLoanInput,
  buildPreviewInput,
  buildPrepaymentInput,
  buildRateChangeInput,
  buildSimulationInput,
  canChangeRate,
  canRecalculate,
  chartPaths,
  customPrincipalSum,
  emptyCustomRow,
  emptyLoanForm,
  emptyPrepaymentForm,
  emptySimulatorForm,
  principalGap,
  simulationToCsv,
  type LoanForm,
} from './logic';
import type { LoanPayment, PayoffStrategiesSimulation, RateChange, ScheduleVersion } from './types';

const f = esContext('Debt');
const o = { locale: 'es-BO', scale: 2, currency: 'BOB' };
const noop = () => undefined;

const filled = (over: Partial<LoanForm> = {}): LoanForm => ({
  ...emptyLoanForm('BOB', '2026-10-15'),
  name: 'Auto',
  principal: '12000.00',
  ratePct: '12',
  termInstallments: '12',
  firstDueDate: '2026-11-15',
  newAccountName: 'Préstamo auto',
  disbursementAccountId: 'acct-1',
  ...over,
});

describe('formulario del préstamo: sistema, capital fijo y tipo de tasa', () => {
  it('[TC-DEBT-LOAN-046] el alemán viaja con su método y la vista previa lo usa; la tasa variable se envía', () => {
    const form = filled({ method: 'GERMAN', rateType: 'VARIABLE' });
    const preview = buildPreviewInput(form, o);
    expect(preview).toMatchObject({ method: 'GERMAN', rateType: 'VARIABLE', annualRate: '0.12' });
    const built = buildLoanInput(form, o);
    expect(built.ok && built.input).toMatchObject({ method: 'GERMAN', rateType: 'VARIABLE' });
  });

  it('[TC-DEBT-AMORT-025] el capital fijo exige un monto que no agote el principal antes de la última cuota', () => {
    const base = filled({ method: 'FIXED_PRINCIPAL', principal: '10000.00', fixedPrincipal: '500.00' });
    const ok = buildLoanInput(base, o);
    expect(ok.ok && ok.input).toMatchObject({
      method: 'FIXED_PRINCIPAL',
      fixedPrincipalAmount: { amount: '500.00', currency: 'BOB' },
    });
    const bad = buildLoanInput({ ...base, fixedPrincipal: '1000.00' }, o);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors['fixedPrincipal']).toBe('RANGE');
    const missing = buildLoanInput({ ...base, fixedPrincipal: '' }, o);
    expect(!missing.ok && missing.errors['fixedPrincipal']).toBe('REQUIRED');
  });

  it('un cronograma propio no tiene vista previa en el alta; el campo de capital fijo aparece solo con ese método', () => {
    expect(buildPreviewInput(filled({ method: 'CUSTOM' }), o)).toBeNull();
    const props = {
      f,
      set: noop,
      errors: {},
      accounts: [],
      counterparties: [],
      currencies: ['BOB'],
    };
    const fixed = renderToStaticMarkup(
      <LoanFields {...props} form={filled({ method: 'FIXED_PRINCIPAL' })} />,
    );
    expect(fixed).toContain('data-testid="loan-fixed-principal"');
    const french = renderToStaticMarkup(<LoanFields {...props} form={filled()} />);
    expect(french).not.toContain('data-testid="loan-fixed-principal"');
    expect(french).toContain('data-testid="loan-method"');
    // un préstamo en curso no ofrece el cronograma propio (necesita sus cuotas desde el alta)
    const existing = renderToStaticMarkup(<LoanFields {...props} form={filled({ origin: 'EXISTING' })} />);
    expect(textOf(existing)).not.toContain('Cronograma propio (cuota por cuota)');
  });
});

describe('pago extraordinario y cambio de tasa (lógica)', () => {
  it('el pago extraordinario valida monto, fecha, comisión y cuenta; la vista previa no exige cuenta', () => {
    const form = {
      ...emptyPrepaymentForm({ businessDate: '2027-01-15', accountId: 'a1' }),
      amount: '3000.00',
      fee: '30.00',
    };
    const built = buildPrepaymentInput(form, o);
    expect(built.ok && built.input).toEqual({
      amount: { amount: '3000.00', currency: 'BOB' },
      businessDate: '2027-01-15',
      fee: { amount: '30.00', currency: 'BOB' },
      option: 'REDUCE_TERM',
      accountId: 'a1',
    });
    const preview = buildPrepaymentInput({ ...form, accountId: '', option: 'REDUCE_INSTALLMENT' }, o, true);
    expect(preview.ok && preview.input).toEqual({
      amount: { amount: '3000.00', currency: 'BOB' },
      businessDate: '2027-01-15',
      fee: { amount: '30.00', currency: 'BOB' },
    });
    const bad = buildPrepaymentInput({ ...form, amount: '', accountId: '', fee: '1,234' }, o);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['accountId', 'amount', 'fee']);
    // una comisión en cero no se envía
    const zero = buildPrepaymentInput({ ...form, fee: '0.00' }, o);
    expect(zero.ok && 'fee' in zero.input).toBe(false);
  });

  it('el cambio de tasa convierte el porcentaje en fracción exacta', () => {
    expect(buildRateChangeInput({ ratePct: '15', effectiveFrom: '2027-04-15' }, 'es-BO')).toEqual({
      ok: true,
      input: { annualRate: '0.15', effectiveFrom: '2027-04-15' },
    });
    expect(buildRateChangeInput({ ratePct: '15,5', effectiveFrom: '2027-04-15' }, 'es-BO')).toMatchObject({
      input: { annualRate: '0.155' },
    });
    const bad = buildRateChangeInput({ ratePct: '150', effectiveFrom: '' }, 'es-BO');
    expect(!bad.ok && bad.errors).toEqual({ ratePct: 'RANGE', effectiveFrom: 'REQUIRED' });
  });

  it('solo un préstamo activo y no custom admite un prepago; el cambio de tasa exige tasa variable', () => {
    const loan = { method: 'FRENCH', status: 'ACTIVE', rateType: 'FIXED' } as const;
    expect(canRecalculate(loan)).toBe(true);
    expect(canChangeRate(loan)).toBe(false);
    expect(canChangeRate({ ...loan, rateType: 'VARIABLE' })).toBe(true);
    expect(canRecalculate({ ...loan, method: 'CUSTOM' })).toBe(false);
    expect(canRecalculate({ ...loan, status: 'DRAFT' })).toBe(false);
  });
});

describe('cronograma propio: grilla', () => {
  const row = (due: string, principal: string, interest = '') => ({
    ...emptyCustomRow(),
    dueDate: due,
    principal,
    interest,
  });

  it('[TC-DEBT-AMORT-026] las filas viajan como textos y la suma de capital se compara con el esperado', () => {
    const rows = [
      row('2026-11-15', '400.00', '10.00'),
      row('2026-12-15', '300.00', '6.00'),
      row('2027-01-15', '300.00', '3.00'),
    ];
    const built = buildCustomRows(rows, o);
    expect(built.ok && built.input.rows[0]).toEqual({
      dueDate: '2026-11-15',
      principal: '400.00',
      interest: '10.00',
    });
    const sum = customPrincipalSum(rows, o);
    expect(sum).toEqual({ sum: '1000.00', invalid: false });
    expect(principalGap('1000.00', sum.sum)).toBe('0.00');
  });

  it('[TC-DEBT-AMORT-027] muestra la diferencia cuando el capital no suma y marca las filas inválidas', () => {
    const rows = [row('2026-11-15', '400.00'), row('2026-12-15', '299.99'), row('2027-01-15', '300.00')];
    const sum = customPrincipalSum(rows, o);
    expect(sum.sum).toBe('999.99');
    expect(principalGap('1000.00', sum.sum)).toBe('0.01');
    expect(principalGap('1000.00', '1000.01')).toBe('-0.01');
    const bad = buildCustomRows([row('', ''), row('2026-12-15', 'abc')], o);
    expect(!bad.ok && bad.errors).toEqual({
      'rows.0.dueDate': 'REQUIRED',
      'rows.0.principal': 'REQUIRED',
      'rows.1.principal': 'INVALID',
    });
    expect(customPrincipalSum([row('', 'abc')], o).invalid).toBe(true);
  });
});

const version = (over: Partial<ScheduleVersion>): ScheduleVersion => ({
  scheduleVersion: 1,
  reason: 'INITIAL',
  effectiveFrom: '2026-10-15',
  fromInstallmentNo: 1,
  replacedFromInstallmentNo: 4,
  current: false,
  installmentCount: 12,
  sourcePaymentId: null,
  sourceRateChangeId: null,
  sourceReferenceId: null,
  createdAt: '2026-10-15T16:00:00.000Z',
  ...over,
});

describe('historial de versiones y de tasas', () => {
  it('[TC-DEBT-AMORT-034] muestra cada versión con su motivo, vigencia y cuotas que reemplaza', () => {
    const rates: RateChange[] = [
      { id: null, annualRate: '0.12', effectiveFrom: '2026-10-15', scheduleVersion: 1, initial: true },
      { id: 'r1', annualRate: '0.15', effectiveFrom: '2027-04-15', scheduleVersion: 3, initial: false },
    ];
    const html = renderToStaticMarkup(
      <VersionsSection
        f={f}
        viewing={1}
        onView={noop}
        rates={rates}
        versions={[
          version({}),
          version({
            scheduleVersion: 2,
            reason: 'PREPAYMENT',
            effectiveFrom: '2027-01-15',
            fromInstallmentNo: 4,
            replacedFromInstallmentNo: null,
            current: true,
            installmentCount: 6,
          }),
        ]}
      />,
    );
    const text = textOf(html);
    expect(html.match(/data-testid="version-row"/g)).toHaveLength(2);
    expect(text).toContain('Pago extraordinario');
    expect(text).toContain('reemplazada desde la 4');
    expect(html).toMatch(/data-version="2" data-current="true"/);
    expect(text).toMatch(/12,00 % desde el desembolso/);
    expect(text).toMatch(/15,00 % desde el 15\/04\/2027/);
    // la versión que se está viendo no se puede volver a pedir
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ver cuotas/);
  });

  it('un pago extraordinario se muestra con su opción en lugar de las cuotas imputadas', () => {
    const p: LoanPayment = {
      id: 'p9',
      loanId: 'L1',
      paymentNo: 4,
      transactionId: 't9',
      accountId: 'a1',
      businessDate: '2027-01-15',
      amount: { amount: '3030.00', currency: 'BOB' },
      principal: '3000.00',
      interest: '0.00',
      fees: '30.00',
      insurance: '0.00',
      taxes: '0.00',
      explicitBreakdown: false,
      paymentMethod: null,
      kind: 'PREPAYMENT',
      prepaymentOption: 'REDUCE_TERM',
      prepaymentFee: { amount: '30.00', currency: 'BOB' },
      status: 'ACTIVE',
      installmentNos: [],
      voidedAt: null,
      voidedReason: null,
      createdAt: '2027-01-15T16:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <PaymentsTable f={f} items={[p]} accountName={() => 'Banco'} canVoid onVoid={noop} />,
    );
    expect(textOf(html)).toContain('Pago extraordinario (Reducir el plazo)');
  });
});

const sim: PayoffStrategiesSimulation = {
  type: 'STRATEGIES',
  currency: 'BOB',
  monthlyExtra: '500.00',
  startBalance: '15000.00',
  strategies: [
    {
      strategy: 'NONE',
      totalInterest: '3425.46',
      debtFreeDate: '2028-10-15',
      interestSaved: '0.00',
      monthsToDebtFree: 24,
      loans: [{ loanId: 'a', name: 'A', endDate: '2027-10-15', interest: '1' }],
      series: [
        { period: '2026-11', balance: '14000.00' },
        { period: '2026-12', balance: '13000.00' },
      ],
    },
    {
      strategy: 'AVALANCHE',
      totalInterest: '1815.57',
      debtFreeDate: '2027-11-15',
      interestSaved: '1609.89',
      monthsToDebtFree: 13,
      loans: [{ loanId: 'a', name: 'A', endDate: '2027-10-15', interest: '1' }],
      series: [
        { period: '2026-11', balance: '13000.00' },
        { period: '2026-12', balance: '11000.00' },
      ],
    },
  ],
  outOfStrategy: [{ loanId: 'c', name: 'Préstamo USD', reason: 'CURRENCY', currency: 'USD' }],
};

describe('simulador', () => {
  it('[TC-DEBT-AMORT-042] [TC-DEBT-AMORT-043] la tabla compara las estrategias y avisa de los préstamos fuera de la estrategia', () => {
    const html = renderToStaticMarkup(<StrategiesResult f={f} result={sim} />);
    expect(html.match(/data-testid="simulator-row"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('1.815,57 BOB');
    expect(textOf(html)).toContain('1.609,89 BOB');
    expect(textOf(html)).toContain('Préstamo USD está en USD: conserva su cronograma vigente.');
    expect(html).toContain('data-testid="simulator-chart"');
  });

  it('el gráfico dibuja una serie por estrategia con leyenda y sin depender solo del color', () => {
    const html = renderToStaticMarkup(<BalanceChart f={f} currency="BOB" strategies={sim.strategies} />);
    expect(html.match(/data-series="/g)).toHaveLength(2);
    expect(html).toContain('stroke-dasharray');
    expect(html).toContain('role="img"');
    expect(html.match(/<li[ >]/g)).toHaveLength(2);
  });

  it('la geometría del gráfico usa el saldo exacto como máximo y completa las series con huecos', () => {
    const m = chartPaths(
      [
        {
          key: 'a',
          points: [
            { period: '2026-11', balance: '100.00' },
            { period: '2026-12', balance: '50.00' },
          ],
        },
        { key: 'b', points: [{ period: '2026-11', balance: '80.00' }] },
      ],
      { width: 200, height: 100, left: 10, right: 10, top: 10, bottom: 10 },
      2,
    );
    expect(m.max).toBe('100.00');
    expect(m.periods).toEqual(['2026-11', '2026-12']);
    expect(m.paths['a']).toBe('M10.0 10.0 L190.0 50.0');
    expect(m.paths['b']).toBe('M10.0 26.0 L190.0 26.0');
  });

  it('[TC-DEBT-AMORT-040] arma los escenarios y la tabla comparativa se exporta a CSV sin guardar nada', () => {
    const strategies = buildSimulationInput(
      { ...emptySimulatorForm('BOB'), monthlyExtra: '500.00' },
      { locale: 'es-BO', scale: 2 },
    );
    expect(strategies.ok && strategies.input).toEqual({
      scenario: { monthlyExtra: { amount: '500.00', currency: 'BOB' } },
    });
    const loan = buildSimulationInput(
      {
        ...emptySimulatorForm('BOB'),
        mode: 'LOAN',
        loanId: 'L1',
        extras: [
          { type: 'ONE_TIME', installmentNo: '3', amount: '3000.00' },
          { type: 'MONTHLY', installmentNo: '1', amount: '200.00' },
        ],
      },
      { locale: 'es-BO', scale: 2 },
    );
    expect(loan.ok && loan.input).toEqual({
      scenario: {
        loanId: 'L1',
        extras: [
          { type: 'ONE_TIME', installmentNo: 3, amount: '3000.00' },
          { type: 'MONTHLY', fromInstallmentNo: 1, amount: '200.00' },
        ],
      },
    });
    const bad = buildSimulationInput(
      { ...emptySimulatorForm('BOB'), mode: 'LOAN' },
      { locale: 'es-BO', scale: 2 },
    );
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['extras.0.amount', 'loanId']);
    expect(simulationToCsv(sim, ['Escenario', 'Interés', 'Ahorro', 'Fin', 'Meses'])).toBe(
      'Escenario,Interés,Ahorro,Fin,Meses\nNONE,3425.46,0.00,2028-10-15,24\nAVALANCHE,1815.57,1609.89,2027-11-15,13\n',
    );
  });
});
