import { DomainError, Money, type Currency } from '@pf/shared-kernel';

/** Componente de gasto de un pago de préstamo y la categoría de sistema (`systemCode`) a la que se imputa. */
export const LOAN_EXPENSE_COMPONENTS = [
  { key: 'interest', systemCode: 'INTEREST' },
  { key: 'fees', systemCode: 'LOAN_FEES' },
  { key: 'insurance', systemCode: 'INSURANCE' },
  { key: 'taxes', systemCode: 'TAXES' },
] as const;
export type LoanExpenseComponent = (typeof LOAN_EXPENSE_COMPONENTS)[number]['key'];
export type LoanSystemCategoryCode = (typeof LOAN_EXPENSE_COMPONENTS)[number]['systemCode'];

/** Representación persistida/serializada (`txn.transaction.loan_payment_breakdown`): decimales como texto. */
export interface LoanPaymentBreakdownJson {
  readonly loanId: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
}

export interface LoanPaymentBreakdownInput {
  readonly loanId: string;
  readonly principal: Money;
  readonly interest: Money;
  readonly fees: Money;
  readonly insurance: Money;
  readonly taxes: Money;
}

/**
 * `LoanPaymentBreakdown` (docs/04 §3.6, INV-016): principal (reduce la deuda, no es gasto) + interés + comisiones +
 * seguro + impuestos (gasto). Todos los componentes en la misma moneda, ≥ 0; Σ componentes = monto pagado.
 */
export class LoanPaymentBreakdown {
  private constructor(
    readonly loanId: string,
    readonly principal: Money,
    readonly interest: Money,
    readonly fees: Money,
    readonly insurance: Money,
    readonly taxes: Money,
  ) {}

  static create(input: LoanPaymentBreakdownInput): LoanPaymentBreakdown {
    if (input.loanId.trim().length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'loanId is required').at('/breakdown/loanId');
    }
    const code = input.principal.currency.code;
    for (const key of ['principal', 'interest', 'fees', 'insurance', 'taxes'] as const) {
      const m = input[key];
      if (m.currency.code !== code) {
        throw new DomainError(
          'CURRENCY_MISMATCH',
          `breakdown.${key} is in ${m.currency.code}, not ${code}`,
        ).at(`/breakdown/${key}/currency`);
      }
      if (m.isNegative()) {
        throw new DomainError('VALIDATION_FAILED', `breakdown.${key} must be >= 0`).at(
          `/breakdown/${key}/amount`,
        );
      }
    }
    return new LoanPaymentBreakdown(
      input.loanId,
      input.principal,
      input.interest,
      input.fees,
      input.insurance,
      input.taxes,
    );
  }

  /** Reconstruye desde el JSON persistido, en la moneda de la transacción. */
  static fromJson(json: LoanPaymentBreakdownJson, currency: Currency): LoanPaymentBreakdown {
    return LoanPaymentBreakdown.create({
      loanId: json.loanId,
      principal: Money.parse(json.principal, currency),
      interest: Money.parse(json.interest, currency),
      fees: Money.parse(json.fees, currency),
      insurance: Money.parse(json.insurance, currency),
      taxes: Money.parse(json.taxes, currency),
    });
  }

  get currency(): Currency {
    return this.principal.currency;
  }

  /** Σ de los cinco componentes. */
  total(): Money {
    return Money.sum(
      [this.principal, this.interest, this.fees, this.insurance, this.taxes],
      this.principal.currency,
    );
  }

  /** Σ de los componentes de gasto (todo menos el principal). */
  expenseTotal(): Money {
    return Money.sum([this.interest, this.fees, this.insurance, this.taxes], this.principal.currency);
  }

  /** INV-016: `Σ componentes = monto pagado`, exacto; si no, `PAYMENT_BREAKDOWN_MISMATCH` con `details.sum/amount`. */
  assertMatches(amount: Money): void {
    if (amount.currency.code !== this.currency.code) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `the breakdown is in ${this.currency.code}, the payment in ${amount.currency.code}`,
      ).at('/breakdown');
    }
    const sum = this.total();
    if (!sum.equals(amount)) {
      throw new DomainError(
        'PAYMENT_BREAKDOWN_MISMATCH',
        `the breakdown adds up to ${sum.toFixed()} but the payment is ${amount.toFixed()}`,
        { details: { sum: sum.toFixed(), amount: amount.toFixed() } },
      ).at('/breakdown');
    }
  }

  toJson(): LoanPaymentBreakdownJson {
    return {
      loanId: this.loanId,
      principal: this.principal.toFixed(),
      interest: this.interest.toFixed(),
      fees: this.fees.toFixed(),
      insurance: this.insurance.toFixed(),
      taxes: this.taxes.toFixed(),
    };
  }
}
