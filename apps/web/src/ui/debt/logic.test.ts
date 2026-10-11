import { describe, expect, it } from 'vitest';
import {
  autoMapping,
  breakdownDelta,
  breakdownSum,
  buildLoanInput,
  buildManualRows,
  buildPaymentInput,
  buildPreviewInput,
  buildReferenceInput,
  emptyLoanForm,
  emptyManualRow,
  emptyPaymentForm,
  fractionToPercent,
  guessDateFormat,
  guessDecimal,
  installmentView,
  lastActivePaymentId,
  missingMapping,
  parseDisburseFee,
  paymentHref,
  percentToFraction,
  referenceRowErrors,
  type LoanForm,
} from './logic';

const o = { locale: 'es-BO', scale: 2 };

/** Préstamo vehicular del E2E: 50000.00 BOB, 11,50 %, 24 cuotas, 30/360. */
const vehicle = (over: Partial<LoanForm> = {}): LoanForm => ({
  ...emptyLoanForm('BOB', '2026-10-15'),
  name: 'Vehículo',
  principal: '50000.00',
  ratePct: '11.50',
  termInstallments: '24',
  disbursementDate: '2026-10-15',
  firstDueDate: '2026-11-15',
  accountMode: 'CREATE',
  newAccountName: 'Préstamo vehicular',
  disbursementAccountId: 'acc-bank',
  paymentAccountId: 'acc-bank',
  ...over,
});

describe('tasa: porcentaje en pantalla ↔ fracción decimal de la API', () => {
  it('convierte el porcentaje a fracción exacta como string, sin pasar por number', () => {
    expect(percentToFraction('11.50', 'es-BO')).toBe('0.115');
    expect(percentToFraction('11,50', 'es-BO')).toBe('0.115');
    expect(percentToFraction('0,0400', 'es-BO')).toBe('0.0004');
    expect(percentToFraction('5', 'es-BO')).toBe('0.05');
    expect(percentToFraction('100', 'es-BO')).toBe('1');
    expect(percentToFraction('0', 'es-BO')).toBe('0');
    expect(percentToFraction('12,345678', 'es-BO')).toBe('0.12345678');
  });

  it('rechaza lo que no es un porcentaje no negativo', () => {
    for (const raw of ['', '  ', '-1', 'abc', '1,2,3x'])
      expect(percentToFraction(raw, 'es-BO'), raw).toBeNull();
  });

  it('la conversión inversa muestra al menos dos decimales', () => {
    expect(fractionToPercent('0.115')).toBe('11.50');
    expect(fractionToPercent('0.0004')).toBe('0.04');
    expect(fractionToPercent('0.0004', 4)).toBe('0.0400');
    expect(fractionToPercent('1')).toBe('100.00');
    expect(fractionToPercent('0.1')).toBe('10.00');
  });

  it('ida y vuelta conserva el valor', () => {
    for (const pct of ['11.50', '0.04', '7.25', '99.99'])
      expect(fractionToPercent(percentToFraction(pct, 'en-US')!)).toBe(pct);
  });
});

