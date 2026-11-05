import { describe, expect, it } from 'vitest';
import type { ProviderCallContext } from '../../application/banking/ports.js';
import { FAKE_HOST, FakeExchangeBackend, FakeExchangeProvider, sampleRecords } from './fake-exchange.js';
import { AllowlistedProviderHttp } from './provider-http.js';
import { providerContractSuite } from './provider-contract-suite.test-support.js';

/** TC-IMPORTS-BANKING-001: el proveedor simulado pasa la suite de contrato común. */

const WINDOW = { from: '2026-09-01', to: '2026-09-30' };
// 5 registros sintéticos: 2 trades, 1 depósito, 1 retiro y 1 recompensa.
const BASE = sampleRecords().filter((r) => r.type !== 'P2P');
const SEPTEMBER = [BASE[1]!, { ...BASE[1]!, externalId: 'T-1002' }, BASE[0]!, BASE[2]!, BASE[3]!].map(
  (r, i) => ({
    ...r,
    executedAt: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`,
  }),
);

describe('[TC-IMPORTS-BANKING-001] FAKE_EXCHANGE y la suite de contrato común', () => {
  const backend = new FakeExchangeBackend([
    ...SEPTEMBER,
    // Fuera de la ventana: no debe aparecer.
    { ...SEPTEMBER[0]!, externalId: 'FUERA', executedAt: '2026-10-15T12:00:00.000Z' },
  ]);
  backend.pageSize = 2;
  const context = (): ProviderCallContext => ({
    credential: { keyId: 'AKIA-TEST-0000-a1b2', secret: 'secreto-de-prueba' },
    http: new AllowlistedProviderHttp(backend.transport),
    nowMs: () => Date.parse('2026-10-20T14:00:00.000Z'),
  });
  providerContractSuite(new FakeExchangeProvider(), {
    expected: SEPTEMBER,
    window: WINDOW,
    context,
    requests: () => backend.requests,
    forbiddenInRequests: ['00000000-0000-7000', 'Exchange USDT', 'Exchange BTC'],
  });

  it('los 5 registros sintéticos (2 trades, depósito, retiro y recompensa) llegan en 3 páginas', async () => {
    const provider = new FakeExchangeProvider();
    const pages: number[] = [];
    for await (const page of provider.fetchRecords(context(), WINDOW, null)) pages.push(page.records.length);
    expect(pages).toEqual([2, 2, 1]);
  });

  it('un monto JSON numérico (no texto) se rechaza como carga inválida (INV-001)', async () => {
    const provider = new FakeExchangeProvider();
    const http = new AllowlistedProviderHttp(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        records: [
          {
            type: 'DEPOSIT',
            id: 'X',
            time: '2026-09-01T00:00:00Z',
            legs: [{ asset: 'USDT', amount: 1.5, dir: 'IN' }],
          },
        ],
        next: null,
      }),
    }));
    const ctx: ProviderCallContext = { ...context(), http };
    await expect(
      provider.fetchRecords(ctx, WINDOW, null)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      code: 'PROVIDER_PAYLOAD_INVALID',
    });
    expect(FAKE_HOST).toBe('fake-exchange.test');
  });
});
