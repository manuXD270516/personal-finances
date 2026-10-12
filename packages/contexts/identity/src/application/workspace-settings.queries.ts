import { DomainError } from '@pf/shared-kernel';
import type { MoneyDto, WorkspaceSettingsQuery } from '../contracts/index.js';
import type { RlsContext, UnitOfWork, WorkspaceRepository } from './ports/index.js';

/**
 * `WorkspaceSettingsQuery` (openspec add-spendable-amount, S2): ajustes del workspace para otros contextos. Lee con el
 * contexto RLS del llamador (usuario de la petición); no escribe ni audita (lectura).
 */
export class WorkspaceSettingsQueries implements WorkspaceSettingsQuery {
  constructor(
    private readonly deps: {
      readonly uow: Pick<UnitOfWork, 'run'>;
      readonly workspaces: Pick<WorkspaceRepository, 'findById'>;
      /** Contexto RLS de la petición en curso (usuario autenticado o `null` para los procesos del sistema). */
      readonly context: (workspaceId: string) => RlsContext;
    },
  ) {}

  getMinimumLiquidityReserve(input: { readonly workspaceId: string }): Promise<MoneyDto | null> {
    const { workspaceId } = input;
    return this.deps.uow.run(this.deps.context(workspaceId), async () => {
      const ws = await this.deps.workspaces.findById(workspaceId);
      if (!ws) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
      return ws.settings.minimumLiquidityReserve?.toJSON() ?? null;
    });
  }
}
