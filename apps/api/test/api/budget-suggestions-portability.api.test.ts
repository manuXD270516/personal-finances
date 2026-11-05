import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  startHarness,
  w1Api,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Portabilidad de la base histórica de las líneas del plan (openspec add-historical-budgets, tarea 4.2,
// TC-PLANNING-HISTBUDGET-030): una línea aplicada desde el historial viaja en el export y, tras la importación, muestra
// la misma explicación con los periodos del workspace nuevo.
let h: Harness;

beforeAll(async () => {
  h = await startHarness({ worker: true });
}, 300_000);

afterAll(async () => {
  await h?.close();
});

const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};

describe('Portabilidad de la base histórica de los presupuestos', () => {
  it('[TC-PLANNING-HISTBUDGET-030] ida y vuelta: la línea conserva 1480.00 BOB y la misma base, con los ids de periodo del workspace nuevo', async () => {
    const owner0: User = await h.user(`kc-hb-port-${randomUUID()}`);
    const created = ok(
      await h.call('POST', '/api/v1/workspaces', {
        token: owner0.token,
        body: { name: 'Historial', baseCurrency: 'BOB', timezone: 'America/La_Paz', locale: 'es-BO' },
        headers: { 'idempotency-key': randomUUID() },
      }),
      201,
    );
    const owner: User = { ...owner0, ws: created['id'] as string };
    const api = w1Api(h, owner);
    const categories = ok(await api.get(owner, '/categories?kind=EXPENSE&limit=200'))['data'] as {
      id: string;
      name: string;
    }[];
    const sup = categories.find((c) => c.name === 'Supermercado')!.id;
    const bank = ok(
      await api.post(owner, '/accounts', {
        name: 'Banco historial',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('100000.00'), date: '2026-01-01' },
      }),
      201,
    )['id'] as string;
    const values = ['1420.00', '1515.50', '1380.00', '3950.00', '1610.00', '1474.50'];
    for (const [i, value] of values.entries()) {
      ok(
        await api.post(owner, '/transactions', {
          kind: 'EXPENSE',
          transactionDate: `2026-${String(i + 5).padStart(2, '0')}-15`,
          accountId: bank,
          amount: money(value),
          splits: [{ amount: money(value), categoryId: sup }],
        }),
        201,
      );
    }
    ok(await api.post(owner, '/periods', { through: '2026-12-31' }));
    const periods = (
      ok(await api.get(owner, '/periods?limit=100'))['data'] as { id: string; label: string }[]
    ).map((p) => [p.label, p.id] as const);
    const nov = periods.find(([label]) => label === '2026-11')![1];
    const plan = ok(await api.post(owner, '/budgets', { periodId: nov }), 201);
    ok(
      await api.post(owner, `/budgets/${String(plan['id'])}/lines`, {
        target: { kind: 'CATEGORY', id: sup },
        kind: 'MAXIMUM',
        planned: money('1500.00'),
      }),
      201,
    );
    const request = { periodId: nov, periods: 6 };
    const preview = ok(await api.post(owner, '/budget-suggestions/preview', request));
    const applied = ok(
      await api.post(owner, '/budget-suggestions/confirm', {
        token: preview['token'],
        request,
        lines: [
          {
            target: { kind: 'CATEGORY', id: sup },
            amount: money('1480.00'),
            suggestedAmount: money('1480.00'),
          },
        ],
      }),
    );
    expect((applied['lines'] as Json[])[0]).toMatchObject({ planned: money('1480.00') });

    const exported = await exportAndWait(h, owner, owner.ws);
    const zip = (await downloadExport(h, owner, owner.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED', errorCode: null });
    const restored: User = { ...owner, ws: done['workspaceId'] as string };
    const rapi = w1Api(h, restored);
    const restoredPeriods = (
      ok(await rapi.get(restored, '/periods?limit=100'))['data'] as { id: string; label: string }[]
    ).map((p) => [p.label, p.id] as const);
    const restoredNov = restoredPeriods.find(([label]) => label === '2026-11')![1];
    const after = ok(await rapi.get(restored, `/periods/${restoredNov}/budget`));
    const line = (after['lines'] as Json[])[0]!;
    expect(line['planned']).toEqual(money('1480.00'));
    const basis = line['historyBasis'] as {
      method: string;
      usedCount: number;
      suggested: Json;
      periods: { label: string; status: string; periodId: string }[];
    };
    expect(basis).toMatchObject({ method: 'AVERAGE', usedCount: 5, suggested: money('1480.00') });
    expect(basis.periods.map((p) => [p.label, p.status])).toEqual(
      values.map((_, i) => [`2026-${String(i + 5).padStart(2, '0')}`, i === 3 ? 'OUTLIER' : 'USED']),
    );
    // las referencias a periodos apuntan a los periodos del workspace NUEVO
    const restoredIds = new Map(restoredPeriods);
    const originalIds = new Set(periods.map(([, id]) => id));
    for (const p of basis.periods) {
      expect(p.periodId).toBe(restoredIds.get(p.label));
      expect(originalIds.has(p.periodId)).toBe(false);
    }
  }, 240_000);
});
