import type { FxValuationPort, ValuationRateDto } from '@pf/fx/contracts';
import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../domain/index.js';
import { AccountsService } from './accounts.service.js';
import { InstitutionsService } from './institutions.service.js';
import { InMemoryAccounts } from './testing/in-memory.js';

const W1 = 'w1';
let mem: InMemoryAccounts;
let svc: AccountsService;
let inst: InstitutionsService;

beforeEach(() => {
  mem = new InMemoryAccounts();
  const deps = mem.deps();
  svc = new AccountsService(deps);
  inst = new InstitutionsService(deps, deps.audit);
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

const openBank = (name: string, over: Record<string, unknown> = {}) =>
  svc.openAccount({ workspaceId: W1, name, type: 'BANK', currency: 'BOB', ...over });

describe('OpenAccount con saldo inicial', () => {
  it('[TC-ACCOUNTS-OPENING-001] activo, pasivo y cripto: asiento de apertura con el signo contable', async () => {
    const bank = await openBank('Banco BOB', {
      openingBalance: { amount: { amount: '10000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const visa = await svc.openAccount({
      workspaceId: W1,
      name: 'Visa BOB',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      openingBalance: { amount: { amount: '2000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const usdt = await svc.openAccount({
      workspaceId: W1,
      name: 'USDT Wallet',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: { amount: { amount: '100.000000', currency: 'USDT' }, date: '2026-01-01' },
    });
    const empty = await openBank('Bank B', {
      openingBalance: { amount: { amount: '0.00', currency: 'BOB' }, date: '2026-01-01' },
    });

    expect(bank.balance).toEqual({ amount: '10000.00', currency: 'BOB' });
    expect(mem.ledger.get(bank.account.id)?.amount).toBe('10000.00');
    expect(visa.nature).toBe('LIABILITY');
    expect(mem.ledger.get(visa.account.id)?.amount).toBe('-2000.00');
    expect(visa.balance).toEqual({ amount: '2000.00', currency: 'BOB' });
    expect(usdt.balance).toEqual({ amount: '100.000000', currency: 'USDT' });
    expect(mem.ledger.has(empty.account.id)).toBe(false);
    expect(empty.balance).toEqual({ amount: '0.00', currency: 'BOB' });
    expect(mem.openingEntries).toHaveLength(3);
    expect(bank.account.openedOn).toBe('2026-01-01');
    expect(mem.events.filter((e) => e.eventType === 'accounts.AccountOpened')).toHaveLength(4);
    expect(mem.audits.filter((a) => a.action === 'accounts.account.opened')).toHaveLength(4);
  });

  it('[TC-ACCOUNTS-OPENING-002] si el saldo inicial no puede contabilizarse, la cuenta no se crea', async () => {
    expect(
      await code(
        openBank('Bank E', {
          openingBalance: { amount: { amount: '10.005', currency: 'BOB' }, date: '2026-01-01' },
        }),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    mem.failOpening = new DomainError('PERIOD_CLOSED', 'period locked');
    expect(
      await code(
        openBank('Bank E', {
          openingBalance: { amount: { amount: '10.00', currency: 'BOB' }, date: '2026-01-01' },
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(mem.accounts.size).toBe(0);
    expect(mem.events).toHaveLength(0);
    expect(mem.audits).toHaveLength(0);
    mem.failOpening = null;
    expect((await openBank('Bank E')).account.name).toBe('Bank E');
  });

  it('[TC-ACCOUNTS-CRYPTO-001] cripto: clase de moneda y escala del saldo inicial', async () => {
    expect(
      await code(
        svc.openAccount({ workspaceId: W1, name: 'Wallet BOB', type: 'CRYPTO_WALLET', currency: 'BOB' }),
      ),
    ).toBe('ACCOUNT_CURRENCY_KIND_MISMATCH');
    expect(
      await code(
        svc.openAccount({
          workspaceId: W1,
          name: 'USDT Wallet 2',
          type: 'CRYPTO_WALLET',
          currency: 'USDT',
          openingBalance: { amount: { amount: '1.0000001', currency: 'USDT' }, date: '2026-01-01' },
        }),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    const btc = await svc.openAccount({
      workspaceId: W1,
      name: 'BTC Cold',
      type: 'CRYPTO_WALLET',
      currency: 'BTC',
      cryptoNetwork: 'BTC',
      openingBalance: { amount: { amount: '0.0125', currency: 'BTC' }, date: '2026-01-01' },
    });
    expect(btc.balance).toEqual({ amount: '0.01250000', currency: 'BTC' });
    expect(mem.accounts.size).toBe(1);
  });

  it('[TC-ACCOUNTS-CURRENCY-001] EUR activa en el catálogo pero no habilitada en el workspace ⇒ CURRENCY_NOT_ENABLED (D45)', async () => {
    const euroCash = { workspaceId: W1, name: 'Euro Cash', type: 'CASH', currency: 'EUR' } as const;
    expect(await code(svc.openAccount(euroCash))).toBe('CURRENCY_NOT_ENABLED');
    // Inactiva en el catálogo global: mismo código.
    expect(await code(svc.openAccount({ ...euroCash, currency: 'XAU' }))).toBe('CURRENCY_NOT_ENABLED');
    expect([mem.accounts.size, mem.events.length, mem.audits.length]).toEqual([0, 0, 0]);
    // Cambiar la moneda de una cuenta sin movimientos a una no habilitada: mismo rechazo.
    const usd = await svc.openAccount({ ...euroCash, name: 'USD Cash', currency: 'USD' });
    expect(await code(svc.updateAccount(W1, usd.account.id, usd.account.version, { currency: 'EUR' }))).toBe(
      'CURRENCY_NOT_ENABLED',
    );
    // Habilitada en el workspace ⇒ se acepta.
    mem.enabledCurrencies.add('EUR');
    expect((await svc.openAccount(euroCash)).account.currency).toBe('EUR');
  });
});

describe('Comandos de cuenta', () => {
  it('[TC-ACCOUNTS-NAME-001] nombre único entre cuentas no archivadas del workspace', async () => {
    await openBank('Bank A');
    const old = await openBank('Old Bank');
    await svc.archiveAccount(W1, old.account.id, 1, null);
    expect(await code(openBank('bank a'))).toBe('ACCOUNT_NAME_TAKEN');
    expect((await openBank('Old Bank')).status).toBe('ACTIVE');
    await svc.openAccount({ workspaceId: 'w2', name: 'W2 Bank', type: 'BANK', currency: 'BOB' });
    expect((await openBank('W2 Bank')).account.name).toBe('W2 Bank');
  });

  it('[TC-ACCOUNTS-INSTLINK-001] la institución debe existir en el workspace y no estar archivada', async () => {
    const andino = await inst.createInstitution({ workspaceId: W1, name: 'Banco Andino Demo', kind: 'BANK' });
    const other = await inst.createInstitution({ workspaceId: 'w2', name: 'Banco W2', kind: 'BANK' });
    expect((await openBank('Bank C', { institutionId: andino.id })).account.institutionId).toBe(andino.id);
    expect(await code(openBank('Bank G', { institutionId: other.id }))).toBe('REFERENCE_NOT_FOUND');
    expect(
      (await svc.openAccount({ workspaceId: W1, name: 'Cash', type: 'CASH', currency: 'BOB' })).account
        .institutionId,
    ).toBeNull();
    await inst.archiveInstitution(W1, andino.id, 1);
    expect(await code(openBank('Bank H', { institutionId: andino.id }))).toBe('INSTITUTION_ARCHIVED');
  });

  it('[TC-ACCOUNTS-METADATA-001] editar metadatos no toca el saldo, audita y emite AccountUpdated', async () => {
    const a = await openBank('Bank A', {
      openingBalance: { amount: { amount: '925.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const updated = await svc.updateAccount(W1, a.account.id, 1, {
      name: 'Banco principal',
      color: '#0055AA',
      notes: 'nota',
    });
    expect(updated.account.version).toBe(2);
    expect(updated.balance.amount).toBe('925.00');
    const ev = mem.events.at(-1);
    expect(ev?.eventType).toBe('accounts.AccountUpdated');
    expect(ev?.payload).toEqual({
      accountId: a.account.id,
      changedFields: ['name', 'color', 'notes'],
      name: 'Banco principal',
    });
    const audit = mem.audits.at(-1);
    expect(audit?.changes).toContainEqual({ field: 'name', before: 'Bank A', after: 'Banco principal' });
    expect(await code(svc.updateAccount(W1, a.account.id, 1, { name: 'Otro' }))).toBe('PRECONDITION_FAILED');
    expect(mem.openingEntries).toHaveLength(1);
  });

  it('[TC-PLATFORM-API-014] carrera perdida al guardar ⇒ 412 con la versión ganadora (relee la fila)', async () => {
    const a = await openBank('Bank A');
    const deps = mem.deps();
    const racy = new AccountsService({
      ...deps,
      accounts: {
        ...deps.accounts,
        // Otro escritor confirma entre la carga (versión 1 vigente) y el UPDATE condicional.
        update: async (account) => {
          const cur = mem.accounts.get(account.id)!;
          mem.accounts.set(account.id, Account.restore({ ...cur.snapshot, version: cur.version + 1 }));
          return deps.accounts.update(account);
        },
      },
    });
    const err = await racy.updateAccount(W1, a.account.id, 1, { name: 'Otro' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect([(err as DomainError).code, (err as DomainError).details]).toEqual([
      'PRECONDITION_FAILED',
      { currentVersion: 2 },
    ]);
  });

  it('[TC-ACCOUNTS-CURRENCY-002] cambio de moneda solo sin movimientos, auditado', async () => {
    const c = await openBank('Bank C', {
      openingBalance: { amount: { amount: '200.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const d = await openBank('Bank D');
    expect(await code(svc.updateAccount(W1, c.account.id, 1, { currency: 'USD' }))).toBe(
      'ACCOUNT_CURRENCY_IMMUTABLE',
    );
    const moved = await svc.updateAccount(W1, d.account.id, 1, { currency: 'USD' });
    expect(moved.account.currency).toBe('USD');
    expect(moved.balance).toEqual({ amount: '0.00', currency: 'USD' });
    expect(mem.audits.at(-1)?.changes).toEqual([{ field: 'currency', before: 'BOB', after: 'USD' }]);
  });

  it('[TC-ACCOUNTS-CLOSE-001] cerrar con saldo cero emite AccountClosed; con saldo se rechaza', async () => {
    const b = await openBank('Bank B');
    const closed = await svc.closeAccount(W1, b.account.id, 1, { closedOn: '2026-03-31' });
    expect(closed.status).toBe('CLOSED');
    expect(mem.events.at(-1)).toMatchObject({
      eventType: 'accounts.AccountClosed',
      payload: { accountId: b.account.id, closedOn: '2026-03-31', reason: null },
    });
    expect(mem.audits.at(-1)?.action).toBe('accounts.account.closed');
    const usdt = await svc.openAccount({
      workspaceId: W1,
      name: 'USDT Wallet',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: { amount: { amount: '0.000001', currency: 'USDT' }, date: '2026-01-01' },
    });
    expect(await code(svc.closeAccount(W1, usdt.account.id, 1, { closedOn: '2026-03-31' }))).toBe(
      'ACCOUNT_BALANCE_NOT_ZERO',
    );
    expect((await svc.getAccount(W1, usdt.account.id)).status).toBe('ACTIVE');
  });

  it('[TC-ACCOUNTS-ARCHIVE-003] reactivar audita y emite AccountReactivated; un nombre ocupado lo impide', async () => {
    const old = await openBank('Old Bank');
    await svc.archiveAccount(W1, old.account.id, 1, 'Cuenta cerrada en el banco');
    const back = await svc.reactivateAccount(W1, old.account.id, 2);
    expect(back.status).toBe('ACTIVE');
    expect(mem.events.at(-1)).toMatchObject({
      eventType: 'accounts.AccountReactivated',
      payload: { previousStatus: 'ARCHIVED', reactivatedOn: '2026-03-15' },
    });
    const card = await openBank('Old Card');
    await svc.archiveAccount(W1, card.account.id, 1, null);
    await openBank('Old Card');
    expect(await code(svc.reactivateAccount(W1, card.account.id, 2))).toBe('ACCOUNT_NAME_TAKEN');
    expect((await svc.getAccount(W1, card.account.id)).status).toBe('ARCHIVED');
  });

  it('[TC-ACCOUNTS-ARCHIVE-002] con un poster de prueba: cuenta archivada o cerrada rechaza movimientos', async () => {
    const old = await openBank('Old Bank', {
      openingBalance: { amount: { amount: '300.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const b = await openBank('Bank B');
    await svc.archiveAccount(W1, old.account.id, 1, null);
    await svc.closeAccount(W1, b.account.id, 1, { closedOn: '2026-03-31' });
    // Poster de prueba (hasta add-transaction-recording): consulta la elegibilidad antes de "postear".
    const post = async (accountId: string, currency = 'BOB') => {
      await svc.assertCanPost(W1, [{ accountId, currency }]);
      mem.ledger.set(accountId, { amount: '-1.00', currency, nature: 'ASSET' });
    };
    const events = mem.events.length;
    expect(await code(post(old.account.id))).toBe('ACCOUNT_ARCHIVED');
    expect(await code(post(b.account.id))).toBe('ACCOUNT_CLOSED');
    const active = await openBank('Bank X');
    expect(await code(post(active.account.id, 'USD'))).toBe('CURRENCY_MISMATCH');
    expect(mem.events.length).toBe(events + 1);
    expect((await svc.getAccount(W1, old.account.id)).balance.amount).toBe('300.00');
    expect(await svc.getPostingEligibility(W1, [old.account.id, 'missing'])).toEqual([
      { accountId: old.account.id, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' },
    ]);
  });

  it('reordenar: listadas primero, el resto conserva su orden; ids ajenos ⇒ REFERENCE_NOT_FOUND', async () => {
    const a = await openBank('A');
    const b = await openBank('B');
    const c = await openBank('C');
    await svc.reorderAccounts(W1, [c.account.id]);
    const list = await svc.listAccounts({ workspaceId: W1 });
    expect(list.data.map((v) => v.account.name)).toEqual(['C', 'A', 'B']);
    expect(await code(svc.reorderAccounts(W1, ['nope']))).toBe('REFERENCE_NOT_FOUND');
    expect(a.account.id).not.toBe(b.account.id);
  });
});

describe('Queries', () => {
  it('[TC-ACCOUNTS-LIST-002] filtros, archivadas ocultas por defecto y agrupación por institución', async () => {
    const andino = await inst.createInstitution({ workspaceId: W1, name: 'Banco Andino Demo', kind: 'BANK' });
    await openBank('Bank A', { institutionId: andino.id });
    await svc.openAccount({ workspaceId: W1, name: 'Cash', type: 'CASH', currency: 'BOB' });
    await svc.openAccount({ workspaceId: W1, name: 'USD Savings', type: 'SAVINGS', currency: 'USD' });
    const card = await svc.openAccount({
      workspaceId: W1,
      name: 'Card',
      type: 'CREDIT_CARD',
      currency: 'BOB',
    });
    await svc.archiveAccount(W1, card.account.id, 1, null);

    const names = async (q: Parameters<AccountsService['listAccounts']>[0]) =>
      (await svc.listAccounts(q)).data.map((v) => v.account.name);
    expect(await names({ workspaceId: W1 })).toEqual(['Bank A', 'Cash', 'USD Savings']);
    expect(await names({ workspaceId: W1, includeArchived: true })).toContain('Card');
    expect(await names({ workspaceId: W1, statuses: ['ARCHIVED'] })).toEqual(['Card']);
    expect(await names({ workspaceId: W1, currencies: ['USD'] })).toEqual(['USD Savings']);
    expect(await names({ workspaceId: W1, types: ['CASH'] })).toEqual(['Cash']);
    expect(await names({ workspaceId: W1, liquidities: ['LIQUID'], sort: '-name' })).toEqual([
      'USD Savings',
      'Cash',
      'Bank A',
    ]);
    const grouped = await svc.listAccounts({ workspaceId: W1, groupBy: 'institution' });
    expect(grouped.groups).toEqual([
      { key: andino.id, label: 'Banco Andino Demo', accountIds: [grouped.data[0]?.account.id] },
      { key: null, label: null, accountIds: [grouped.data[1]?.account.id, grouped.data[2]?.account.id] },
    ]);
  });
});

describe('Equivalente en moneda base', () => {
  it('[TC-ACCOUNTS-LIST-001] USD con tasa manual 6.96 ⇒ 3480.00 BOB; BTC sin tasa y BOB ⇒ null; tasas resueltas en UN lote a "ahora"', async () => {
    const calls: Parameters<FxValuationPort['resolveValuationRates']>[0][] = [];
    const usdBob: ValuationRateDto = {
      exact: { base: 'USD', quote: 'BOB', value: '6.96' },
      resolved: {
        rate: { base: 'USD', quote: 'BOB', value: '6.96' },
        fxRateId: '0190a000-0000-7000-8000-000000000696',
        derivation: 'DIRECT',
        components: [],
        rateType: 'PARALLEL',
        requestedRateType: 'PARALLEL',
        source: 'MANUAL',
        sourceLabel: null,
        asOf: '2026-03-14T16:00:00.000Z',
        ageDays: 0,
        ageSeconds: 79200,
        approx: false,
        provider: null,
        selection: 'MANUAL',
        stale: false,
        attribution: null,
      },
    };
    const rates: FxValuationPort = {
      windowDays: 7,
      enabledCurrencies: async () => [],
      workspaceCurrencies: async () => [],
      resolveValuationRates: async (input) => {
        calls.push(input);
        return input.requests.map((r) => (r.base === 'USD' && r.quote === 'BOB' ? usdBob : null));
      },
    };
    const deps = mem.deps();
    const valued = new AccountsService({
      ...deps,
      valuation: {
        rates,
        workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
      },
    });
    const opening = (amount: string, currency: string) => ({
      openingBalance: { amount: { amount, currency }, date: '2026-03-01' },
    });
    await valued.openAccount({
      workspaceId: W1,
      name: 'USD Savings',
      type: 'SAVINGS',
      currency: 'USD',
      ...opening('500.00', 'USD'),
    });
    await valued.openAccount({
      workspaceId: W1,
      name: 'BTC Wallet',
      type: 'CRYPTO_WALLET',
      currency: 'BTC',
      ...opening('0.01250000', 'BTC'),
    });
    await valued.openAccount({
      workspaceId: W1,
      name: 'Credit Card',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      ...opening('350.00', 'BOB'),
    });
    calls.length = 0;

    const list = await valued.listAccounts({ workspaceId: W1 });
    const byName = new Map(list.data.map((v) => [v.account.name, v]));
    expect(byName.get('USD Savings')?.balance).toEqual({ amount: '500.00', currency: 'USD' });
    expect(byName.get('USD Savings')?.baseCurrencyBalance).toMatchObject({
      amount: { amount: '3480.00', currency: 'BOB' },
      rateDate: '2026-03-14',
      rateSource: 'MANUAL',
      fxRateId: usdBob.resolved.fxRateId,
    });
    expect(byName.get('BTC Wallet')?.balance).toEqual({ amount: '0.01250000', currency: 'BTC' });
    expect(byName.get('BTC Wallet')?.baseCurrencyBalance).toBeNull();
    expect(byName.get('Credit Card')?.balance).toEqual({ amount: '350.00', currency: 'BOB' });
    expect(byName.get('Credit Card')?.baseCurrencyBalance).toBeNull();
    expect(calls).toEqual([
      {
        workspaceId: W1,
        requests: [
          { base: 'BTC', quote: 'BOB', at: '2026-03-15T14:00:00.000Z' },
          { base: 'USD', quote: 'BOB', at: '2026-03-15T14:00:00.000Z' },
        ],
      },
    ]);
  });

  it('sin valoración compuesta el equivalente es null (nunca 1:1)', async () => {
    const usd = await svc.openAccount({ workspaceId: W1, name: 'USD', type: 'SAVINGS', currency: 'USD' });
    expect(usd.baseCurrencyBalance).toBeNull();
  });
});

describe('Instituciones', () => {
  it('[TC-ACCOUNTS-INSTITUTION-003] editar una institución audita el cambio y no toca las cuentas', async () => {
    const i = await inst.createInstitution({
      workspaceId: W1,
      name: 'Banco Andino Demo',
      kind: 'BANK',
      website: 'https://andino.demo.pfos.test',
    });
    const a = await openBank('Bank A', {
      institutionId: i.id,
      openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const updated = await inst.updateInstitution(W1, i.id, 1, {
      website: 'https://new.andino.demo.pfos.test',
    });
    expect(updated.version).toBe(2);
    expect(mem.audits.at(-1)?.changes).toEqual([
      {
        field: 'website',
        before: 'https://andino.demo.pfos.test',
        after: 'https://new.andino.demo.pfos.test',
      },
    ]);
    const after = await svc.getAccount(W1, a.account.id);
    expect(after.account.institutionId).toBe(i.id);
    expect(after.balance.amount).toBe('1000.00');
  });

  it('[TC-ACCOUNTS-INSTITUTION-004] archivar oculta la institución por defecto y la vuelve no asignable', async () => {
    const i = await inst.createInstitution({ workspaceId: W1, name: 'Banco Andino Demo', kind: 'BANK' });
    await inst.archiveInstitution(W1, i.id, 1);
    expect(await inst.listInstitutions({ workspaceId: W1 })).toEqual([]);
    expect(await inst.listInstitutions({ workspaceId: W1, includeArchived: true })).toHaveLength(1);
    expect(
      await code(
        inst.createInstitution({ workspaceId: W1, name: 'X', kind: 'BANK', countryCode: 'Bolivia' }),
      ),
    ).toBe('VALIDATION_FAILED');
    await inst.createInstitution({ workspaceId: W1, name: 'Banco Andino Demo', kind: 'BANK' });
    expect(
      await code(inst.createInstitution({ workspaceId: W1, name: 'banco andino demo', kind: 'BANK' })),
    ).toBe('NAME_TAKEN');
  });
});

describe('Recorrido de una cuenta (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-009] Bank C: abrir con 500.00 BOB, archivar ("sin uso"), reactivar, vaciar y cerrar deja OPEN, ARCHIVE, REACTIVATE y CLOSE', async () => {
    const c = await openBank('Bank C', {
      openingBalance: { amount: { amount: '500.00', currency: 'BOB' }, date: '2026-03-01' },
    });
    const id = c.account.id;
    await svc.archiveAccount(W1, id, 1, 'sin uso');
    await svc.reactivateAccount(W1, id, 2);
    // La transferencia del saldo a "Bank A" no es una transición de la cuenta: solo deja el saldo en 0.00 BOB.
    mem.ledger.set(id, { amount: '0.00', currency: 'BOB', nature: 'ASSET' });
    await svc.updateAccount(W1, id, 3, { notes: 'cuenta antigua' });
    await svc.closeAccount(W1, id, 4, { closedOn: '2026-03-31' });
    const view = await svc.accountLifecycle({ userId: 'u1', workspaceId: W1, accountId: id });
    expect(
      view.items.map((i) =>
        i.kind === 'TRANSITION'
          ? [i.transition, i.fromState, i.toState, i.reason]
          : [i.kind, i.changedFields],
      ),
    ).toEqual([
      ['OPEN', null, 'ACTIVE', null],
      ['ARCHIVE', 'ACTIVE', 'ARCHIVED', 'sin uso'],
      ['REACTIVATE', 'ARCHIVED', 'ACTIVE', null],
      ['ANNOTATION', ['notes']],
      ['CLOSE', 'ACTIVE', 'CLOSED', null],
    ]);
    expect(view.items[0]).toMatchObject({
      journalEntries: { posted: `je-${id}` },
      events: ['accounts.AccountOpened.v1'],
    });
    expect(view.currentState).toBe('CLOSED');
    expect(view.path).toEqual(['ACTIVE', 'ARCHIVED', 'ACTIVE', 'CLOSED']);
    expect(mem.events.find((e) => e.eventType === 'accounts.AccountClosed')?.payload).toMatchObject({
      transition: 'CLOSE',
    });
  });

  it('[TC-AUDIT-LIFECYCLE-006] el recorrido de una cuenta inexistente (u otro workspace) responde RESOURCE_NOT_FOUND', async () => {
    expect(await code(svc.accountLifecycle({ userId: 'u1', workspaceId: W1, accountId: 'nope' }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });
});
