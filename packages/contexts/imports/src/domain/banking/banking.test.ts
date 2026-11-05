import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { RequestBudget, waitFor } from './budget.js';
import { CONNECTION_LIFECYCLE, Connection } from './connection.js';
import { mapExternalRecord, type MappedAccount } from './exchange-mapper.js';
import {
  ProviderRegistry,
  type ProviderDescriptor,
  type ExternalRecord,
  availabilityOf,
} from './provider.js';

const NOW = '2026-10-20T14:00:00.000Z';

const descriptor = (over: Partial<ProviderDescriptor> = {}): ProviderDescriptor => ({
  id: 'EXCHANGE_API_BINANCE',
  kind: 'EXCHANGE_API',
  displayName: 'Binance (API)',
  exchange: 'BINANCE',
  capabilities: ['TRADES', 'DEPOSITS', 'WITHDRAWALS'],
  credentialMode: 'API_KEY_SECRET',
  allowedHosts: ['api.binance.com'],
  termsStatus: 'PENDING',
  termsAdr: null,
  termsVerifiedAt: null,
  formatStatus: 'NOT_APPLICABLE',
  attribution: null,
  ...over,
});

const fake = (): ProviderDescriptor =>
  descriptor({
    id: 'FAKE_EXCHANGE',
    kind: 'FAKE',
    exchange: 'FAKE',
    termsStatus: 'VERIFIED',
    termsAdr: 'n/a',
    termsVerifiedAt: '2026-11-04',
  });

describe('ProviderRegistry', () => {
  it('[TC-IMPORTS-BANKING-002] un proveedor con términos pendientes no se ofrece y se rechaza', () => {
    const registry = ProviderRegistry.create([descriptor(), fake()], {
      environment: 'ci',
      fakeEnabled: true,
    });
    expect(registry.availability('EXCHANGE_API_BINANCE')).toBe('PENDING_VERIFICATION');
    expect(() => registry.requireAvailable('EXCHANGE_API_BINANCE')).toThrowError(
      expect.objectContaining({ code: 'BANKING_PROVIDER_NOT_AVAILABLE' }),
    );
    expect(registry.requireAvailable('FAKE_EXCHANGE').id).toBe('FAKE_EXCHANGE');
  });

  it('[TC-IMPORTS-BANKING-003] el simulado impide arrancar en staging y producción', () => {
    for (const environment of ['staging', 'production'] as const) {
      expect(() => ProviderRegistry.create([fake()], { environment, fakeEnabled: true })).toThrow(
        /not allowed in staging or production/,
      );
    }
    const off = ProviderRegistry.create([fake()], { environment: 'production', fakeEnabled: false });
    expect(off.catalog()).toHaveLength(0);
  });

  it('[TC-IMPORTS-BANKING-010] un descriptor con usuario y contraseña no se registra', () => {
    const bad = descriptor({ credentialMode: 'USERNAME_PASSWORD' as never });
    expect(() => ProviderRegistry.create([bad], { environment: 'ci', fakeEnabled: false })).toThrow(
      /credential mode USERNAME_PASSWORD is not allowed/,
    );
  });

  it('términos verificados exigen ADR y fecha; un archivo sin muestra queda pendiente', () => {
    expect(() =>
      ProviderRegistry.create([descriptor({ termsStatus: 'VERIFIED' })], {
        environment: 'ci',
        fakeEnabled: false,
      }),
    ).toThrow(/need an ADR/);
    const file = descriptor({
      id: 'EXCHANGE_FILE_BINANCE',
      kind: 'EXCHANGE_FILE',
      credentialMode: 'NONE',
      termsStatus: 'VERIFIED',
      termsAdr: 'ADR-0031',
      termsVerifiedAt: '2026-11-04',
      formatStatus: 'PENDING_SAMPLE',
    });
    expect(availabilityOf(file, { environment: 'ci', fakeEnabled: false })).toBe('PENDING_VERIFICATION');
    expect(
      availabilityOf({ ...file, formatStatus: 'VERIFIED' }, { environment: 'ci', fakeEnabled: false }),
    ).toBe('AVAILABLE');
  });
});

