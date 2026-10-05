import { DomainError, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { FxQueries } from './fx.queries.js';
import { FxService, type RecordManualRateCommand } from './fx.service.js';
import { inMemoryFxDeps } from './testing/in-memory.js';

const WS = 'ws-1';

function setup() {
  const mem = inMemoryFxDeps();
  return { ...mem, service: new FxService(mem.deps), queries: new FxQueries(mem.deps) };
}

const p2p = (over: Partial<RecordManualRateCommand> = {}): RecordManualRateCommand => ({
  workspaceId: WS,
  userId: 'u1',
  base: 'USDT',
  quote: 'BOB',
  value: '6.95',
  rateType: 'P2P',
  asOf: '2026-09-29T19:00:00Z', // 2026-09-29T15:00:00-04:00
  sourceLabel: 'Mediana Binance P2P',
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

describe('RecordManualRate / SupersedeRate (fx/market-rates)', () => {
  it('[TC-FX-RATE-001] registra la tasa P2P, la lee por id tal cual y emite fx.RateRecorded.v1 con auditoría', async () => {
    const { service, queries, state } = setup();
    const { rate } = await service.recordManualRate(p2p());
    const read = await queries.getRate(WS, rate.id);
    const s = read.rate.snapshot;
    expect([s.source, read.rate.valueText, s.rateType, s.sourceLabel]).toEqual([
      'MANUAL',
      '6.95',
      'P2P',
      'Mediana Binance P2P',
    ]);
    expect([s.asOf, s.effectiveDate]).toEqual(['2026-09-29T19:00:00.000Z', '2026-09-29']);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({
      eventType: 'fx.RateRecorded',
      aggregateId: rate.id,
      payload: { rateId: rate.id, base: 'USDT', quote: 'BOB', value: '6.95', supersedesRateId: null },
    });
    expect(state.audit.map((a) => a.action)).toEqual(['fx.exchange_rate.recorded']);
    const parallel = await service.recordManualRate(
      p2p({ base: 'USD', value: '6.965432109876543210', rateType: 'PARALLEL' }),
    );
    expect((await queries.getRate(WS, parallel.rate.id)).rate.rate.toPersisted()).toBe(
      '6.965432109876543210',
    );
  });

  it('[TC-FX-RATE-002] tasas inválidas se rechazan con VALIDATION_FAILED sin persistir ni emitir eventos', async () => {
    const { service, state } = setup();
    expect(await codeOf(service.recordManualRate(p2p({ value: '0.00' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.recordManualRate(p2p({ value: '-6.95' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.recordManualRate(p2p({ base: 'BOB', value: '1.00' })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(service.recordManualRate(p2p({ base: 'XYZ' })))).toBe('CURRENCY_NOT_ENABLED');
    expect([state.rates.length, state.outbox.length, state.audit.length]).toEqual([0, 0, 0]);
  });

  it('[TC-FX-HISTORICAL-002] reemplazar R1 = 9.65 por 6.95 crea R2 con motivo auditado; R1 sigue legible y un segundo reemplazo es 409', async () => {
    const { service, queries, state } = setup();
    const { rate: r1 } = await service.recordManualRate(p2p({ value: '9.65' }));
    const { rate: r2 } = await service.supersedeRate({
      workspaceId: WS,
      userId: 'u1',
      rateId: r1.id,
      value: '6.95',
      reason: 'error de tipeo',
    });
    expect([r2.snapshot.supersedesId, r2.snapshot.asOf, r2.valueText]).toEqual([
      r1.id,
      r1.snapshot.asOf,
      '6.95',
    ]);
    const old = await queries.getRate(WS, r1.id);
    expect([old.rate.valueText, old.supersededById]).toEqual(['9.65', r2.id]);
    const audit = state.audit.at(-1);
    expect(audit).toMatchObject({
      action: 'fx.exchange_rate.superseded',
      aggregateId: r2.id,
      reason: 'error de tipeo',
    });
    expect(state.outbox.at(-1)?.payload).toMatchObject({ rateId: r2.id, supersedesRateId: r1.id });
    expect(
      await codeOf(
        service.supersedeRate({
          workspaceId: WS,
          userId: 'u1',
          rateId: r1.id,
          value: '6.94',
          reason: 'otra',
        }),
      ),
    ).toBe('FX_RATE_ALREADY_SUPERSEDED');
    expect(
      await codeOf(
        service.supersedeRate({
          workspaceId: WS,
          userId: 'u1',
          rateId: 'nope',
          value: '6.94',
          reason: 'otra',
        }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    // La consulta as-of usa la versión vigente R2, nunca la reemplazada.
    const latest = await queries.latest({
      workspaceId: WS,
      base: 'USDT',
      quote: 'BOB',
      asOf: '2026-09-30T12:00:00Z',
    });
    expect(latest.fxRateId).toBe(r2.id);
  });

  it('si la auditoría falla, nada se persiste (misma unidad de trabajo, INV-029)', async () => {
    const { service, state, faults } = setup();
    faults.audit = new Error('audit down');
    await expect(service.recordManualRate(p2p())).rejects.toThrow('audit down');
    expect([state.rates.length, state.outbox.length]).toEqual([0, 0]);
  });
});

describe('Preferencias y valoración (fx/market-rates)', () => {
  it('[TC-FX-RATE-004] la valoración usa el tipo preferido; cambiarlo no altera ninguna tasa', async () => {
    const { service, queries, state } = setup();
    await service.recordManualRate(
      p2p({ base: 'USD', value: '6.96', rateType: 'OFFICIAL', asOf: '2026-09-30T12:00:00Z' }),
    );
    await service.recordManualRate(
      p2p({ base: 'USD', value: '9.80', rateType: 'PARALLEL', asOf: '2026-09-30T12:00:00Z' }),
    );
    const before = state.rates.map((r) => [r.id, r.valueText]);
    const set = await service.replacePreferences({
      workspaceId: WS,
      expectedVersion: 1,
      preferences: [{ base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' }],
    });
    const value = () =>
      queries.convertForValuation({
        workspaceId: WS,
        amount: { amount: '100.00', currency: 'USD' },
        to: 'BOB',
        asOf: '2026-10-01T03:00:00Z',
      });
    const official = await value();
    expect([
      official.amount.toFixed(),
      official.resolved?.rateType,
      official.resolved?.effectiveDate,
    ]).toEqual(['696.00', 'OFFICIAL', '2026-09-30']);
    expect(official.resolved?.sourceLabel).toBe('Mediana Binance P2P');
    await service.replacePreferences({
      workspaceId: WS,
      expectedVersion: set.version,
      preferences: [{ base: 'BOB', quote: 'USD', rateType: 'PARALLEL' }],
    });
    const parallel = await value();
    expect([parallel.amount.toFixed(), parallel.resolved?.rateType]).toEqual(['980.00', 'PARALLEL']);
    expect(state.rates.map((r) => [r.id, r.valueText])).toEqual(before);
    expect(
      await codeOf(service.replacePreferences({ workspaceId: WS, expectedVersion: 1, preferences: [] })),
    ).toBe('PRECONDITION_FAILED');
    expect(
      await codeOf(
        service.replacePreferences({
          workspaceId: WS,
          expectedVersion: 3,
          preferences: [
            { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' },
            { base: 'BOB', quote: 'USD', rateType: 'PARALLEL' },
          ],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-FX-RATE-003] GetRate fuera de la ventana responde FX_RATE_NOT_FOUND', async () => {
    const { service, queries } = setup();
    await service.recordManualRate(p2p());
    expect(
      await codeOf(
        queries.latest({
          workspaceId: WS,
          base: 'USDT',
          quote: 'BOB',
          asOf: '2026-10-10T16:00:00Z',
          rateType: 'P2P',
        }),
      ),
    ).toBe('FX_RATE_NOT_FOUND');
  });

  it('[TC-FX-RATE-003] la ventana de la valoración la fija Reporting (D53): la del llamador o la compuesta, nunca 1:1', async () => {
    const { service, queries, deps } = setup();
    await service.recordManualRate(p2p({ value: '6.96', rateType: 'PARALLEL' }));
    // 11 días después de la tasa (2026-09-29T19:00Z).
    const req = [{ base: 'USDT', quote: 'BOB', at: Instant.parse('2026-10-10T19:00:00Z') }];
    expect(await queries.resolveValuationRates(WS, req)).toEqual([null]);
    const [found] = await queries.resolveValuationRates(WS, req, 14);
    expect(found?.rate.value.toFixed()).toBe('6.96');
    expect(await codeOf(queries.resolveValuationRates(WS, req, 0))).toBe('VALIDATION_FAILED');
    // Compuesta con la ventana de Reporting (createFxRuntime({ windowDays })): misma resolución sin pasarla.
    const composed = new FxQueries({ ...deps, windowDays: 14 });
    expect(composed.windowDays).toBe(14);
    expect((await composed.resolveValuationRates(WS, req))[0]?.rate.value.toFixed()).toBe('6.96');
  });

  it('[TC-FX-PRICING-006] referencia para una conversión: explícita por id o resuelta con el tipo preferido, nunca cruzada', async () => {
    const { service, queries } = setup();
    await service.recordManualRate(
      p2p({ value: '6.99', rateType: 'PARALLEL', asOf: '2026-09-30T10:00:00Z' }),
    );
    const { rate: r2 } = await service.recordManualRate(p2p());
    await service.replacePreferences({
      workspaceId: WS,
      expectedVersion: 1,
      preferences: [{ base: 'USDT', quote: 'BOB', rateType: 'P2P' }],
    });
    const ref = await queries.referenceForConversion({
      workspaceId: WS,
      base: 'USDT',
      quote: 'BOB',
      executedAt: '2026-09-30T18:42:00Z',
    });
    expect(ref).toMatchObject({
      fxRateId: r2.id,
      rate: { base: 'USDT', quote: 'BOB', value: '6.95' },
      rateType: 'P2P',
    });
    // Orientación inversa del par: misma versión, almacenada en su orientación original.
    const inverse = await queries.referenceForConversion({
      workspaceId: WS,
      base: 'BOB',
      quote: 'USDT',
      executedAt: '2026-09-30T18:42:00Z',
    });
    expect(inverse?.fxRateId).toBe(r2.id);
    expect(
      await codeOf(
        queries.referenceForConversion({
          workspaceId: WS,
          base: 'USD',
          quote: 'BOB',
          executedAt: '2026-09-30T18:42:00Z',
          fxRateId: r2.id,
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    // Solo hay USDT/USD y USD/BOB: la referencia de USDT→BOB sería cruzada ⇒ sin referencia.
    const cross = inMemoryFxDeps();
    const crossService = new FxService(cross.deps);
    await crossService.recordManualRate(p2p({ quote: 'USD', value: '0.9990' }));
    await crossService.recordManualRate(p2p({ base: 'USD', value: '6.96', rateType: 'OFFICIAL' }));
    expect(
      await new FxQueries(cross.deps).referenceForConversion({
        workspaceId: WS,
        base: 'USDT',
        quote: 'BOB',
        executedAt: '2026-09-30T18:42:00Z',
      }),
    ).toBeNull();
  });

  it('[TC-FX-PRICING-004] costo total en la moneda de reporte con la referencia de la conversión y missingValuations', async () => {
    const { service, queries } = setup();
    const { rate } = await service.recordManualRate(p2p());
    const reference = await queries.referenceForConversion({
      workspaceId: WS,
      base: 'USDT',
      quote: 'BOB',
      executedAt: '2026-09-30T18:42:00Z',
      fxRateId: rate.id,
    });
    const cost = await queries.conversionCost({
      workspaceId: WS,
      executedAt: '2026-09-30T18:42:00Z',
      components: [
        { amount: '0.100000', currency: 'USDT' },
        { amount: '5.00', currency: 'BOB' },
        { amount: '15.000000', currency: 'TRX' },
      ],
      reference,
    });
    expect(cost).toEqual({
      amount: { amount: '5.70', currency: 'BOB' },
      complete: false,
      missingValuations: [{ amount: '15.000000', currency: 'TRX' }],
    });
  });

  it('el workspace nuevo habilita BOB, USD y USDT; el catálogo filtra por tipo', async () => {
    const { service, queries } = setup();
    await service.onWorkspaceCreated({ workspaceId: WS, baseCurrency: 'BOB' });
    const crypto = await queries.listCurrencies(WS, { kind: 'CRYPTO' });
    expect(crypto.map((c) => c.definition.code)).toEqual(['USDT', 'USDC', 'TRX', 'BTC', 'ETH']);
    const enabled = await queries.listCurrencies(WS, { enabled: true });
    expect(enabled.map((c) => c.definition.code).sort()).toEqual(['BOB', 'USD', 'USDT']);
  });

  it('[TC-ACCOUNTS-CURRENCY-001] enableCurrencies habilita monedas activas sin perder las por defecto; inexistente ⇒ CURRENCY_NOT_ENABLED', async () => {
    const { service, queries } = setup();
    // Workspace sin filas (se trata como el conjunto por defecto): habilitar BTC conserva BOB/USD/USDT.
    await service.enableCurrencies({ workspaceId: WS, codes: ['BTC'] });
    await service.enableCurrencies({ workspaceId: WS, codes: ['BTC'] }); // idempotente
    const enabled = await queries.listCurrencies(WS, { enabled: true });
    expect(enabled.map((c) => c.definition.code).sort()).toEqual(['BOB', 'BTC', 'USD', 'USDT']);
    expect(await codeOf(service.enableCurrencies({ workspaceId: WS, codes: ['XYZ'] }))).toBe(
      'CURRENCY_NOT_ENABLED',
    );
  });
});

describe('Recorrido de una tasa manual (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-010] USDT/BOB P2P 6.95 del 2026-03-15 corregida a 6.96: RECORD y SUPERSEDE enlazada a la 6.96; la 6.95 conserva su valor', async () => {
    const { service, queries } = setup();
    const { rate: r1 } = await service.recordManualRate(p2p({ asOf: '2026-03-15T16:00:00Z' }));
    const { rate: r2 } = await service.supersedeRate({
      workspaceId: WS,
      userId: 'u1',
      rateId: r1.id,
      value: '6.96',
      reason: 'error de tipeo',
    });
    const view = await service.rateLifecycle({ userId: 'u1', workspaceId: WS, rateId: r1.id });
    expect(
      view.items.map((i) => (i.kind === 'TRANSITION' ? [i.transition, i.fromState, i.toState] : [])),
    ).toEqual([
      ['RECORD', null, 'RECORDED'],
      ['SUPERSEDE', 'RECORDED', 'SUPERSEDED'],
    ]);
    expect(view.items[1]).toMatchObject({
      detailRefs: { supersededByRateId: r2.id },
      reason: 'error de tipeo',
    });
    expect(view.currentState).toBe('SUPERSEDED');
    const next = await service.rateLifecycle({ userId: 'u1', workspaceId: WS, rateId: r2.id });
    expect(next.items).toEqual([
      expect.objectContaining({
        transition: 'RECORD',
        toState: 'RECORDED',
        detailRefs: { supersedesRateId: r1.id },
        events: ['fx.RateRecorded.v1'],
      }),
    ]);
    expect((await queries.getRate(WS, r1.id)).rate.valueText).toBe('6.95');
  });
});
