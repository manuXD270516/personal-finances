import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { problemMessage } from '../../errors/error-messages';
import { esContext, textOf } from '../test-support';
import { OccurrencesTable } from '../recurring/OccurrencesTable';
import { availableOccurrenceActions, canRegisterLoanPayment } from '../recurring/logic';
import type { RecurringOccurrence } from '../recurring/types';
import { availableActions } from '../transactions/logic';
import type { Transaction } from '../common/types';
import {
  ComparisonSummaryView,
  ComparisonTable,
  ExplainPanel,
  ManualRows,
  MappingForm,
  ReferenceErrors,
} from './CompareParts';
import { LoanBalances, LoanSummary, NextInstallments } from './LoanDetail';
import { LoanFields } from './LoanForm';
import { PaymentFields } from './LoanPanels';
import { LoansTable } from './LoansList';
import { LoanTransactionView } from './LoanTransactionInfo';
import { emptyLoanForm, emptyManualRow, emptyPaymentForm } from './logic';
import { InstallmentsTable, PaymentsTable, SchedulePreviewTable } from './Tables';
import type {
  ComparedRow,
  LoanDetail,
  LoanInstallment,
  LoanPayment,
  ScheduleComparison,
  SchedulePreview,
} from './types';

const f = esContext('Debt');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noop = () => undefined;
const href = (p: string) => p;

const preview = (over: Partial<SchedulePreview> = {}): SchedulePreview => ({
  currency: 'BOB',
  installmentAmount: '2342.02',
  leveled: false,
  totalInterest: '6208.48',
  totalAmount: '56208.48',
  installments: [
    {
      n: 1,
      dueDate: '2026-11-15',
      periodStart: '2026-10-15',
      periodEnd: '2026-11-15',
      principal: '1862.85',
      interest: '479.17',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
      total: '2342.02',
      openingBalance: '50000.00',
      closingBalance: '48137.15',
    },
    {
      n: 2,
      dueDate: '2026-12-15',
      periodStart: '2026-11-15',
      periodEnd: '2026-12-15',
      principal: '1880.70',
      interest: '461.32',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
      total: '2342.02',
      openingBalance: '48137.15',
      closingBalance: '46256.45',
    },
  ],
  ...over,
});

const zero = { principal: '0.00', interest: '0.00', fees: '0.00', insurance: '0.00', taxes: '0.00' };

function installment(over: Partial<LoanInstallment> = {}): LoanInstallment {
  return {
    ...preview().installments[0]!,
    id: 'i1',
    status: 'UNPAID',
    overdue: false,
    expected: { principal: '1862.85', interest: '479.17', fees: '0.00', insurance: '0.00', taxes: '0.00' },
    paid: zero,
    differences: zero,
    pendingTotal: '2342.02',
    ...over,
  };
}

function payment(over: Partial<LoanPayment> = {}): LoanPayment {
  return {
    id: 'p1',
    loanId: 'L1',
    paymentNo: 1,
    transactionId: 't1',
    accountId: 'a1',
    businessDate: '2026-11-15',
    amount: bob('2342.02'),
    principal: '1862.85',
    interest: '479.17',
    fees: '0.00',
    insurance: '0.00',
    taxes: '0.00',
    explicitBreakdown: false,
    paymentMethod: null,
    status: 'ACTIVE',
    installmentNos: [1],
    voidedAt: null,
    voidedReason: null,
    createdAt: '2026-11-15T14:00:00Z',
    ...over,
  };
}

