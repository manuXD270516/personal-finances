import { beforeEach, describe, expect, it } from 'vitest';
import { IdentityService } from './identity.service.js';
import { InMemoryIdentity } from './testing/in-memory.js';
import { WorkspaceSettingsQueries } from './workspace-settings.queries.js';

describe('WorkspaceSettingsQuery.getMinimumLiquidityReserve (S2 de add-spendable-amount)', () => {
  let mem: InMemoryIdentity;
  let svc: IdentityService;
  let queries: WorkspaceSettingsQueries;
  let owner: string;
  let ws: string;
  beforeEach(() => {
    mem = new InMemoryIdentity();
    const deps = mem.deps();
    svc = new IdentityService(deps);
    queries = new WorkspaceSettingsQueries({
      uow: deps.uow,
      workspaces: deps.workspaces,
      context: (workspaceId) => ({ userId: owner, workspaceId }),
    });
    const user = mem.addUser('owner@demo.pfos.test');
    owner = user.id;
    ws = mem.addWorkspace('W1', [[user, 'OWNER']]).id;
  });

  it('[TC-REPORTING-SPENDABLE-001] devuelve la reserva mínima con su moneda y escala; sin reserva, null', async () => {
    expect(await queries.getMinimumLiquidityReserve({ workspaceId: ws })).toBeNull();
    await svc.updateWorkspaceSettings(owner, ws, 1, {
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
    });
    expect(await queries.getMinimumLiquidityReserve({ workspaceId: ws })).toEqual({
      amount: '1500.00',
      currency: 'BOB',
    });
    await svc.updateWorkspaceSettings(owner, ws, 2, { minimumLiquidityReserve: null });
    expect(await queries.getMinimumLiquidityReserve({ workspaceId: ws })).toBeNull();
  });

  it('[TC-REPORTING-SPENDABLE-013] un workspace inexistente es RESOURCE_NOT_FOUND', async () => {
    await expect(
      queries.getMinimumLiquidityReserve({ workspaceId: '0190a000-0000-7000-8000-00000000ffff' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
