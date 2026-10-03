import { beforeEach, describe, expect, it } from 'vitest';
import { AccountCatalogQueries } from './account-catalog.queries.js';
import { AccountsService } from './accounts.service.js';
import { InMemoryAccounts } from './testing/in-memory.js';

const W1 = 'w1';
let mem: InMemoryAccounts;
let svc: AccountsService;

beforeEach(() => {
  mem = new InMemoryAccounts();
  svc = new AccountsService(mem.deps());
});

describe('AccountCatalogQuery (contrato público para Reporting, add-basic-dashboard)', () => {
  it('lista cuentas no archivadas en orden de visualización con naturaleza, liquidez e inclusión en patrimonio', async () => {
    const bank = await svc.openAccount({ workspaceId: W1, name: 'Banco BOB', type: 'BANK', currency: 'BOB' });
    const visa = await svc.openAccount({
      workspaceId: W1,
      name: 'Visa',
      type: 'CREDIT_CARD',
      currency: 'BOB',
    });
    const office = await svc.openAccount({
      workspaceId: W1,
      name: 'Caja oficina',
      type: 'CASH',
      currency: 'BOB',
      includeInNetWorth: false,
    });
    await svc.archiveAccount(W1, office.account.id, office.account.version, 'ya no se usa');
    const catalog = new AccountCatalogQueries(mem.deps());
    const listed = await catalog.listAccounts({ workspaceId: W1 });
    expect(listed.map((a) => [a.name, a.type, a.nature, a.liquidity, a.includeInNetWorth, a.status])).toEqual(
      [
        ['Banco BOB', 'BANK', 'ASSET', 'LIQUID', true, 'ACTIVE'],
        ['Visa', 'CREDIT_CARD', 'LIABILITY', 'ILLIQUID', true, 'ACTIVE'],
      ],
    );
    expect(listed.map((a) => a.accountId)).toEqual([bank.account.id, visa.account.id]);
    const all = await catalog.listAccounts({ workspaceId: W1, includeArchived: true });
    expect(all.find((a) => a.name === 'Caja oficina')).toMatchObject({
      status: 'ARCHIVED',
      includeInNetWorth: false,
    });
  });
});
