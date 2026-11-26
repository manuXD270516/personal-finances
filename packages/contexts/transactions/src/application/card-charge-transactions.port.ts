import { type CardChargeTransactionsPort } from '../contracts/index.js';
import type { TransactionsService } from './transactions.service.js';

/**
 * Adapter de `CardChargeTransactionsPort` (openspec add-card-interest-ledger-portions, decisiones 4 y 5): reutiliza el
 * servicio de transacciones —validación de cuentas, traductor al ledger (`PERIOD_CLOSED`), auditoría, recorrido y
 * outbox— en la unidad de trabajo del llamador. El cargo nace `source = DEBT` con `debtRole = CARD_CHARGE`, así que
 * queda administrado por la tarjeta: la API de transacciones solo edita sus datos descriptivos y `voidManaged` es el
 * único camino de anulación.
 */
export class CardChargeTransactionsAdapter implements CardChargeTransactionsPort {
  constructor(
    private readonly service: Pick<
      TransactionsService,
      'recordCardCharge' | 'adoptCardCharge' | 'voidManagedTransaction'
    >,
  ) {}

  async recordCharge(input: Parameters<CardChargeTransactionsPort['recordCharge']>[0]) {
    const state = await this.service.recordCardCharge({
      workspaceId: input.workspaceId,
      chargeId: input.chargeId,
      cardId: input.cardId,
      accountId: input.accountId,
      businessDate: input.businessDate,
      currency: input.currency,
      amounts: input.amounts,
      description: input.description,
    });
    return { transactionId: state.id, businessDate: state.businessDate };
  }

  async adoptCharge(input: Parameters<CardChargeTransactionsPort['adoptCharge']>[0]) {
    const state = await this.service.adoptCardCharge({
      workspaceId: input.workspaceId,
      cardId: input.cardId,
      cardAccountIds: input.cardAccountIds,
      transactionId: input.transactionId,
      amounts: input.amounts,
    });
    return {
      transactionId: state.id,
      accountId: state.accountId,
      businessDate: state.businessDate,
      currency: state.amount.currency.code,
    };
  }

  async voidCharge(input: Parameters<CardChargeTransactionsPort['voidCharge']>[0]) {
    await this.service.voidManagedTransaction(input.workspaceId, input.transactionId, input.reason);
  }
}