describe('alta de préstamo: armado del payload', () => {
  it('[TC-DEBT-LOAN-001] préstamo nuevo: tasa como fracción, montos como string y cuenta creada en el acto', () => {
    const r = buildLoanInput(vehicle(), o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      name: 'Vehículo',
      origin: 'NEW',
      principal: { amount: '50000.00', currency: 'BOB' },
      annualRate: '0.115',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      termInstallments: 24,
      method: 'FRENCH',
      firstDueDate: '2026-11-15',
      disbursementDate: '2026-10-15',
      account: { create: { name: 'Préstamo vehicular' } },
      disbursementAccountId: 'acc-bank',
      paymentAccountId: 'acc-bank',
    });
  });

  it('desembolsar ahora con comisión retenida; sin la casilla no se envía nada de desembolso', () => {
    const now = buildLoanInput(vehicle({ disburseNow: true, retainedFee: '250,00' }), o);
    expect(now.ok && now.input).toMatchObject({ disburseNow: true, retainedFee: '250.00' });
    const off = buildLoanInput(vehicle({ disburseNow: false, retainedFee: '250,00' }), o);
    expect(off.ok && 'disburseNow' in off.input).toBe(false);
  });

  it('cargos: monto fijo por cuota o tasa MENSUAL en % que viaja como fracción (0,0400 % ⇒ "0.0004")', () => {
    const r = buildLoanInput(
      vehicle({
        charges: {
          fees: { mode: 'FIXED', value: '10.00' },
          insurance: { mode: 'RATE_ON_BALANCE', value: '0,0400' },
          taxes: { mode: 'NONE', value: '' },
        },
      }),
      o,
    );
    expect(r.ok && r.input['charges']).toEqual({
      fees: { mode: 'FIXED', value: '10.00' },
      insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
    });
  });

  it('cuenta existente y prestamista', () => {
    const r = buildLoanInput(
      vehicle({ accountMode: 'EXISTING', accountId: 'acc-loan', lenderCounterpartyId: 'cp-1' }),
      o,
    );
    expect(r.ok && r.input).toMatchObject({ account: { id: 'acc-loan' }, lenderCounterpartyId: 'cp-1' });
  });

  it('préstamo en curso: saldo, fecha del saldo, próxima cuota y cuotas restantes; la cuenta destino es la de pago', () => {
    const r = buildLoanInput(
      vehicle({
        origin: 'EXISTING',
        principal: '31000,50',
        termInstallments: '10',
        asOf: '2026-10-01',
        nextInstallmentNo: '15',
        firstDueDate: '2026-10-20',
        disbursementAccountId: '',
        paymentAccountId: 'acc-pay',
      }),
      o,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({
      origin: 'EXISTING',
      principal: { amount: '31000.50', currency: 'BOB' },
      termInstallments: 10,
      existing: { asOf: '2026-10-01', nextInstallmentNo: 15 },
      firstDueDate: '2026-10-20',
      disbursementAccountId: 'acc-pay',
    });
    expect(r.input['disbursementDate']).toBeUndefined();
  });

  it('valida por campo: obligatorios, escala, rango de cuotas, tasa y orden de fechas', () => {
    const r = buildLoanInput(
      vehicle({
        name: ' ',
        principal: '10,001',
        ratePct: '150',
        termInstallments: '601',
        firstDueDate: '2026-10-01',
        newAccountName: '',
        disbursementAccountId: '',
      }),
      o,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      name: 'REQUIRED',
      principal: 'SCALE',
      ratePct: 'RANGE',
      termInstallments: 'RANGE',
      firstDueDate: 'DATE_ORDER',
      newAccountName: 'REQUIRED',
      disbursementAccountId: 'REQUIRED',
    });
  });

  it('1 y 600 cuotas son válidas; 0 no', () => {
    expect(buildLoanInput(vehicle({ termInstallments: '1' }), o).ok).toBe(true);
    expect(buildLoanInput(vehicle({ termInstallments: '600' }), o).ok).toBe(true);
    expect(buildLoanInput(vehicle({ termInstallments: '0' }), o).ok).toBe(false);
  });

  it('la vista previa espera a tener las condiciones completas y no lleva cuentas', () => {
    expect(buildPreviewInput(emptyLoanForm('BOB', '2026-10-15'), o)).toBeNull();
    const body = buildPreviewInput(vehicle(), o);
    expect(body).toMatchObject({
      name: 'Vehículo',
      annualRate: '0.115',
      termInstallments: 24,
      method: 'FRENCH',
    });
    expect(body).not.toHaveProperty('account');
    expect(body).not.toHaveProperty('disbursementAccountId');
  });
});