function loanDetail(over: Partial<LoanDetail> = {}): LoanDetail {
  return {
    id: 'L1',
    name: 'Vehículo',
    status: 'ACTIVE',
    origin: 'NEW',
    accountId: 'acc-loan',
    disbursementAccountId: 'acc-bank',
    paymentAccountId: 'acc-bank',
    lenderCounterpartyId: null,
    lenderName: 'Banco Unión',
    principal: bob('50000.00'),
    annualRate: '0.115',
    rateType: 'FIXED',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    termInstallments: 24,
    method: 'FRENCH',
    disbursementDate: '2026-10-15',
    firstDueDate: '2026-11-15',
    charges: { insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' } },
    retainedFee: bob('0.00'),
    existing: null,
    currentScheduleVersion: 1,
    recurringDefinitionId: 'def-1',
    disbursementTransactionId: 'tx-d',
    cancelledReason: null,
    version: 3,
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
    outstandingPrincipal: bob('48137.15'),
    accountBalance: bob('48137.15'),
    unreconciledDifference: bob('0.00'),
    installmentAmount: bob('2342.02'),
    nextInstallment: { n: 2, dueDate: '2026-12-15', outstanding: bob('2342.02'), overdueDays: 0 },
    overdueInstallments: [],
    paidTotals: {
      principal: bob('1862.85'),
      interest: bob('479.17'),
      fees: bob('0.00'),
      insurance: bob('0.00'),
      taxes: bob('0.00'),
    },
    preview: null,
    ...over,
  };
}

describe('lista de préstamos', () => {
  it('muestra estado, la deuda como "Deuda …", la próxima cuota y el atraso con tabla accesible', () => {
    const html = renderToStaticMarkup(
      <LoansTable
        f={f}
        href={href}
        items={[
          {
            loan: loanDetail(),
            detail: loanDetail({
              nextInstallment: { n: 2, dueDate: '2026-12-15', outstanding: bob('2342.02'), overdueDays: 5 },
            }),
          },
          { loan: loanDetail({ id: 'L2', name: 'Borrador', status: 'DRAFT' }) },
        ]}
      />,
    );
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('Deuda 48.137,15 BOB');
    expect(textOf(html)).toContain('Cuota 2 · 15/12/2026 · 2.342,02 BOB');
    expect(textOf(html)).toContain('5 días de atraso');
    expect(html).toContain('href="/debts/L1"');
    expect(html).toContain('Borrador');
  });
});

describe('alta de préstamo', () => {
  const props = {
    f,
    set: noop,
    errors: {},
    accounts: [],
    counterparties: [],
    currencies: ['BOB', 'USD'],
  };

  it('"Préstamo nuevo" pide fecha de desembolso y primera cuota; "en curso" pide saldo, fecha del saldo y próxima cuota', () => {
    const nuevo = renderToStaticMarkup(<LoanFields {...props} form={emptyLoanForm('BOB', '2026-10-15')} />);
    expect(nuevo).toContain('data-testid="loan-disbursement-date"');
    expect(nuevo).toContain('data-testid="loan-disburse-now"');
    expect(nuevo).not.toContain('data-testid="loan-next-no"');
    const curso = renderToStaticMarkup(
      <LoanFields {...props} form={{ ...emptyLoanForm('BOB', '2026-10-15'), origin: 'EXISTING' }} />,
    );
    expect(curso).toContain('data-testid="loan-as-of"');
    expect(curso).toContain('data-testid="loan-next-no"');
    expect(textOf(curso)).toContain('Saldo pendiente');
    expect(textOf(curso)).toContain('Cuotas restantes');
    expect(curso).not.toContain('data-testid="loan-disburse-now"');
  });

  it('la tasa se captura en porcentaje y los errores salen asociados al campo', () => {
    const html = renderToStaticMarkup(
      <LoanFields
        {...props}
        errors={{ ratePct: 'RANGE', name: 'REQUIRED' }}
        form={emptyLoanForm('BOB', '2026-10-15')}
      />,
    );
    expect(textOf(html)).toContain('Tasa nominal anual (%)');
    expect(textOf(html)).toContain('Está fuera del rango permitido.');
    expect(html).toContain('aria-invalid="true"');
  });

  it('un cargo de tasa mensual explica que es sobre el saldo', () => {
    const form = emptyLoanForm('BOB', '2026-10-15');
    const html = renderToStaticMarkup(
      <LoanFields
        {...props}
        form={{
          ...form,
          charges: { ...form.charges, insurance: { mode: 'RATE_ON_BALANCE', value: '0,04' } },
        }}
      />,
    );
    expect(html).toContain('data-testid="charge-insurance-value"');
    expect(textOf(html)).toContain('Tasa mensual (%)');
  });
});

describe('vista previa del cronograma', () => {
  it('tabla accesible con totales y sin columnas de cargos cuando no los hay', () => {
    const html = renderToStaticMarkup(<SchedulePreviewTable f={f} preview={preview()} />);
    expect(html).toContain('<caption');
    expect(html).toContain('scope="row"');
    expect(html).toContain('aria-live="polite"');
    expect(textOf(html)).toContain('2.342,02 BOB');
    expect(textOf(html)).toContain('6.208,48 BOB');
    expect(textOf(html)).not.toContain('Seguro');
    expect(html).not.toContain('data-testid="preview-leveled"');
    // Σ capital del tfoot = 1862.85 + 1880.70
    expect(html).toMatch(/data-testid="preview-sum-principal"[^>]*>3\.743,55</);
  });

  it('avisa cuando la cuota se niveló y muestra las columnas de cargos si existen', () => {
    const p = preview({ leveled: true });
    const html = renderToStaticMarkup(
      <SchedulePreviewTable
        f={f}
        preview={{ ...p, installments: p.installments.map((i) => ({ ...i, insurance: '19.99' })) }}
      />,
    );
    expect(html).toContain('data-testid="preview-leveled"');
    expect(textOf(html)).toContain('Seguro');
  });
});

describe('detalle del préstamo', () => {
  it('principal pendiente frente al saldo de la cuenta y la diferencia no registrada', () => {
    const ok = renderToStaticMarkup(<LoanBalances f={f} loan={loanDetail()} />);
    expect(ok).toContain('Deuda 48.137,15 BOB');
    expect(ok).not.toContain('data-testid="loan-unreconciled-note"');
    const diff = renderToStaticMarkup(
      <LoanBalances
        f={f}
        loan={loanDetail({ accountBalance: bob('48000.00'), unreconciledDifference: bob('137.15') })}
      />,
    );
    expect(diff).toContain('data-testid="loan-unreconciled-note"');
    expect(textOf(diff)).toContain('137,15 BOB');
  });

  it('acumulados pagados por componente', () => {
    const html = renderToStaticMarkup(<LoanBalances f={f} loan={loanDetail()} />);
    expect(html).toMatch(/data-component="interest">479,17 BOB/);
    expect(html).toMatch(/data-component="principal">1\.862,85 BOB/);
  });

  it('próxima cuota y cuotas atrasadas', () => {
    const html = renderToStaticMarkup(
      <NextInstallments
        f={f}
        loan={loanDetail({
          overdueInstallments: [{ n: 1, dueDate: '2026-11-15', outstanding: bob('100.00'), overdueDays: 12 }],
        })}
      />,
    );
    expect(textOf(html)).toContain('Cuota 2 del 15/12/2026 por 2.342,02 BOB');
    expect(textOf(html)).toContain('1 cuota atrasada');
    expect(textOf(html)).toContain('12 días de atraso');
  });

  it('condiciones: tasa en %, convención y cargos', () => {
    const html = renderToStaticMarkup(
      <LoanSummary
        f={f}
        loan={loanDetail()}
        href={href}
        accountName={(id) => (id === 'acc-loan' ? 'Préstamo vehicular' : undefined)}
      />,
    );
    expect(textOf(html)).toContain('11,50 %');
    expect(textOf(html)).toContain('30/360');
    expect(textOf(html)).toContain('0,0400 % mensual sobre el saldo');
    expect(textOf(html)).toContain('Préstamo vehicular');
  });

  it('cronograma: estados Pendiente, Parcial, Pagada y Atrasada con texto, y esperado/pagado/diferencia por componente', () => {
    const items = [
      installment({
        n: 1,
        status: 'PAID',
        paid: { principal: '1862.85', interest: '479.17', fees: '0.00', insurance: '0.00', taxes: '0.00' },
      }),
      installment({
        n: 2,
        status: 'PARTIALLY_PAID',
        paid: { principal: '1000.00', interest: '461.32', fees: '0.00', insurance: '0.00', taxes: '0.00' },
        differences: {
          principal: '-880.70',
          interest: '0.00',
          fees: '0.00',
          insurance: '0.00',
          taxes: '0.00',
        },
      }),
      installment({ n: 3, status: 'UNPAID', overdue: true }),
      installment({ n: 4, status: 'UNPAID' }),
    ];
    const html = renderToStaticMarkup(
      <InstallmentsTable f={f} items={items} currency="BOB" loanId="L1" canPay />,
    );
    expect(html).toContain('<caption');
    for (const [n, state] of [
      [1, 'PAID'],
      [2, 'PARTIALLY_PAID'],
      [3, 'OVERDUE'],
      [4, 'UNPAID'],
    ] as const)
      expect(html).toMatch(new RegExp(`data-testid="installment-row" data-n="${n}" data-state="${state}"`));
    const text = textOf(html);
    for (const label of ['Pagada', 'Parcial', 'Atrasada', 'Pendiente']) expect(text).toContain(label);
    expect(text).toContain('-880,70');
    expect(html).toContain('href="/debts/L1?pagar=1&amp;cuota=4"');
    expect(html).not.toContain('pagar=1&amp;cuota=1"');
  });

  it('pagos: solo el último pago activo ofrece "Anular"; los anulados muestran su motivo', () => {
    const html = renderToStaticMarkup(
      <PaymentsTable
        f={f}
        accountName={() => 'Banco'}
        canVoid
        onVoid={noop}
        items={[
          payment({ id: 'p1', paymentNo: 1 }),
          payment({ id: 'p2', paymentNo: 2, installmentNos: [2] }),
          payment({ id: 'p3', paymentNo: 3, status: 'VOIDED', voidedReason: 'monto equivocado' }),
        ]}
      />,
    );
    expect(html.match(/data-testid="payment-void"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Anular el pago 2"');
    expect(textOf(html)).toContain('monto equivocado');
    expect(textOf(html)).toContain('Capital 1.862,85');
    expect(textOf(html)).toContain('Interés 479,17');
  });

  it('un lector no ve acciones de anulación', () => {
    const html = renderToStaticMarkup(
      <PaymentsTable f={f} accountName={() => undefined} canVoid={false} onVoid={noop} items={[payment()]} />,
    );
    expect(html).not.toContain('payment-void');
  });
});

describe('registrar pago', () => {
  const account = {
    id: 'a1',
    name: 'Banco',
    type: 'BANK',
    classification: 'ASSET',
    status: 'ACTIVE',
    currency: 'BOB',
  } as never;
  const base = { f, set: noop, errors: {}, accounts: [account], currency: 'BOB', locale: 'es-BO', scale: 2 };

  it('modo automático no muestra el desglose', () => {
    const html = renderToStaticMarkup(
      <PaymentFields {...base} form={emptyPaymentForm({ businessDate: '2026-11-15', accountId: 'a1' })} />,
    );
    expect(html).toContain('data-testid="payment-mode-AUTO"');
    expect(html).not.toContain('data-testid="payment-breakdown"');
  });

  it('desglose del recibo: muestra la suma y avisa de la diferencia con el monto pagado', () => {
    const form = {
      ...emptyPaymentForm({ businessDate: '2026-11-15', accountId: 'a1', installmentNo: 1 }),
      mode: 'BREAKDOWN' as const,
      amount: '2342.02',
      principal: '1862.85',
      interest: '479.10',
    };
    const html = renderToStaticMarkup(<PaymentFields {...base} form={form} />);
    expect(textOf(html)).toContain('Suma del desglose: 2.341,95 BOB');
    expect(html).toContain('data-testid="payment-breakdown-delta"');
    expect(textOf(html)).toContain('Falta o sobra 0,07 BOB');
    const ok = renderToStaticMarkup(<PaymentFields {...base} form={{ ...form, interest: '479.17' }} />);
    expect(ok).toContain('data-testid="payment-breakdown-ok"');
  });

  it('[TC-DEBT-LOAN-012] los errores del servidor tienen mensaje propio en los tres idiomas', () => {
    for (const code of [
      'PAYMENT_BREAKDOWN_MISMATCH',
      'LOAN_OVERPAYMENT',
      'LOAN_PAYMENT_NOT_LATEST',
      'LOAN_TERMS_LOCKED',
      'LOAN_REFERENCE_INVALID',
      'TRANSACTION_MANAGED_EXTERNALLY',
    ])
      for (const locale of ['es', 'en', 'pt'])
        expect(problemMessage({ code }, locale), `${code}/${locale}`).not.toBe(
          problemMessage({ code: 'INTERNAL_ERROR' }, locale),
        );
  });
});

// ───────────────────────────── Comparación ─────────────────────────────

const side = (over: Partial<Record<string, string>> = {}) => ({
  dueDate: '2028-10-15',
  principal: '2319.80',
  interest: '22.22',
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
  total: '2342.02',
  ...over,
});
const diffs = (over: Partial<Record<string, string>> = {}) => ({
  principal: '0.00',
  interest: '0.00',
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
  total: '0.00',
  ...over,
});

function comparison(over: Partial<ScheduleComparison> = {}): ScheduleComparison {
  const rows: ComparedRow[] = [
    {
      n: 23,
      status: 'MATCH',
      datesMatch: true,
      system: side(),
      reference: side(),
      differences: diffs() as ComparedRow['differences'],
    },
    {
      n: 24,
      status: 'DIFFERENT',
      datesMatch: true,
      system: side({ dueDate: '2028-11-15' }),
      reference: side({ dueDate: '2028-11-15', total: '2341.89', principal: '2319.67' }),
      differences: diffs({ total: '-0.13', principal: '-0.13' }) as ComparedRow['differences'],
    },
  ];
  return {
    referenceId: 'ref-1',
    referenceVersion: 1,
    scheduleVersion: 1,
    status: 'UNEXPLAINED',
    explanation: null,
    explainedBy: null,
    explainedAt: null,
    matched: 1,
    totalRows: 2,
    firstDifferenceNo: 24,
    summary: {
      totalRows: 2,
      matching: 1,
      firstDifference: { n: 24 },
      sumDifferences: diffs({ total: '-0.13', principal: '-0.13' }) as never,
      differingComponents: ['principal', 'total'],
      dateMismatches: [],
      referencePrincipal: '49999.87',
      loanPrincipal: '50000.00',
      onlyReference: [],
      onlySystem: [25],
    },
    rows,
    suggestions: [
      { kind: 'ONLY_LAST_INSTALLMENT', tolerance: '0.24' },
      {
        kind: 'CONVENTION',
        dayCount: 'ACT_360',
        current: false,
        matchingInstallments: 2,
        interestMatchingInstallments: 2,
        totalRows: 2,
        betterThanCurrent: true,
      },
    ],
    ...over,
  };
}

describe('comparar con la tabla del banco', () => {
  it('resumen: coincidentes/total, primera diferencia, Σ diferencias, Σ capital y huérfanas', () => {
    const html = renderToStaticMarkup(<ComparisonSummaryView f={f} comparison={comparison()} />);
    const text = textOf(html);
    expect(html).toContain('aria-live="polite"');
    expect(text).toContain('1 de 2 cuotas coinciden.');
    expect(text).toContain('Primera diferencia: cuota 24.');
    expect(text).toContain('Capital: -0,13');
    expect(text).toContain('Capital total: banco 49.999,87 frente a préstamo 50.000,00.');
    expect(text).toContain('Cuotas solo en el sistema: 25.');
    expect(text).toContain('Con ACT_360'.replace('ACT_360', 'Real/360') + ' coincidirían 2 de 2 cuotas');
    expect(text).toContain('Es mejor que la actual.');
    expect(text).toContain('tolerancia de redondeo (0,24)');
    expect(text).toContain('Con diferencias sin explicar');
  });

  it('una coincidencia total se anuncia sin sugerencias ni panel de explicación', () => {
    const match = comparison({ status: 'MATCH', suggestions: [] });
    expect(textOf(renderToStaticMarkup(<ComparisonSummaryView f={f} comparison={match} />))).toContain(
      'Coincide al centavo',
    );
    expect(
      renderToStaticMarkup(<ExplainPanel f={f} comparison={match} canEdit busy={false} onExplain={noop} />),
    ).toBe('');
  });

  it('reporte por cuota: diferencia con signo por componente y las diferencias resaltadas', () => {
    const html = renderToStaticMarkup(<ComparisonTable f={f} comparison={comparison()} />);
    expect(html).toContain('<caption');
    expect(html).toMatch(/data-n="24" data-status="DIFFERENT"/);
    expect(html).toMatch(/data-n="23" data-status="MATCH"/);
    const row24 = html.slice(html.indexOf('data-n="24"'));
    expect(row24).toContain('-0,13');
    // el resaltado usa el token de error, no solo color: el signo y el estado "Difiere" van en texto
    expect(row24).toContain('var(--pf-error)');
    expect(textOf(row24)).toContain('Difiere');
  });

  it('explicar la diferencia: campo de hasta 1000 caracteres; ya explicada muestra el texto', () => {
    const open = renderToStaticMarkup(
      <ExplainPanel f={f} comparison={comparison()} canEdit busy={false} onExplain={noop} />,
    );
    expect(open).toContain('maxLength="1000"');
    expect(open).toContain('data-testid="comparison-explain-submit"');
    const done = renderToStaticMarkup(
      <ExplainPanel
        f={f}
        comparison={comparison({ status: 'EXPLAINED', explanation: 'El banco redondea la última cuota' })}
        canEdit
        busy={false}
        onExplain={noop}
        explainedAt="10/10/2026"
      />,
    );
    expect(textOf(done)).toContain('El banco redondea la última cuota');
    expect(textOf(done)).toContain('Actualizar la explicación');
    const viewer = renderToStaticMarkup(
      <ExplainPanel f={f} comparison={comparison()} canEdit={false} busy={false} onExplain={noop} />,
    );
    expect(viewer).not.toContain('comparison-explain-submit');
  });

  it('[TC-DEBT-AMORT-014] errores de carga por fila: región con alerta, filas legibles y foco programable', () => {
    const html = renderToStaticMarkup(
      <ReferenceErrors
        f={f}
        errors={[
          { row: 3, field: 'interest', code: 'VALUE_MISSING', message: 'x' },
          { row: 7, field: 'dueDate', code: 'DATE_INVALID', message: 'y' },
        ]}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(textOf(html)).toContain('La tabla tiene 2 errores. No se guardó nada.');
    expect(textOf(html)).toContain('Fila 3, Interés — falta el valor');
    expect(textOf(html)).toContain('Fila 7, Fecha — la fecha no es válida para el formato elegido');
    expect(renderToStaticMarkup(<ReferenceErrors f={f} errors={[]} />)).toBe('');
  });

  it('confirmar separador, mapeo por encabezado, formato de fecha y decimal', () => {
    const html = renderToStaticMarkup(
      <MappingForm
        f={f}
        busy={false}
        onApply={noop}
        set={noop}
        missing={['interest']}
        preview={{
          delimiter: ';',
          headers: ['Nro', 'Fecha', 'Capital', 'Interés'],
          rowCount: 24,
          preview: [['1', '15/11/2026', '1862,85', '479,17']],
        }}
        state={{
          delimiter: ';',
          mapping: { installmentNo: 'Nro', dueDate: 'Fecha', principal: 'Capital' },
          dateFormat: 'DD/MM/YYYY',
          decimalSeparator: ',',
        }}
      />,
    );
    expect(textOf(html)).toContain('Detectamos 24 filas y 4 columnas');
    expect(html).toContain('data-testid="reference-delimiter"');
    expect(html).toContain('<option value="Interés">');
    expect(textOf(html)).toContain('dd/mm/aaaa');
    expect(textOf(html)).toContain('aaaa-mm-dd');
    expect(textOf(html)).toContain('mm/dd/aaaa');
    expect(html).toContain('<caption');
    expect(textOf(html)).toContain('Es obligatorio.');
  });

  it('ingreso fila por fila con etiquetas por celda', () => {
    const html = renderToStaticMarkup(
      <ManualRows
        f={f}
        rows={[emptyManualRow(1), emptyManualRow(2)]}
        errors={{ '0.dueDate': 'REQUIRED' }}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        busy={false}
        onApply={noop}
      />,
    );
    expect(html).toContain('aria-label="Fila 1, Capital"');
    expect(html).toContain('aria-invalid="true"');
    expect(html.match(/data-testid="manual-row"/g)).toHaveLength(2);
  });
});

// ───────────────────────────── Recurrentes y transacciones ─────────────────────────────

describe('recurrentes: cuotas de préstamo', () => {
  const rf = esContext('Recurring');
  const occ = (over: Partial<RecurringOccurrence> = {}): RecurringOccurrence => ({
    id: 'o1',
    definitionId: 'def-1',
    definitionName: 'Cuota Vehículo',
    kind: 'LOAN_PAYMENT',
    managedBy: 'DEBT',
    occurrenceDate: '2026-12-15',
    dueDate: '2026-12-15',
    definitionVersionNo: 1,
    expected: { type: 'FIXED', amount: bob('2342.02') },
    projectedAmount: bob('2342.02'),
    status: 'DUE',
    cancelReason: null,
    requiresApproval: false,
    mode: 'NOTIFY_ONLY',
    overridden: false,
    accountId: 'a1',
    toAccountId: null,
    transactionId: null,
    resolution: null,
    matchedBy: null,
    skipReason: null,
    lastAutoCreateError: null,
    version: 1,
    ...over,
  });

  it('[TC-DEBT-LOAN-035] no ofrece aprobar, vincular, omitir ni editar; ofrece "Registrar pago" hacia el préstamo', () => {
    expect(availableOccurrenceActions(occ(), true)).toEqual([]);
    expect(canRegisterLoanPayment(occ(), true)).toBe(true);
    expect(canRegisterLoanPayment(occ({ status: 'MATCHED' }), true)).toBe(false);
    expect(canRegisterLoanPayment(occ(), false)).toBe(false);
    const html = renderToStaticMarkup(
      <OccurrencesTable
        occurrences={[occ()]}
        f={rf}
        uiLocale="es"
        canEdit
        accountName={() => 'Banco'}
        href={href}
        caption="Próximos"
        empty="Nada"
        onAction={noop}
        loanOf={(id) => (id === 'def-1' ? { id: 'L1', name: 'Vehículo' } : undefined)}
      />,
    );
    expect(html).toContain('data-testid="occurrence-register-payment"');
    expect(html).toContain('href="/debts/L1?pagar=1&amp;fecha=2026-12-15"');
    expect(html).toContain('href="/debts/L1"');
    expect(textOf(html)).toContain('Vehículo');
    for (const a of ['approve', 'link', 'skip', 'edit']) expect(html).not.toContain(`data-action="${a}"`);
  });

  it('las ocurrencias de otras definiciones conservan sus acciones', () => {
    expect(availableOccurrenceActions(occ({ kind: 'EXPENSE', managedBy: 'USER' }), true)).toEqual([
      'approve',
      'link',
      'skip',
      'edit',
    ]);
  });
});

describe('transacciones de préstamo', () => {
  const tx = (over: Partial<Transaction> = {}) =>
    ({ kind: 'LOAN_PAYMENT', status: 'POSTED', ...over }) as Transaction;

  it('[TC-DEBT-LOAN-040] no se anulan ni se editan montos desde transacciones (sí notas y etiquetas)', () => {
    const a = availableActions(tx());
    expect(a.void).toBe(false);
    expect(a.financialEdit).toBe(false);
    expect(a.edit).toBe(true);
    expect(availableActions(tx({ kind: 'LOAN_DISBURSEMENT' })).void).toBe(false);
    expect(availableActions(tx({ kind: 'EXPENSE' })).void).toBe(true);
  });

  it('muestra el distintivo "Préstamo" con enlace, el desglose y el mensaje de transacción administrada', () => {
    const html = renderToStaticMarkup(
      <LoanTransactionView
        f={f}
        href={href}
        loanName="Vehículo"
        managedMessage={problemMessage({ code: 'TRANSACTION_MANAGED_EXTERNALLY' }, 'es')}
        tx={{
          kind: 'LOAN_PAYMENT',
          loanId: 'L1',
          loanPaymentBreakdown: {
            principal: bob('1862.85'),
            interest: bob('479.17'),
            fees: bob('0.00'),
            insurance: bob('0.00'),
            taxes: bob('0.00'),
          },
        }}
      />,
    );
    expect(html).toContain('data-testid="tx-loan-badge"');
    expect(html).toContain('href="/debts/L1"');
    expect(textOf(html)).toContain('479,17 BOB');
    expect(textOf(html)).toContain('administra un préstamo');
  });
});
