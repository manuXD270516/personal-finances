import { type LoanTransactionsPort } from '../contracts/index.js';
import type { TransactionsService } from './transactions.service.js';

/**
 * Adapter de `LoanTransactionsPort` (openspec add-loans, design decisiones 5, 8 y 10): reutiliza el servicio de
 * transacciones —validación de cuentas (activas, moneda ⇒ `CURRENCY_MISMATCH`), traductor al ledger (periodos
 * cerrados ⇒ `PERIOD_CLOSED`), auditoría, recorrido y outbox— en la unidad de trabajo del llamador (la `PgUnitOfWork`
 * reutiliza la transacción PG en curso). Las transacciones nacen `source = DEBT` y quedan administradas: la API de
 * transacciones no las edita financieramente ni las anula (`TRANSACTION_MANAGED_EXTERNALLY`); `voidManaged` es el único
 * camino de anulación. Idempotente por `externalRef` (`debt.loan` / `debt.loan-payment`).
 */
export class LoanTransactionsAdapter implements LoanTransactionsPort {
  constructor(
    private readonly service: Pick<
      TransactionsService,
      'recordLoanDisbursement' | 'recordLoanPayment' | 'voidManagedTransaction'
    >,
  ) {}

  async recordDisbursement(input: Parameters<LoanTransactionsPort['recordDisbursement']>[0]) {
    const state = await this.service.recordLoanDisbursement({
      workspaceId: input.workspaceId,
      loanId: input.loanId,
      businessDate: input.businessDate,
      loanAccountId: input.loanAccountId,
      destinationAccountId: input.destinationAccountId,
      principal: input.principal,
      retainedFee: input.retainedFee ?? null,
      counterpartyId: input.counterpartyId ?? null,
      description: input.description,
    });
    return { transactionId: state.id, businessDate: state.businessDate };
  }

  async recordPayment(input: Parameters<LoanTransactionsPort['recordPayment']>[0]) {
    const state = await this.service.recordLoanPayment({
      workspaceId: input.workspaceId,
      paymentId: input.paymentId,
      businessDate: input.businessDate,
      paymentAccountId: input.paymentAccountId,
      loanAccountId: input.loanAccountId,
      amount: input.amount,
      breakdown: input.breakdown,
      paymentMethod: (input.paymentMethod ?? null) as never,
      counterpartyId: input.counterpartyId ?? null,
      description: input.description,
    });
    return { transactionId: state.id, businessDate: state.businessDate };
  }

  async voidManaged(input: Parameters<LoanTransactionsPort['voidManaged']>[0]) {
    await this.service.voidManagedTransaction(input.workspaceId, input.transactionId, input.reason);
  }
}
