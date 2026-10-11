import { currency, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { LOAN_DISBURSEMENT_NAMESPACE, LOAN_PAYMENT_NAMESPACE } from '../contracts/index.js';
import { LoanPaymentBreakdown, Transaction } from '../domain/index.js';
import { toTransactionDto } from './transactions-http.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
const WS = '0192f3c4-0000-7000-8000-000000000001';
const LOAN_ID = '0192f3c4-0000-7000-8000-0000000000e2';
const PAYMENT_ID = '0192f3c4-0000-7000-8000-0000000000e3';
const bank = { accountId: 'bank', nature: 'ASSET', currency: 'BOB' } as const;
const loan = { accountId: 'loan', nature: 'LIABILITY', currency: 'BOB' } as const;
let n = 0;
const id = () => `0192f3c4-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;

describe('Transaction DTO — préstamos', () => {
  it('[TC-DEBT-LOAN-040] el pago expone loanPaymentBreakdown (Money por componente) y loanId', () => {
    const tx = Transaction.recordLoanPayment({
      id: id(),
      workspaceId: WS,
      businessDate: '2026-11-15',
      paymentAccount: bank,
      loanAccount: loan,
      amount: bob('2342.02'),
      breakdown: LoanPaymentBreakdown.create({
        loanId: LOAN_ID,
        principal: bob('1862.85'),
        interest: bob('479.17'),
        fees: bob('0.00'),
        insurance: bob('0.00'),
        taxes: bob('0.00'),
      }),
      categoryIds: { interest: 'c1', fees: 'c2', insurance: 'c3', taxes: 'c4' },
      newSplitId: id,
      externalRef: { namespace: LOAN_PAYMENT_NAMESPACE, id: PAYMENT_ID },
    });
    const dto = toTransactionDto(tx.snapshot);
    expect(dto).toMatchObject({
      kind: 'LOAN_PAYMENT',
      source: 'DEBT',
      loanId: LOAN_ID,
      amount: { amount: '2342.02', currency: 'BOB' },
      loanPaymentBreakdown: {
        principal: { amount: '1862.85', currency: 'BOB' },
        interest: { amount: '479.17', currency: 'BOB' },
        fees: { amount: '0.00', currency: 'BOB' },
        insurance: { amount: '0.00', currency: 'BOB' },
        taxes: { amount: '0.00', currency: 'BOB' },
      },
    });
    expect(dto.legs.map((l) => l.role)).toEqual(['SOURCE', 'TARGET']);
  });

  it('el desembolso expone el loanId del externalRef y no lleva desglose; una transacción común, ambos nulos', () => {
    const disbursement = Transaction.recordLoanDisbursement({
      id: id(),
      workspaceId: WS,
      businessDate: '2026-10-15',
      loanAccount: loan,
      destinationAccount: bank,
      principal: bob('50000.00'),
      externalRef: { namespace: LOAN_DISBURSEMENT_NAMESPACE, id: LOAN_ID },
    });
    expect(toTransactionDto(disbursement.snapshot)).toMatchObject({
      kind: 'LOAN_DISBURSEMENT',
      loanId: LOAN_ID,
      loanPaymentBreakdown: null,
    });
    const expense = Transaction.record({
      id: id(),
      workspaceId: WS,
      kind: 'EXPENSE',
      businessDate: '2026-10-15',
      accountId: 'bank',
      accountNature: 'ASSET',
      accountCurrency: 'BOB',
      amount: bob('10.00'),
      defaultCategoryId: 'c1',
      defaultSplitId: id(),
    });
    expect(toTransactionDto(expense.snapshot)).toMatchObject({ loanId: null, loanPaymentBreakdown: null });
  });
});
