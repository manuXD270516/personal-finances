import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Loan, type LoanTermsInput } from './loan.js';
import { LOAN_LIFECYCLE } from './loan-lifecycle.js';

const AT = '2026-10-10T16:00:00.000Z';
const terms = (
  over: Partial<LoanTermsInput> = {},
): LoanTermsInput & { id: string; workspaceId: string; at: string; by: string } => ({
  id: '01928c4e-0000-7000-8000-0000000b0001',
  workspaceId: '01928c4e-0000-7000-8000-00000000a001',
  at: AT,
  by: '01928c4e-0000-7000-8000-00000000b001',
  name: 'Préstamo vehicular',
  accountId: '01928c4e-0000-7000-8000-0000000ac001',
  disbursementAccountId: '01928c4e-0000-7000-8000-0000000ac002',
  paymentAccountId: '01928c4e-0000-7000-8000-0000000ac002',
  principal: '50000.00',
  currency: 'BOB',
  currencyScale: 2,
  annualRate: '0.115',
  termInstallments: 24,
  disbursementDate: '2026-10-15',
  firstDueDate: '2026-11-15',
  ...over,
});
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return 'NO_ERROR';
};

describe('AR Loan: alta y validaciones', () => {
  it('[TC-DEBT-LOAN-001] un préstamo nuevo nace en borrador con sus condiciones normalizadas', () => {
    const loan = Loan.register(terms());
    expect(loan.status).toBe('DRAFT');
    expect(loan.lastTransition).toEqual({ transition: 'REGISTER', from: null, to: 'DRAFT' });
    expect(loan.snapshot).toMatchObject({
      principal: '50000.00',
      annualRate: '0.115',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      method: 'FRENCH',
      retainedFee: '0.00',
      currentScheduleVersion: null,
    });
  });

  it('[TC-DEBT-LOAN-002] la primera cuota debe ser posterior al desembolso', () => {
    expect(code(() => Loan.register(terms({ firstDueDate: '2026-10-10' })))).toBe('VALIDATION_FAILED');
    expect(code(() => Loan.register(terms({ firstDueDate: '2026-10-15' })))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-LOAN-003] los sistemas distintos del francés no están disponibles', () => {
    for (const method of ['GERMAN', 'FIXED_PRINCIPAL', 'CUSTOM']) {
      expect(code(() => Loan.register(terms({ method })))).toBe('LOAN_METHOD_NOT_AVAILABLE');
    }
    expect(code(() => Loan.register(terms({ method: 'BULLET' })))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-LOAN-044] un principal con más decimales que la moneda se rechaza', () => {
    expect(code(() => Loan.register(terms({ principal: '50000.005' })))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(code(() => Loan.register(terms({ principal: '0.00' })))).toBe('VALIDATION_FAILED');
    expect(code(() => Loan.register(terms({ annualRate: '1.5' })))).toBe('VALIDATION_FAILED');
    expect(code(() => Loan.register(terms({ termInstallments: 601 })))).toBe('VALIDATION_FAILED');
    expect(code(() => Loan.register(terms({ termInstallments: 0 })))).toBe('VALIDATION_FAILED');
  });

  it('normaliza los cargos: un cargo en cero equivale a no tenerlo y se valida la escala', () => {
    const loan = Loan.register(
      terms({
        charges: {
          fees: { mode: 'FIXED', value: '10' },
          insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
          taxes: { mode: 'FIXED', value: '0' },
        },
      }),
    );
    expect(loan.snapshot.charges).toEqual({
      fees: { mode: 'FIXED', value: '10.00' },
      insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
    });
    expect(code(() => Loan.register(terms({ charges: { fees: { mode: 'FIXED', value: '10.001' } } })))).toBe(
      'AMOUNT_SCALE_EXCEEDED',
    );
  });
});

describe('AR Loan: estados y condiciones bloqueadas', () => {
  const persisted = () => {
    const loan = Loan.register(terms());
    loan.markPersisted();
    return loan;
  };

  it('[TC-DEBT-LOAN-007] desembolsar activa el préstamo con el cronograma v1; solo un borrador se desembolsa', () => {
    const loan = persisted();
    loan.disburse({ transactionId: 't1', retainedFee: '500.00', recurringDefinitionId: 'd1' }, AT);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.snapshot).toMatchObject({
      currentScheduleVersion: 1,
      retainedFee: '500.00',
      disbursementTransactionId: 't1',
    });
    expect(loan.version).toBe(2);
    expect(
      code(() =>
        loan.disburse({ transactionId: 't2', retainedFee: '0.00', recurringDefinitionId: 'd2' }, AT),
      ),
    ).toBe('LOAN_NOT_DRAFT');
  });

  it('[TC-DEBT-AMORT-013] [TC-DEBT-AMORT-014] las condiciones de un préstamo activo están bloqueadas; el nombre no', () => {
    const loan = persisted();
    loan.disburse({ transactionId: 't1', retainedFee: '0.00', recurringDefinitionId: 'd1' }, AT);
    expect(code(() => loan.edit({ terms: { annualRate: '0.10' } }, 2, AT))).toBe('LOAN_TERMS_LOCKED');
    loan.edit({ name: 'Auto 2026' }, 2, AT);
    expect(loan.snapshot.name).toBe('Auto 2026');
    expect(loan.snapshot.annualRate).toBe('0.115');
  });

  it('en borrador las condiciones se editan libremente y se revalidan', () => {
    const loan = persisted();
    loan.edit({ terms: { annualRate: '0.10', termInstallments: 12 } }, 2, AT);
    expect(loan.snapshot).toMatchObject({ annualRate: '0.1', termInstallments: 12 });
    expect(code(() => loan.edit({ terms: { firstDueDate: '2026-10-01' } }, 2, AT))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-LOAN-027] [TC-DEBT-LOAN-045] saldar, reactivar y cancelar siguen la máquina del recorrido', () => {
    const loan = persisted();
    loan.disburse({ transactionId: 't1', retainedFee: '0.00', recurringDefinitionId: 'd1' }, AT);
    loan.payOff(AT);
    expect(loan.status).toBe('PAID_OFF');
    expect(code(() => loan.payOff(AT))).toBe('LOAN_NOT_ACTIVE');
    loan.reactivate(AT, 'd2');
    expect(loan.status).toBe('ACTIVE');
    expect(loan.snapshot.recurringDefinitionId).toBe('d2');
    loan.cancel('duplicado', AT);
    expect(loan.status).toBe('CANCELLED');
    expect(loan.snapshot.cancelledReason).toBe('duplicado');
    expect(code(() => loan.cancel('otra vez', AT))).toBe('INVALID_STATUS_TRANSITION');
    expect(LOAN_LIFECYCLE.isTerminal('CANCELLED')).toBe(true);
  });

  it('un préstamo en curso entra activo con el pendiente como principal y la numeración continua', () => {
    const loan = Loan.registerExisting({
      ...terms({ principal: '30000.00', termInstallments: 18, disbursementDate: '2026-10-15' }),
      nextInstallmentNo: 7,
    });
    expect(loan.status).toBe('ACTIVE');
    expect(loan.lastTransition?.transition).toBe('REGISTER_EXISTING');
    expect(loan.snapshot).toMatchObject({
      origin: 'EXISTING',
      currentScheduleVersion: 1,
      existing: { asOf: '2026-10-15', outstanding: '30000.00', nextInstallmentNo: 7 },
    });
  });
});
