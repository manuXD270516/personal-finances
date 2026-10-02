import { describe, expect, it } from 'vitest';
import { Money } from '@pf/shared-kernel';
import { InMemoryDatabase, InMemoryUnitOfWork } from '@pf/platform/in-memory';
import { Account } from '../src/domain/account.js';
import { OpenAccountService } from '../src/application/open-account.service.js';
import { InMemoryAccountRepository } from '../src/infrastructure/in-memory-account.repository.js';
import type { LedgerPostingPort } from '../src/application/ports/ledger-posting.port.js';

describe('Account (dominio puro)', () => {
  it('normaliza el nombre y exige que no esté vacío', () => {
    expect(Account.open({ id: '1', name: '  Banco ', type: 'asset', openingBalance: Money.zero('EUR') }).name).toBe('Banco');
    expect(() => Account.open({ id: '1', name: ' ', type: 'asset', openingBalance: Money.zero('EUR') })).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_NAME_REQUIRED' }),
    );
  });
});

describe('OpenAccountService (application + UoW en memoria, sin Nest)', () => {
  const setup = (ledger: LedgerPostingPort) => {
    const db = new InMemoryDatabase();
    const uow = new InMemoryUnitOfWork(db);
    let n = 0;
    const svc = new OpenAccountService(uow, new InMemoryAccountRepository(uow), ledger, { next: () => `id-${++n}` });
    return { db, uow, svc };
  };

  it('cuenta y asiento comparten la transacción: un solo commit', async () => {
    const { db, uow, svc } = setup({
      async postOpeningBalance() {
        uow.table('ledger.journal_entry').set('je', {}); // escribe dentro de la tx del llamador
        return 'je';
      },
    });
    const dto = await svc.openAccount({ name: 'Banco', type: 'asset', currency: 'EUR', openingBalanceMinor: '500' });
    expect(dto.openingJournalEntryId).toBe('je');
    expect(db.commits).toBe(1);
    expect(db.committed.get('accounts.account')?.size).toBe(1);
    expect(db.committed.get('ledger.journal_entry')?.size).toBe(1);
  });

  it('si el puerto de Ledger falla, se hace rollback de todo', async () => {
    const { db, uow, svc } = setup({
      async postOpeningBalance() {
        uow.table('ledger.journal_entry').set('je', {});
        throw new Error('ledger caído');
      },
    });
    await expect(
      svc.openAccount({ name: 'Banco', type: 'asset', currency: 'EUR', openingBalanceMinor: '500' }),
    ).rejects.toThrow('ledger caído');
    expect(db.commits).toBe(0);
    expect(db.rollbacks).toBe(1);
    expect(db.committed.get('accounts.account')).toBeUndefined();
    expect(db.committed.get('ledger.journal_entry')).toBeUndefined();
  });
});