describe('Connection', () => {
  const create = () =>
    Connection.create({
      id: 'c1',
      workspaceId: 'w1',
      providerId: 'FAKE_EXCHANGE',
      name: 'Exchange principal',
      assetMappings: [
        { asset: 'USDT', accountId: 'a-usdt' },
        { asset: 'BTC', accountId: 'a-btc' },
      ],
      createdBy: 'u1',
      now: NOW,
      initial: 'PENDING_VERIFICATION',
    });

  it('[TC-IMPORTS-BANKING-004] nace pendiente de verificación con sus dos mapeos y pasa a activa', () => {
    const c = create();
    expect(c.state.status).toBe('PENDING_VERIFICATION');
    expect(c.state.assetMappings).toHaveLength(2);
    c.verified(NOW);
    expect(c.state.status).toBe('ACTIVE');
    expect(c.lastTransition).toEqual({ transition: 'VERIFY_OK', from: 'PENDING_VERIFICATION', to: 'ACTIVE' });
  });

  it('un activo repetido o un nombre vacío se rechazan', () => {
    expect(() =>
      Connection.create({
        id: 'c',
        workspaceId: 'w',
        providerId: 'p',
        name: '  ',
        assetMappings: [],
        createdBy: 'u',
        now: NOW,
        initial: 'ACTIVE',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    const c = create();
    expect(() =>
      c.remap(
        [
          { asset: 'BTC', accountId: 'a' },
          { asset: 'BTC', accountId: 'b' },
        ],
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('[TC-IMPORTS-BANKING-013] revocada no sincroniza: INVALID_STATUS_TRANSITION', () => {
    const c = create();
    c.verified(NOW);
    c.revoke(NOW);
    expect(c.state.status).toBe('REVOKED');
    expect(c.state.revokedAt).toBe(NOW);
    expect(() => c.assertCanSync()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
    expect(() => c.revoke(NOW)).toThrowError(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
    expect(() => c.verified(NOW)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
  });

  it('[TC-IMPORTS-BANKING-018] el cursor confirmado solo avanza al completar su import', () => {
    const c = create();
    c.verified(NOW);
    c.beginSync({ jobId: 'j1', from: '2026-07-01', to: '2026-10-20' }, NOW);
    c.pageStaged('p2', NOW);
    expect(c.state.syncCursor).toBeNull();
    expect(c.state.pendingSync).toMatchObject({ pageCursor: 'p2', pagesDone: 1 });
    // Cancelar: el cursor queda como estaba.
    expect(c.abandonSync('j1', NOW)).toBe(true);
    expect(c.state.syncCursor).toBeNull();
    // Otra sincronización completada de otro job no confirma.
    c.beginSync({ jobId: 'j2', from: '2026-07-01', to: '2026-10-20' }, NOW);
    expect(c.confirmCursor('otro', NOW)).toBe(false);
    expect(c.confirmCursor('j2', '2026-10-20T15:00:00.000Z')).toBe(true);
    expect(c.state.syncCursor).toBe('2026-10-20');
    expect(c.state.pendingSync).toBeNull();
  });

  it('la máquina declara las transiciones y REVOKED es terminal', () => {
    expect(CONNECTION_LIFECYCLE.isTerminal('REVOKED')).toBe(true);
    expect(CONNECTION_LIFECYCLE.allows('REPLACE_CREDENTIAL', 'NEEDS_ATTENTION', 'PENDING_VERIFICATION')).toBe(
      true,
    );
  });
});

describe('ExchangeRecordMapper', () => {
  const accounts: Record<string, MappedAccount> = {
    USDT: { accountId: 'a-usdt', currency: 'USDT', scale: 6 },
    BTC: { accountId: 'a-btc', currency: 'BTC', scale: 8 },
  };
  const ctx = {
    providerId: 'FAKE_EXCHANGE',
    exchange: 'BINANCE',
    timeZone: 'America/La_Paz',
    resolve: (asset: string) => accounts[asset] ?? null,
  };

  const trade: ExternalRecord = {
    type: 'TRADE',
    externalId: 'T-1001',
    executedAt: '2026-09-10T15:30:00.000Z',
    legs: [
      { asset: 'USDT', amount: '975.000000', direction: 'OUT' },
      { asset: 'BTC', amount: '0.01500000', direction: 'IN' },
    ],
    fees: [{ asset: 'BTC', amount: '0.00001500', kind: 'PROVIDER' }],
    quotedPrice: { base: 'BTC', quote: 'USDT', price: '65000.00' },
    description: null,
    raw: {},
  };

  it('[TC-IMPORTS-BANKING-023] compra de BTC: 975.000000 USDT ⇒ 0.01498500 BTC netos, comisión PROVIDER', () => {
    const [row, ...rest] = mapExternalRecord(trade, ctx);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      externalId: 'TRADE:T-1001',
      signedAmount: '-975.000000',
      currency: 'USDT',
      bookingDate: '2026-09-10',
      bookingTime: '11:30:00',
    });
    expect(row?.external).toMatchObject({
      kind: 'CONVERSION',
      accountId: 'a-usdt',
      ref: { namespace: 'imports.provider:BINANCE:TRADE', id: 'T-1001' },
      conversion: {
        counterAccountId: 'a-btc',
        counterAmount: { amount: '0.01498500', currency: 'BTC' },
        fee: { amount: '0.00001500', currency: 'BTC' },
        quotedRate: { base: 'BTC', quote: 'USDT', value: '65000.00' },
      },
    });
    expect(row?.issues).toEqual([]);
  });

  it('[TC-IMPORTS-BANKING-005] un trade con un activo sin mapear queda no importable', () => {
    const [row] = mapExternalRecord(trade, {
      ...ctx,
      resolve: (a) => (a === 'USDT' ? accounts['USDT']! : null),
    });
    expect(row?.issues).toEqual([{ code: 'CONNECTION_ASSET_UNMAPPED', severity: 'ERROR' }]);
    const [dep] = mapExternalRecord(
      {
        type: 'DEPOSIT',
        externalId: 'D-9',
        executedAt: '2026-09-11T12:00:00.000Z',
        legs: [{ asset: 'TRX', amount: '12.500000', direction: 'IN' }],
        fees: [],
        description: null,
        raw: {},
      },
      ctx,
    );
    expect(dep?.issues).toEqual([{ code: 'CONNECTION_ASSET_UNMAPPED', severity: 'ERROR' }]);
    expect(dep?.external.accountId).toBeNull();
  });

  it('[TC-IMPORTS-BANKING-024] retiro de 200.000000 USDT con red de 1.000000: gasto + gasto Fees', () => {
    const rows = mapExternalRecord(
      {
        type: 'WITHDRAWAL',
        externalId: 'W-1',
        executedAt: '2026-09-12T12:00:00.000Z',
        legs: [{ asset: 'USDT', amount: '200.000000', direction: 'OUT' }],
        fees: [{ asset: 'USDT', amount: '1.000000', kind: 'NETWORK' }],
        description: null,
        raw: {},
      },
      ctx,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ externalId: 'WITHDRAWAL:W-1', signedAmount: '-200.000000' });
    expect(rows[0]?.external).toMatchObject({
      kind: 'EXPENSE',
      signal: 'POSSIBLE_TRANSFER',
      categoryHint: null,
    });
    expect(rows[1]).toMatchObject({ externalId: 'FEE:W-1:network', signedAmount: '-1.000000' });
    expect(rows[1]?.external).toMatchObject({ kind: 'EXPENSE', categoryHint: 'FEES', signal: null });
    // El saldo propuesto baja 201.000000 USDT.
    const total = rows.reduce((sum, r) => sum.plus(dec(r.signedAmount ?? '0')), dec('0'));
    expect(total.equals(dec('-201'))).toBe(true);
  });

  it('[TC-IMPORTS-BANKING-025] una orden P2P queda excluida con CONNECTION_RECORD_UNSUPPORTED', () => {
    const [row] = mapExternalRecord(
      {
        type: 'P2P',
        externalId: 'P-1',
        executedAt: '2026-09-13T12:00:00.000Z',
        legs: [{ asset: 'USDT', amount: '100.000000', direction: 'OUT' }],
        fees: [],
        description: null,
        raw: {},
      },
      ctx,
    );
    expect(row?.issues).toEqual([{ code: 'CONNECTION_RECORD_UNSUPPORTED', severity: 'ERROR' }]);
  });

  it('recompensa ⇒ ingreso sin señal; depósito ⇒ ingreso con POSSIBLE_TRANSFER', () => {
    const reward = mapExternalRecord(
      {
        type: 'REWARD',
        externalId: 'R-1',
        executedAt: '2026-09-14T12:00:00.000Z',
        legs: [{ asset: 'USDT', amount: '1.500000', direction: 'IN' }],
        fees: [],
        description: 'Staking',
        raw: {},
      },
      ctx,
    )[0];
    expect(reward?.signedAmount).toBe('1.500000');
    expect(reward?.external).toMatchObject({ kind: 'INCOME', signal: null });
    const deposit = mapExternalRecord(
      {
        ...trade,
        type: 'DEPOSIT',
        externalId: 'D-1',
        legs: [{ asset: 'USDT', amount: '50.000000', direction: 'IN' }],
        fees: [],
      },
      ctx,
    )[0];
    expect(deposit?.external).toMatchObject({ kind: 'INCOME', signal: 'POSSIBLE_TRANSFER' });
  });

  it('un monto con más decimales que la escala de la cuenta es inválido, nunca se redondea (INV-003)', () => {
    const [row] = mapExternalRecord(
      {
        type: 'DEPOSIT',
        externalId: 'D-2',
        executedAt: '2026-09-14T12:00:00.000Z',
        legs: [{ asset: 'USDT', amount: '1.0000001', direction: 'IN' }],
        fees: [],
        description: null,
        raw: {},
      },
      ctx,
    );
    expect(row?.issues).toEqual([{ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' }]);
    expect(row?.signedAmount).toBeNull();
  });

  it('una comisión en el activo entregado forma parte del bruto: sin fila aparte', () => {
    const rows = mapExternalRecord(
      { ...trade, externalId: 'T-2', fees: [{ asset: 'USDT', amount: '0.100000', kind: 'PROVIDER' }] },
      ctx,
    );
    // USDT es el activo entregado: forma parte del bruto, no hay fila aparte.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.external.conversion?.fee).toEqual({ amount: '0.100000', currency: 'USDT' });
    expect(rows[0]?.external.conversion?.counterAmount.amount).toBe('0.01500000');
  });
});

describe('Comisión en un tercer activo', () => {
  it('es un gasto aparte con categoría Fees en la cuenta de ese activo', () => {
    const accounts: Record<string, MappedAccount> = {
      USDT: { accountId: 'a-usdt', currency: 'USDT', scale: 6 },
      BTC: { accountId: 'a-btc', currency: 'BTC', scale: 8 },
      BNB: { accountId: 'a-bnb', currency: 'BNB', scale: 8 },
    };
    const rows = mapExternalRecord(
      {
        type: 'TRADE',
        externalId: 'T-3',
        executedAt: '2026-09-10T15:30:00.000Z',
        legs: [
          { asset: 'USDT', amount: '100.000000', direction: 'OUT' },
          { asset: 'BTC', amount: '0.00150000', direction: 'IN' },
        ],
        fees: [{ asset: 'BNB', amount: '0.00100000', kind: 'PROVIDER' }],
        description: null,
        raw: {},
      },
      {
        providerId: 'FAKE_EXCHANGE',
        exchange: 'BINANCE',
        timeZone: 'America/La_Paz',
        resolve: (a) => accounts[a] ?? null,
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.external.conversion?.fee).toBeUndefined();
    expect(rows[1]).toMatchObject({
      externalId: 'FEE:T-3:fee1',
      signedAmount: '-0.00100000',
      currency: 'BNB',
    });
    expect(rows[1]?.external.categoryHint).toBe('FEES');
  });
});

describe('Presupuesto y espera', () => {
  it('[TC-IMPORTS-BANKING-029] 429 con Retry-After: 120 espera 120 s; sin cabecera, 60 s; 403, 30 min', () => {
    expect(waitFor({ status: 429, retryAfter: '120' })).toBe(120_000);
    expect(waitFor({ status: 418, retryAfter: '5' })).toBe(5_000);
    expect(waitFor({ status: 429 })).toBe(60_000);
    expect(waitFor({ status: 403 })).toBe(30 * 60_000);
    expect(waitFor({ status: 200 })).toBeNull();
  });

  it('la ventana deslizante permite 10 por minuto y devuelve la espera restante', () => {
    const budget = new RequestBudget(10);
    for (let i = 0; i < 10; i += 1) expect(budget.take(1_000 + i)).toBe(0);
    expect(budget.take(2_000)).toBe(1_000 + 60_000 - 2_000);
    expect(budget.take(1_000 + 60_000)).toBe(0);
  });
});