describe('pago del préstamo', () => {
  const pay = { locale: 'es-BO', scale: 2, currency: 'BOB' };

  it('modo automático: solo monto, fecha y cuenta', () => {
    const r = buildPaymentInput(
      { ...emptyPaymentForm({ businessDate: '2026-11-15', accountId: 'acc' }), amount: '2342.02' },
      pay,
    );
    expect(r.ok && r.input).toEqual({
      amount: { amount: '2342.02', currency: 'BOB' },
      businessDate: '2026-11-15',
      accountId: 'acc',
    });
  });

  it('desglose del recibo: cuota y componentes como strings; los vacíos se omiten', () => {
    const form = {
      ...emptyPaymentForm({ businessDate: '2026-11-15', accountId: 'acc', installmentNo: 1 }),
      amount: '2342.02',
      mode: 'BREAKDOWN' as const,
      principal: '1862.85',
      interest: '479,17',
      paymentMethod: 'BANK_TRANSFER',
    };
    const r = buildPaymentInput(form, pay);
    expect(r.ok && r.input).toMatchObject({
      installmentNo: 1,
      breakdown: { principal: '1862.85', interest: '479.17' },
      paymentMethod: 'BANK_TRANSFER',
    });
    expect(breakdownSum(form, pay)).toBe('2342.02');
    expect(breakdownDelta(form, pay)).toBe('0.00');
    expect(breakdownDelta({ ...form, interest: '479.10' }, pay)).toBe('0.07');
  });

  it('exige cuenta, fecha, monto positivo y cuota con desglose', () => {
    const r = buildPaymentInput(
      { ...emptyPaymentForm({ businessDate: '' }), mode: 'BREAKDOWN', amount: '0' },
      pay,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      amount: 'NOT_POSITIVE',
      businessDate: 'REQUIRED',
      accountId: 'REQUIRED',
      installmentNo: 'REQUIRED',
    });
  });

  it('un componente del desglose con más decimales que la moneda se marca por campo', () => {
    const r = buildPaymentInput(
      {
        ...emptyPaymentForm({ businessDate: '2026-11-15', accountId: 'a', installmentNo: 1 }),
        amount: '10.00',
        mode: 'BREAKDOWN',
        interest: '1,005',
      },
      pay,
    );
    expect(!r.ok && r.errors['interest']).toBe('SCALE');
  });

  it('comisión retenida opcional del desembolso', () => {
    expect(parseDisburseFee('', pay)).toEqual({ ok: true, value: undefined });
    expect(parseDisburseFee('250,5', pay)).toEqual({ ok: true, value: '250.50' });
    expect(parseDisburseFee('x', pay)).toEqual({ ok: false, error: 'INVALID' });
  });
});

describe('estados y enlaces', () => {
  it('una cuota sin pagar completa y vencida se muestra Atrasada; la pagada nunca', () => {
    expect(installmentView({ status: 'UNPAID', overdue: false })).toBe('UNPAID');
    expect(installmentView({ status: 'UNPAID', overdue: true })).toBe('OVERDUE');
    expect(installmentView({ status: 'PARTIALLY_PAID', overdue: true })).toBe('OVERDUE');
    expect(installmentView({ status: 'PARTIALLY_PAID', overdue: false })).toBe('PARTIALLY_PAID');
    expect(installmentView({ status: 'PAID', overdue: true })).toBe('PAID');
  });

  it('solo el último pago activo se puede anular', () => {
    expect(
      lastActivePaymentId([
        { id: 'a', status: 'ACTIVE', paymentNo: 1 },
        { id: 'b', status: 'ACTIVE', paymentNo: 2 },
        { id: 'c', status: 'VOIDED', paymentNo: 3 },
      ]),
    ).toBe('b');
    expect(lastActivePaymentId([])).toBeUndefined();
  });

  it('el enlace de "Registrar pago" abre el préstamo con el formulario prellenado', () => {
    expect(paymentHref('L1')).toBe('/debts/L1?pagar=1');
    expect(paymentHref('L1', { installmentNo: 3, date: '2026-12-15' })).toBe(
      '/debts/L1?pagar=1&cuota=3&fecha=2026-12-15',
    );
  });
});

