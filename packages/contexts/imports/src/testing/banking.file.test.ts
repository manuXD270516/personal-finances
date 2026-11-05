import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ExternalRecord } from '../domain/index.js';
import { FakeExchangeBackend } from '../infrastructure/banking/fake-exchange.js';
import {
  A_BTC,
  A_USDT,
  USER,
  WS,
  activeConnection,
  setupBanking,
  type BankingCtx,
} from './banking-harness.js';
import { addDocument, codeOf } from './pipeline-harness.js';

const deposit = (i: number): ExternalRecord => ({
  type: 'DEPOSIT',
  externalId: `D-${i}`,
  executedAt: `2026-09-${String(i).padStart(2, '0')}T13:00:00.000Z`,
  legs: [{ asset: 'USDT', amount: `${10 + i}.000000`, direction: 'IN' }],
  fees: [],
  description: `Deposito ${i}`,
  raw: {},
});

const wire = (r: ExternalRecord) => ({
  type: r.type,
  id: r.externalId,
  time: r.executedAt,
  legs: r.legs.map((l) => ({ asset: l.asset, amount: l.amount, dir: l.direction })),
  fees: r.fees.map((f) => ({ asset: f.asset, amount: f.amount, kind: f.kind })),
  ...(r.quotedPrice ? { price: r.quotedPrice } : {}),
  note: r.description,
});

const history = (records: readonly ExternalRecord[]) =>
  JSON.stringify({ schema: 'pfos.fake-exchange-history', version: 1, records: records.map(wire) });

const trade = (id: string, day: number): ExternalRecord => ({
  type: 'TRADE',
  externalId: id,
  executedAt: `2026-09-${String(day).padStart(2, '0')}T15:30:00.000Z`,
  legs: [
    { asset: 'USDT', amount: `${100 + day}.000000`, direction: 'OUT' },
    { asset: 'BTC', amount: '0.00150000', direction: 'IN' },
  ],
  fees: [{ asset: 'BTC', amount: '0.00000150', kind: 'PROVIDER' }],
  quotedPrice: { base: 'BTC', quote: 'USDT', price: '66000.00' },
  description: null,
  raw: {},
});

async function fileConnection(ctx: BankingCtx, name = 'Exchange archivo') {
  return ctx.service.create({
    workspaceId: WS,
    userId: USER,
    providerId: 'FAKE_EXCHANGE_FILE',
    name,
    assetMappings: [
      { asset: 'USDT', accountId: A_USDT },
      { asset: 'BTC', accountId: A_BTC },
    ],
  });
}

async function uploadHistory(ctx: BankingCtx, connectionId: string, text: string) {
  const documentId = addDocument(ctx.pipeline, { format: 'JSON', text });
  const started = await ctx.service.createFileImport({
    workspaceId: WS,
    userId: USER,
    connectionId,
    documentId,
  });
  const outcome = await ctx.jobs.sync({ workspaceId: WS, connectionId, importJobId: started.importJobId });
  return { started, outcome };
}

const rowsOf = async (ctx: BankingCtx, importId: string) =>
  (await ctx.queries.preview(WS, importId, { limit: 5000 })).rows;

