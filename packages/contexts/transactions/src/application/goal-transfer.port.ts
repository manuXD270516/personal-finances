import { GOAL_MOVEMENT_NAMESPACE, type GoalTransferPort } from '../contracts/index.js';
import type { TransactionsService } from './transactions.service.js';

/**
 * Adapter de `GoalTransferPort` (openspec add-savings-goals, decisión 3 y N1): reutiliza `recordTransfer` con
 * `source = GOAL` y `externalRef = goals.movement/<movementId>` en la unidad de trabajo del llamador (la `PgUnitOfWork`
 * reutiliza la transacción PG en curso). Las mismas validaciones que cualquier transferencia entre cuentas propias.
 */
export class GoalTransferAdapter implements GoalTransferPort {
  constructor(private readonly service: Pick<TransactionsService, 'recordTransfer'>) {}

  async recordTransfer(input: Parameters<GoalTransferPort['recordTransfer']>[0]) {
    const state = await this.service.recordTransfer({
      workspaceId: input.workspaceId,
      userId: input.userId,
      status: 'POSTED',
      transactionDate: input.businessDate,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      description: input.description,
      source: 'GOAL',
      externalRef: { namespace: GOAL_MOVEMENT_NAMESPACE, id: input.goalRef.movementId },
    });
    return { transactionId: state.id, businessDate: state.businessDate, revision: state.revision };
  }
}
