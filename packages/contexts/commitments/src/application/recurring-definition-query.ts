import type { RecurringDefinitionQuery } from '../contracts/index.js';
import type { CommitmentsDeps } from './ports/index.js';

/**
 * Consulta pública de definiciones del USUARIO que transfieren a una cuenta (openspec add-credit-cards, decisión 7):
 * Debt rechaza el plan de pago de una tarjeta con `CARD_PAYMENT_PLAN_CONFLICT` mientras exista una `TRANSFER` activa
 * hacia su cuenta. Solo lectura; corre en la unidad de trabajo del llamador si existe (RLS por workspace).
 */
export class EngineRecurringDefinitionQuery implements RecurringDefinitionQuery {
  constructor(private readonly deps: CommitmentsDeps) {}

  listActiveTransfersTo(
    input: Parameters<RecurringDefinitionQuery['listActiveTransfersTo']>[0],
  ): ReturnType<RecurringDefinitionQuery['listActiveTransfersTo']> {
    return this.deps.uow.run(input.workspaceId, () =>
      this.deps.definitions.listActiveTransfersTo(input.workspaceId, input.accountId),
    );
  }
}