describe('Archivo de historial de un exchange como proveedor', () => {
  it('[TC-IMPORTS-BANKING-027] un historial de 3 trades con formato verificado produce 3 conversiones con referencias del exchange', async () => {
    const ctx = setupBanking();
    const conn = await fileConnection(ctx);
    expect(conn.status).toBe('ACTIVE');
    expect(conn.credential).toBeNull();
    const { started, outcome } = await uploadHistory(
      ctx,
      conn.id,
      history([trade('T-1', 1), trade('T-2', 2), trade('T-3', 3)]),
    );
    expect(outcome).toBe('READY');
    const job = await ctx.queries.get(WS, started.importJobId);
    expect(job).toMatchObject({ source: 'EXCHANGE_FILE', connectionId: conn.id, status: 'AWAITING_REVIEW' });
    const rows = await rowsOf(ctx, started.importJobId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === 'CONVERSION')).toBe(true);
    const current = await ctx.queries.get(WS, started.importJobId);
    await ctx.imports.approve({
      workspaceId: WS,
      userId: USER,
      importId: started.importJobId,
      expectedVersion: current.version,
    });
    await ctx.persist.persist({ workspaceId: WS, importId: started.importJobId });
    expect(ctx.world.transactions.map((t) => t.externalRef)).toEqual([
      { namespace: 'imports.provider:FAKE:TRADE', id: 'T-1' },
      { namespace: 'imports.provider:FAKE:TRADE', id: 'T-2' },
      { namespace: 'imports.provider:FAKE:TRADE', id: 'T-3' },
    ]);
  });

  it('[TC-IMPORTS-BANKING-028] un archivo cuyas columnas no coinciden con ningún formato verificado se rechaza', async () => {
    const ctx = setupBanking();
    const conn = await fileConnection(ctx);
    const documentId = addDocument(ctx.pipeline, {
      format: 'CSV',
      text: 'Fecha,Monto,Descripcion\n2026-09-01,10.00,algo\n',
    });
    expect(
      await codeOf(
        ctx.service.createFileImport({ workspaceId: WS, userId: USER, connectionId: conn.id, documentId }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
    expect(ctx.world.jobs.size).toBe(0);
    // Un JSON de otro esquema tampoco se acepta.
    const other = addDocument(ctx.pipeline, {
      format: 'JSON',
      text: JSON.stringify({ schema: 'otro', records: [] }),
    });
    expect(
      await codeOf(
        ctx.service.createFileImport({
          workspaceId: WS,
          userId: USER,
          connectionId: conn.id,
          documentId: other,
        }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
  });

  it('[TC-IMPORTS-BANKING-021] el archivo y la API del mismo exchange comparten referencia: un trade ya importado por API aparece como ya importado', async () => {
    const ctx = setupBanking({ backend: new FakeExchangeBackend([trade('T-1001', 5)]) });
    const api = await activeConnection(ctx);
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: api.id,
      from: '2026-07-01',
    });
    await ctx.jobs.sync({ workspaceId: WS, connectionId: api.id, importJobId: started.importJobId });
    const j = await ctx.queries.get(WS, started.importJobId);
    await ctx.imports.approve({
      workspaceId: WS,
      userId: USER,
      importId: started.importJobId,
      expectedVersion: j.version,
    });
    await ctx.persist.persist({ workspaceId: WS, importId: started.importJobId });
    expect(ctx.world.transactions).toHaveLength(1);

    const file = await fileConnection(ctx, 'Archivo del mismo exchange');
    const up = await uploadHistory(ctx, file.id, history([trade('T-1001', 5)]));
    const rows = await rowsOf(ctx, up.started.importJobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.classification).toBe('DUPLICATE_EXACT');
    const j2 = await ctx.queries.get(WS, up.started.importJobId);
    await ctx.imports.approve({
      workspaceId: WS,
      userId: USER,
      importId: up.started.importJobId,
      expectedVersion: j2.version,
    });
    await ctx.persist.persist({ workspaceId: WS, importId: up.started.importJobId });
    expect(ctx.world.transactions).toHaveLength(1);
  });

  it('una conexión de API no recibe archivos y una de archivo no sincroniza', async () => {
    const ctx = setupBanking();
    const api = await activeConnection(ctx);
    const file = await fileConnection(ctx);
    const documentId = addDocument(ctx.pipeline, { format: 'JSON', text: history([]) });
    expect(
      await codeOf(
        ctx.service.createFileImport({ workspaceId: WS, userId: USER, connectionId: api.id, documentId }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        ctx.service.sync({ workspaceId: WS, userId: USER, connectionId: file.id, from: '2026-07-01' }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('Idempotencia y presupuesto', () => {
  it('[TC-IMPORTS-BANKING-022] sincronizar dos veces un rango solapado crea exactamente los registros nuevos (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 6 }), async (k, m) => {
        const all = Array.from({ length: k + m }, (_, i) => deposit(i + 1));
        const backend = new FakeExchangeBackend(all.slice(0, k));
        const ctx = setupBanking({ backend, requestsPerMinute: 1000 });
        const c = await activeConnection(ctx);
        const first = await ctx.service.sync({
          workspaceId: WS,
          userId: USER,
          connectionId: c.id,
          from: '2026-09-01',
        });
        await ctx.jobs.sync({ workspaceId: WS, connectionId: c.id, importJobId: first.importJobId });
        const j1 = await ctx.queries.get(WS, first.importJobId);
        await ctx.imports.approve({
          workspaceId: WS,
          userId: USER,
          importId: first.importJobId,
          expectedVersion: j1.version,
        });
        await ctx.persist.persist({ workspaceId: WS, importId: first.importJobId });
        expect(ctx.world.transactions).toHaveLength(k);

        backend.records = all; // v2 solapa con v1 y suma m registros nuevos
        const second = await ctx.service.sync({
          workspaceId: WS,
          userId: USER,
          connectionId: c.id,
          from: '2026-09-01',
        });
        await ctx.jobs.sync({ workspaceId: WS, connectionId: c.id, importJobId: second.importJobId });
        const rows = await rowsOf(ctx, second.importJobId);
        expect(rows.filter((r) => r.classification === 'DUPLICATE_EXACT')).toHaveLength(k);
        const j2 = await ctx.queries.get(WS, second.importJobId);
        await ctx.imports.approve({
          workspaceId: WS,
          userId: USER,
          importId: second.importJobId,
          expectedVersion: j2.version,
        });
        await ctx.persist.persist({ workspaceId: WS, importId: second.importJobId });
        expect(ctx.world.transactions).toHaveLength(k + m);
        expect(new Set(ctx.world.transactions.map((t) => t.externalRef?.id)).size).toBe(k + m);
      }),
      { numRuns: 25 },
    );
  }, 120_000);

  it('el presupuesto de solicitudes agotado reprograma el job, persiste la espera y reanuda sin repetir', async () => {
    const records = Array.from({ length: 6 }, (_, i) => deposit(i + 1));
    const backend = new FakeExchangeBackend(records);
    backend.pageSize = 1;
    const ctx = setupBanking({ backend, requestsPerMinute: 3 });
    const c = await activeConnection(ctx);
    const started = await ctx.service.sync({
      workspaceId: WS,
      userId: USER,
      connectionId: c.id,
      from: '2026-09-01',
    });
    const args = { workspaceId: WS, connectionId: c.id, importJobId: started.importJobId };
    // 1 verificación + 2 páginas agotan las 3 solicitudes del minuto.
    expect(await ctx.jobs.sync(args)).toBe('WAITING');
    const waiting = await ctx.service.get(WS, c.id);
    expect(waiting.retryNotBefore).not.toBeNull();
    expect(ctx.world.staged.filter((s) => s.jobId === started.importJobId)).toHaveLength(2);
    let guard = 0;
    for (;;) {
      ctx.world.clock.advance(61_000);
      const out = await ctx.jobs.sync(args);
      guard += 1;
      if (out === 'READY' || guard > 10) break;
    }
    const rows = await rowsOf(ctx, started.importJobId);
    expect(rows.map((r) => r.externalId).sort()).toEqual(
      records.map((r) => `DEPOSIT:${r.externalId}`).sort(),
    );
  });
});