describe('comparar con la tabla del banco: mapeo y payload', () => {
  const headers = [
    'Nro',
    'Fecha',
    'Capital',
    'Interés',
    'Comisiones',
    'Seguro',
    'Impuestos',
    'Cuota',
    'Saldo',
  ];

  it('mapea las columnas por el nombre del encabezado (con o sin tildes)', () => {
    expect(autoMapping(headers)).toEqual({
      installmentNo: 'Nro',
      dueDate: 'Fecha',
      principal: 'Capital',
      interest: 'Interés',
      fees: 'Comisiones',
      insurance: 'Seguro',
      taxes: 'Impuestos',
      total: 'Cuota',
      balance: 'Saldo',
    });
    expect(autoMapping(['N°', 'Vencimiento', 'Amortización', 'Intereses'])).toMatchObject({
      dueDate: 'Vencimiento',
      principal: 'Amortización',
      interest: 'Intereses',
    });
  });

  it('lista los campos obligatorios sin columna', () => {
    expect(missingMapping({ installmentNo: 'Nro', dueDate: 'Fecha' })).toEqual(['principal', 'interest']);
    expect(missingMapping(autoMapping(headers))).toEqual([]);
  });

  it('adivina formato de fecha y separador decimal', () => {
    expect(guessDateFormat('2026-11-15')).toBe('YYYY-MM-DD');
    expect(guessDateFormat('15/11/2026')).toBe('DD/MM/YYYY');
    expect(guessDateFormat('11/15/2026')).toBe('MM/DD/YYYY');
    expect(guessDateFormat(undefined)).toBe('DD/MM/YYYY');
    expect(guessDecimal(';')).toBe(',');
    expect(guessDecimal(',')).toBe('.');
  });

  it('el payload de CSV/PASTE lleva el texto, el mapeo explícito y los formatos; sin columnas vacías', () => {
    const input = buildReferenceInput('PASTE', 'Nro;Fecha\n1;15/11/2026', {
      delimiter: ';',
      mapping: { installmentNo: 'Nro', dueDate: 'Fecha', fees: '' },
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
    });
    expect(input).toEqual({
      source: 'PASTE',
      text: 'Nro;Fecha\n1;15/11/2026',
      delimiter: ';',
      hasHeader: true,
      mapping: { installmentNo: 'Nro', dueDate: 'Fecha' },
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
    });
  });

  it('ingreso fila por fila (MANUAL): montos exactos y opcionales omitidos', () => {
    const r = buildManualRows(
      [
        {
          ...emptyManualRow(24),
          dueDate: '2028-10-15',
          principal: '2319,67',
          interest: '22.22',
          total: '2341.89',
        },
      ],
      { ...o, currency: 'BOB' },
    );
    expect(r.ok && r.input).toEqual({
      source: 'MANUAL',
      rows: [{ n: 24, dueDate: '2028-10-15', principal: '2319.67', interest: '22.22', total: '2341.89' }],
    });
  });

  it('errores del ingreso manual por "{fila}.{campo}"', () => {
    const r = buildManualRows([{ ...emptyManualRow(1), dueDate: '', principal: '', interest: '1,234' }], {
      ...o,
      currency: 'BOB',
    });
    expect(!r.ok && r.errors).toMatchObject({
      '0.dueDate': 'REQUIRED',
      '0.principal': 'REQUIRED',
      '0.interest': 'SCALE',
    });
    expect(buildManualRows([], { ...o, currency: 'BOB' }).ok).toBe(false);
  });

  it('LOAN_REFERENCE_INVALID: extrae details.rows[] y tolera formas inesperadas', () => {
    expect(
      referenceRowErrors({
        code: 'LOAN_REFERENCE_INVALID',
        details: {
          rows: [{ row: 3, field: 'interest', code: 'VALUE_MISSING', message: 'vacío', details: {} }, 'x'],
        },
      }),
    ).toEqual([{ row: 3, field: 'interest', code: 'VALUE_MISSING', message: 'vacío' }]);
    expect(referenceRowErrors({ code: 'X' })).toEqual([]);
    expect(referenceRowErrors({ details: { rows: 'no' } })).toEqual([]);
  });
});
