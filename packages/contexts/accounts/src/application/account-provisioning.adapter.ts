import { DomainError } from '@pf/shared-kernel';
import type { AccountProvisioningPort } from '../contracts/index.js';
import type { AccountsService } from './accounts.service.js';

/**
 * Adapter de `AccountProvisioningPort` (openspec add-loans, design decisión 7): reutiliza `AccountsService.openAccount`
 * (nombre único, moneda habilitada, naturaleza por tipo, auditoría, recorrido, outbox `AccountOpened` y asiento de
 * apertura) en la unidad de trabajo del llamador: la `PgAccountsUnitOfWork` reutiliza la transacción PG en curso, y el
 * actor de auditoría sale del contexto de la unidad de trabajo, igual que en el resto de puertos de escritura. Los
 * errores de dominio se propagan sin traducir. La idempotencia por `Idempotency-Key` la gestiona el llamador.
 */
export class AccountProvisioningAdapter implements AccountProvisioningPort {
  constructor(private readonly service: Pick<AccountsService, 'openAccount'>) {}

  async openAccount(input: Parameters<AccountProvisioningPort['openAccount']>[0]) {
    if (input.openingBalance && !input.openingDate) {
      throw new DomainError('VALIDATION_FAILED', 'openingDate is required with an opening balance').at(
        '/openingDate',
      );
    }
    const view = await this.service.openAccount({
      workspaceId: input.workspaceId,
      name: input.name,
      type: input.type,
      currency: input.currency,
      institutionId: input.institutionId ?? null,
      ...(input.openingBalance && input.openingDate
        ? { openingBalance: { amount: input.openingBalance, date: input.openingDate } }
        : {}),
    });
    return { accountId: view.account.id };
  }
}
