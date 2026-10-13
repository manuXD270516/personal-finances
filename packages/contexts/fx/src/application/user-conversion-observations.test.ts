import { DomainError, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { FxQueries } from './fx.queries.js';
import { FxService } from './fx.service.js';
import { inMemoryFxDeps } from './testing/in-memory.js';
import {
  observationFactOf,
  UserConversionObservations,
  type BackfillConversion,
  type ConversionObservationFact,
} from './user-conversion-observations.js';

const WS = 'ws-1';
const TX = '0192f3c4-0000-7000-8000-0000000000f1';

function setup() {
  const mem = inMemoryFxDeps();
  const observations = new UserConversionObservations({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    currencies: mem.deps.currencies,
    outbox: mem.deps.outbox,
    ids: mem.deps.ids,
    clock: mem.deps.clock,
  });
  return {
    ...mem,
    observations,
    service: new FxService(mem.deps),
    queries: new FxQueries(mem.deps),
  };
}

/** Venta de 100.000000 USDT por 1190.00 BOB netos ejecutada el 2026-10-05T10:00:00-04:00. */
const sale = (over: Partial<ConversionObservationFact> = {}): ConversionObservationFact => ({
  workspaceId: WS,
  transactionId: TX,
  revision: 1,
  base: 'USDT',
  quote: 'BOB',
  value: '11.900000000000000000',
  executedAt: '2026-10-05T14:00:00Z', // 2026-10-05T10:00:00-04:00
  businessDate: '2026-10-05',
  ...over,
});

const observationsOf = async (mem: ReturnType<typeof setup>) =>
  mem.queries.listRates(WS, { source: 'USER_CONVERSION', includeSuperseded: true }, { offset: 0, limit: 50 });

describe('RecordUserConversionObservation (fx/market-rates, D231)', () => {
  it('[TC-FX-USERCONV-001] la venta de USDT queda como una observación USER_CONVERSION con su conversión y vigencia', async () => {
    const mem = setup();
    expect(await mem.observations.record(sale())).toBe('RECORDED');
    const [found, ...rest] = await observationsOf(mem);
    expect(rest).toHaveLength(0);
    const s = found?.rate.snapshot;
    expect([s?.source, s?.rateType, s?.rate.base.code, s?.rate.quote.code]).toEqual([
      'USER_CONVERSION',
      'CUSTOM',
      'USDT',
      'BOB',
    ]);
    expect(found?.rate.rate.toPersisted()).toBe('11.900000000000000000');
    expect([s?.asOf, s?.effectiveDate, s?.sourceLabel]).toEqual([
      '2026-10-05T14:00:00.000Z',
      '2026-10-05',
      'Conversión',
    ]);
    expect(s?.conversionRef).toEqual({ transactionId: TX, revision: 1 });
    expect(mem.state.outbox).toHaveLength(1);
    expect(mem.state.outbox[0]).toMatchObject({
      eventType: 'fx.RateRecorded',
      payload: { source: 'USER_CONVERSION', rateType: 'CUSTOM', value: '11.9', supersedesRateId: null },
    });
  });

  it('[TC-FX-USERCONV-001] procesar otra vez el mismo hecho no registra una segunda observación ni otro evento', async () => {
    const mem = setup();
    await mem.observations.record(sale());
    expect(await mem.observations.record(sale())).toBe('DUPLICATE');
    expect(await mem.observations.record(sale({ value: '11.50' }))).toBe('DUPLICATE');
    expect(await observationsOf(mem)).toHaveLength(1);
    expect(mem.state.outbox).toHaveLength(1);
  });

  it('[TC-FX-USERCONV-001] la carga inicial registra las 12 conversiones anteriores y repetirla no registra ninguna más', async () => {
    const mem = setup();
    const conversions: BackfillConversion[] = Array.from({ length: 12 }, (_, i) => ({
      transactionId: `0192f3c4-0000-7000-8000-${(0xa00 + i).toString(16).padStart(12, '0')}`,
      revision: 1,
      base: 'USDT',
      quote: 'BOB',
      value: `11.${String(80 + i)}`,
      executedAt: `2026-09-${String(10 + i).padStart(2, '0')}T14:00:00Z`,
      businessDate: `2026-09-${String(10 + i).padStart(2, '0')}`,
      voided: false,
    }));
    const source = { listCurrentConversions: async () => conversions };
    expect(await mem.observations.backfill(WS, source)).toEqual({ recorded: 12, withdrawn: 0 });
    expect(await mem.observations.backfill(WS, source)).toEqual({ recorded: 0, withdrawn: 0 });
    expect(await observationsOf(mem)).toHaveLength(12);
  });

  it('[TC-FX-USERCONV-001] la carga inicial registra y marca las conversiones anuladas, una sola vez', async () => {
    const mem = setup();
    const voided: BackfillConversion = { ...sale(), voided: true };
    const source = { listCurrentConversions: async () => [voided] };
    expect(await mem.observations.backfill(WS, source)).toEqual({ recorded: 1, withdrawn: 1 });
    expect(await mem.observations.backfill(WS, source)).toEqual({ recorded: 0, withdrawn: 0 });
    const [found] = await observationsOf(mem);
    expect(found?.withdrawal?.reason).toBe('conversión anulada');
  });

  it('[TC-FX-USERCONV-003] una revisión registra la observación nueva que reemplaza a la anterior con el motivo "conversión revisada"', async () => {
    const mem = setup();
    await mem.observations.record(sale());
    const outcome = await mem.observations.record(sale({ revision: 2, value: '11.88' }));
    expect(outcome).toBe('REPLACED');
    const list = await observationsOf(mem);
    expect(list).toHaveLength(2);
    const next = list.find((r) => r.rate.snapshot.conversionRef?.revision === 2);
    const previous = list.find((r) => r.rate.snapshot.conversionRef?.revision === 1);
    expect(next?.rate.rate.toPersisted()).toBe('11.880000000000000000');
    expect(next?.rate.snapshot.supersedesId).toBe(previous?.rate.id);
    expect(next?.rate.snapshot.supersedeReason).toBe('conversión revisada');
    // La anterior sigue consultable con su valor, marcada como reemplazada, sin modificarla.
    expect(previous?.rate.rate.toPersisted()).toBe('11.900000000000000000');
    expect(previous?.supersededById).toBe(next?.rate.id);
    expect(mem.state.outbox[1]?.payload).toMatchObject({
      value: '11.88',
      supersedesRateId: previous?.rate.id,
    });
  });

  it('[TC-FX-USERCONV-003] un evento de una revisión anterior a la observada no la deshace', async () => {
    const mem = setup();
    await mem.observations.record(sale({ revision: 2, value: '11.88' }));
    expect(await mem.observations.record(sale({ revision: 1 }))).toBe('STALE');
    expect(await observationsOf(mem)).toHaveLength(1);
  });

  it('[TC-FX-USERCONV-003] una anulación marca la observación vigente como anulada sin cambiar su valor, una sola vez', async () => {
    const mem = setup();
    await mem.observations.record(sale());
    expect(await mem.observations.withdraw({ workspaceId: WS, transactionId: TX })).toBe('WITHDRAWN');
    expect(await mem.observations.withdraw({ workspaceId: WS, transactionId: TX })).toBe('DUPLICATE');
    const [found] = await observationsOf(mem);
    expect(found?.rate.rate.toPersisted()).toBe('11.900000000000000000');
    expect(found?.withdrawal).toMatchObject({ transactionId: TX, reason: 'conversión anulada' });
    // Anular marca; no registra una observación nueva ni emite otro evento.
    expect(mem.state.outbox).toHaveLength(1);
  });

  it('[TC-FX-USERCONV-003] anular una conversión sin observación (nunca posteada) no hace nada', async () => {
    const mem = setup();
    expect(await mem.observations.withdraw({ workspaceId: WS, transactionId: TX })).toBe('NO_OBSERVATION');
    expect(mem.state.withdrawals).toHaveLength(0);
  });

  it('[TC-FX-USERCONV-003] una observación no se corrige a mano: reemplazarla con SupersedeRate se rechaza', async () => {
    const mem = setup();
    await mem.observations.record(sale());
    const [found] = await observationsOf(mem);
    let code: string | undefined;
    try {
      await mem.service.supersedeRate({
        workspaceId: WS,
        userId: 'u1',
        rateId: found?.rate.id ?? '',
        value: '12',
        reason: 'corrección manual',
      });
    } catch (err) {
      code = (err as DomainError).code;
    }
    expect(code).toBe('VALIDATION_FAILED');
    expect(await observationsOf(mem)).toHaveLength(1);
  });

  it('[TC-FX-USERCONV-002] las observaciones no valoran: USDT con una observación más reciente que la tasa de provider', async () => {
    const mem = setup();
    await mem.service.recordManualRate({
      workspaceId: WS,
      userId: 'u1',
      base: 'USDT',
      quote: 'BOB',
      value: '12.02',
      rateType: 'PARALLEL',
      asOf: '2026-10-05T13:50:00Z',
    });
    await mem.observations.record(sale({ executedAt: '2026-10-05T14:00:00Z' }));
    const [resolved] = await mem.queries.resolveValuationRates(WS, [
      { base: 'USDT', quote: 'BOB', at: Instant.parse('2026-10-05T14:05:00Z') },
    ]);
    expect(resolved?.rate.value.toFixed()).toBe('12.02');
    expect(resolved?.source).toBe('MANUAL');
    // La referencia de otra conversión a las 14:10Z tampoco toma 11.90.
    const reference = await mem.queries.referenceForConversion({
      workspaceId: WS,
      base: 'USDT',
      quote: 'BOB',
      executedAt: '2026-10-05T14:10:00Z',
    });
    expect(reference?.rate.value).toBe('12.02');
  });
});

describe('hecho de observación de un evento de conversión', () => {
  const payload = {
    transactionId: TX,
    businessDate: '2026-10-05',
    executedAt: '2026-10-05T14:00:00Z',
    effectiveRate: { base: 'USDT', quote: 'BOB', value: '11.9' },
  };

  it('ConversionRecorded.v1 sin revisión es la revisión 1 y ConversionRevised.v1 usa revisionTo', () => {
    expect(observationFactOf(WS, payload)).toMatchObject({ revision: 1, base: 'USDT', value: '11.9' });
    expect(observationFactOf(WS, { ...payload, revisionFrom: 1, revisionTo: 2 }).revision).toBe(2);
  });

  it('un payload mal formado falla fuerte (va a reintentos y dead-letter) en lugar de descartarse', () => {
    expect(() => observationFactOf(WS, { ...payload, effectiveRate: null })).toThrow(DomainError);
    expect(() => observationFactOf(WS, { ...payload, revisionTo: 0 })).toThrow(DomainError);
    expect(() => observationFactOf(WS, null)).toThrow(DomainError);
  });
});
