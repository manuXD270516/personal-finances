import type { AccountCatalogQuery, AccountSummaryDto } from '../contracts/index.js';
import { natureOf, type Account, type AccountStatus } from '../domain/index.js';
import type { AccountsDeps } from './ports/index.js';

const byDisplayOrder = (x: Account, y: Account) =>
  x.snapshot.displayOrder - y.snapshot.displayOrder || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * `AccountCatalogQuery` (openspec add-basic-dashboard, tarea 3.2): catálogo de cuentas para lecturas de otros
 * contextos (Reporting) sin saldo ni bloqueo. Orden: `displayOrder`, luego id (determinista).
 */
export class AccountCatalogQueries implements AccountCatalogQuery {
  constructor(private readonly deps: Pick<AccountsDeps, 'uow' | 'accounts'>) {}

  listAccounts(input: {
    readonly workspaceId: string;
    readonly includeArchived?: boolean;
  }): Promise<readonly AccountSummaryDto[]> {
    const statuses: AccountStatus[] = input.includeArchived
      ? ['ACTIVE', 'CLOSED', 'ARCHIVED']
      : ['ACTIVE', 'CLOSED'];
    return this.deps.uow.run(input.workspaceId, async () =>
      (await this.deps.accounts.list(input.workspaceId, { statuses }))
        .sort(byDisplayOrder)
        .map((a) => ({ s: a.snapshot, status: a.status }))
        .map(({ s, status }) => ({
          accountId: s.id,
          name: s.name,
          type: s.type,
          nature: natureOf(s.type),
          currency: s.currency,
          status,
          liquidity: s.liquidity,
          includeInNetWorth: s.includeInNetWorth,
          displayOrder: s.displayOrder,
        })),
    );
  }
}
