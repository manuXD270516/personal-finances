import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountProvisioningAdapter } from './account-provisioning.adapter.js';
import { AccountsService } from './accounts.service.js';
import { InMemoryAccounts } from './testing/in-memory.js';

const W1 = 'w1';
const U1 = 'u1';
let mem: InMemoryAccounts;
let svc: AccountsService;
let port: AccountProvisioningAdapter;

beforeEach(() => {
  mem = new InMemoryAccounts();
  svc = new AccountsService(mem.deps());
  port = new AccountProvisioningAdapter(svc);
});

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

describe('AccountProvisioningPort (add-loans, decisión 7)', () => {
  it('[TC-DEBT-LOAN-004] la cuenta del préstamo se crea en el acto: tipo LOAN, pasivo, saldo 0.00 BOB', async () => {
    const { accountId } = await port.openAccount({
      workspaceId: W1,
      userId: U1,
      type: 'LOAN',
      name: 'Préstamo vehicular',
      currency: 'BOB',
    });

    const view = await svc.getAccount(W1, accountId);
    expect(view.account).toMatchObject({ name: 'Préstamo vehicular', type: 'LOAN', currency: 'BOB' });
    expect(view.nature).toBe('LIABILITY');
    expect(view.balance).toEqual({ amount: '0.00', currency: 'BOB' });
    expect(mem.openingEntries).toEqual([]);
    expect(mem.events.map((e) => e.eventType)).toEqual(['accounts.AccountOpened']);
    expect(mem.audits.map((a) => a.action)).toEqual(['accounts.account.opened']);
  });

  it('[TC-DEBT-LOAN-010] préstamo en curso: asiento de apertura 2026-10-15 por 30000.00 BOB adeudados', async () => {
    const { accountId } = await port.openAccount({
      workspaceId: W1,
      userId: U1,
      type: 'LOAN',
      name: 'Préstamo personal',
      currency: 'BOB',
      openingBalance: { amount: '30000.00', currency: 'BOB' },
      openingDate: '2026-10-15',
    });

    expect(mem.openingEntries).toEqual([
      {
        workspaceId: W1,
        accountId,
        amount: { amount: '30000.00', currency: 'BOB' },
        nature: 'LIABILITY',
        date: '2026-10-15',
      },
    ]);
    expect(mem.ledger.get(accountId)?.amount).toBe('-30000.00');
    expect((await svc.getAccount(W1, accountId)).balance).toEqual({ amount: '30000.00', currency: 'BOB' });
  });

  it('[TC-DEBT-LOAN-004] nombre duplicado y moneda no habilitada se propagan sin traducir y no dejan rastro', async () => {
    const base = { workspaceId: W1, userId: U1, type: 'LOAN' as const, currency: 'BOB' };
    await port.openAccount({ ...base, name: 'Préstamo vehicular' });
    const before = mem.events.length;

    expect(await code(port.openAccount({ ...base, name: 'préstamo vehicular' }))).toBe('ACCOUNT_NAME_TAKEN');
    expect(await code(port.openAccount({ ...base, name: 'Otro', currency: 'EUR' }))).toBe(
      'CURRENCY_NOT_ENABLED',
    );
    expect(mem.events.length).toBe(before);
    expect(mem.accounts.size).toBe(1);
  });
});
