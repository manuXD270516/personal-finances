import { RECURRING_OCCURRENCE_NAMESPACE, type RecurringTransactionPort } from '../contracts/index.js';
import type { TransactionsService } from './transactions.service.js';

/**
 * Adapter de `RecurringTransactionPort` (openspec add-recurrence-engine, design decisión 10): reutiliza los comandos
 * `recordTransaction` / `recordTransfer` con `source = RECURRING` y `externalRef = commitments.occurrence/<id>`, en la
 * unidad de trabajo del llamador (la `PgUnitOfWork` reutiliza la transacción PG en curso). El índice único parcial de
 * `txn.transaction` por `externalRef` impide una segunda transacción para la misma ocurrencia.
 *
 * Sin categoría no hay split explícito: la transacción nace en *Uncategorized* y los tags de la plantilla no se aplican
 * (un tag vive en el split).
 */
export class RecurringTransactionAdapter implements RecurringTransactionPort {
  constructor(private readonly service: Pick<TransactionsService, 'recordTransaction' | 'recordTransfer'>) {}

  async record(input: Parameters<RecurringTransactionPort['record']>[0]) {
    const externalRef = {
      namespace: RECURRING_OCCURRENCE_NAMESPACE,
      id: input.occurrenceRef.occurrenceId,
    };
    const common = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      status: input.status,
      transactionDate: input.businessDate,
      amount: input.amount,
      description: input.description,
      paymentMethod: (input.paymentMethod ?? null) as never,
      source: 'RECURRING' as const,
      externalRef,
    };
    if (input.kind === 'TRANSFER') {
      const state = await this.service.recordTransfer({
        ...common,
        fromAccountId: input.accountId,
        toAccountId: input.toAccountId as string,
      });
      return { transactionId: state.id, status: state.status, businessDate: state.businessDate };
    }
    const { transaction } = await this.service.recordTransaction({
      ...common,
      kind: input.kind,
      accountId: input.accountId,
      counterpartyId: input.counterpartyId ?? null,
      ...(input.categoryId
        ? {
            splits: [
              {
                amount: input.amount,
                categoryId: input.categoryId,
                counterpartyId: input.counterpartyId ?? null,
                tagIds: input.tagIds ?? [],
              },
            ],
          }
        : {}),
    });
    return {
      transactionId: transaction.id,
      status: transaction.status,
      businessDate: transaction.businessDate,
    };
  }
}
