import { dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ForecastRequestBuilder,
  ForecastResultValidator,
  OpaqueRefAllocator,
  type ForecastRequestSeries,
  type ServiceSeriesResult,
} from './forecast-request.js';
import type { EvaluatedSeries } from './readiness-gate.js';

/** PRNG determinista local de la prueba (el del producto vive en application/snapshot.ts). */
function seededRandom(seed: string): () => number {
  let a = [...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const WORKSPACE_ID = '01928c4e-0000-7000-8000-00000000a001';
const CATEGORY_ID = '01928c4e-0000-7000-8000-0000000ca001';

const series = (scope: EvaluatedSeries['scope'], scopeRef: string | null, name: string): EvaluatedSeries => ({
  scope,
  scopeRef,
  name,
  kind: 'EXPENSE',
  readiness: 'MODEL',
  readinessReasons: [],
  points: [
    { period: '2026-09', value: dec('900.00'), txCount: 10 },
    { period: '2026-10', value: dec('950.50'), txCount: 12 },
  ],
  historyFrom: '2026-09',
  historyTo: '2026-10',
  groupedCategoryIds: [],
  horizon: 6,
});

const all = [
  series('TOTAL_EXPENSE', null, 'TOTAL_EXPENSE'),
  series('CATEGORY', CATEGORY_ID, 'Restaurantes'),
  series('CATEGORY', '01928c4e-0000-7000-8000-0000000ca002', 'Transporte'),
  { ...series('CATEGORY', 'ins', 'Pocos datos'), readiness: 'INSUFFICIENT' as const },
];

const build = (runId: string) =>
  ForecastRequestBuilder.build({
    requestId: '6f1b7c3e-2d54-4b7a-9a52-0d1c3e5a7b90',
    seed: 7,
    series: all,
    currency: 'BOB',
    scale: 2,
    random: seededRandom(runId),
  });

describe('ForecastRequestBuilder', () => {
  it('[TC-FORECAST-SERVICE-021] la petición no contiene nombres ni identificadores del workspace ni de las categorías', () => {
    const { request } = build('run-R2');
    const text = JSON.stringify(request);
    for (const secret of [
      WORKSPACE_ID,
      CATEGORY_ID,
      'Restaurantes',
      'Transporte',
      'Pocos datos',
      'workspace',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(request.series).toHaveLength(3); // la serie INSUFFICIENT no viaja
    expect(request.series.every((s) => /^s[1-9]\d*$/.test(s.ref))).toBe(true);
    expect(request.series[0]?.points[1]).toEqual({ period: '2026-10', value: '950.50', txCount: 12 });
  });

  it('[TC-FORECAST-SERVICE-022] las referencias opacas cambian en cada corrida y son estables dentro de una', () => {
    const many = Array.from({ length: 12 }, (_, i) => series('CATEGORY', `cat-${i}`, `C${i}`));
    const refsOf = (runId: string) =>
      ForecastRequestBuilder.build({
        requestId: '6f1b7c3e-2d54-4b7a-9a52-0d1c3e5a7b90',
        seed: 7,
        series: many,
        currency: 'BOB',
        scale: 2,
        random: seededRandom(runId),
      }).refs;
    const r2 = refsOf('run-R2');
    const r3 = refsOf('run-R3');
    const key = 'CATEGORY:cat-3';
    expect(refsOf('run-R2').get(key)).toBe(r2.get(key));
    const differing = [...r2.keys()].filter((k) => r2.get(k) !== r3.get(k));
    expect(differing.length).toBeGreaterThan(0);
    expect(new Set(r2.values()).size).toBe(r2.size);
  });

  it('[TC-FORECAST-SERVICE-022] PBT: la asignación es una permutación de s1..sN', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 30 }),
        fc.string(),
        (keys, seed) => {
          const unique = [...new Set(keys)];
          const refs = [...OpaqueRefAllocator.allocate(unique, seededRandom(seed)).values()].sort();
          expect(refs).toEqual(unique.map((_, i) => `s${i + 1}`).sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('ForecastResultValidator', () => {
  const requested: ForecastRequestSeries = {
    ref: 's1',
    kind: 'EXPENSE',
    currency: 'BOB',
    scale: 2,
    readiness: 'MODEL',
    horizon: 1,
    outlierPolicy: 'MAD_3_5',
    points: [{ period: '2026-10', value: '4000.00', txCount: 30 }],
  };
  const result = (over: Partial<ServiceSeriesResult['points'][number]> = {}): ServiceSeriesResult => ({
    ref: 's1',
    status: 'OK',
    error: null,
    model: { name: 'mean_last_n', version: '1', selectedBy: 'fixed' },
    baseline: { method: 'MEAN_LAST_N', n: 6 },
    points: [
      {
        period: '2026-11',
        monthsAhead: 1,
        prediction: '4350.00',
        lower80: '3980.00',
        upper80: '4790.00',
        lower95: '3810.00',
        upper95: '5050.00',
        baselineValue: '4210.00',
        ...over,
      },
    ],
  });

  it('acepta una serie bien formada', () => {
    expect(ForecastResultValidator.validate(requested, result())).toEqual({ ok: true });
  });

  it('[TC-FORECAST-SERVICE-023] un intervalo desordenado descarta la serie', () => {
    expect(
      ForecastResultValidator.validate(
        requested,
        result({ prediction: '900.00', lower80: '950.00', upper80: '1100.00' }),
      ),
    ).toEqual({ ok: false, reason: 'INTERVAL_ORDER' });
    expect(ForecastResultValidator.validate(requested, result({ lower95: '3990.00' }))).toEqual({
      ok: false,
      reason: 'INTERVAL_ORDER',
    });
  });

  it('[TC-FORECAST-SERVICE-024] un valor que excede la escala de la moneda descarta la serie', () => {
    expect(ForecastResultValidator.validate(requested, result({ prediction: '2350.005' }))).toEqual({
      ok: false,
      reason: 'SCALE_EXCEEDED',
    });
  });

  it('[TC-FORECAST-SERVICE-023] rechaza NaN, negativos, periodos erróneos y versión vacía', () => {
    expect(ForecastResultValidator.validate(requested, result({ prediction: 'NaN' })).ok).toBe(false);
    expect(ForecastResultValidator.validate(requested, result({ lower95: '-1.00' }))).toEqual({
      ok: false,
      reason: 'NEGATIVE',
    });
    expect(ForecastResultValidator.validate(requested, result({ period: '2026-12' }))).toEqual({
      ok: false,
      reason: 'PERIODS_MISMATCH',
    });
    expect(
      ForecastResultValidator.validate(requested, {
        ...result(),
        model: { name: 'm', version: '', selectedBy: 'fixed' },
      }),
    ).toEqual({ ok: false, reason: 'MISSING_MODEL' });
  });

  it('[TC-FORECAST-SERVICE-023] PBT: todo resultado aceptado cumple el orden de los CHECK de la tabla', () => {
    const cents = fc.integer({ min: 0, max: 10_000_000 });
    fc.assert(
      fc.property(fc.tuple(cents, cents, cents, cents, cents, cents), (t) => {
        const [a, b, c, d, e, f] = t.map((x) => (x / 100).toFixed(2)) as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const verdict = ForecastResultValidator.validate(
          requested,
          result({ lower95: a, lower80: b, prediction: c, upper80: d, upper95: e, baselineValue: f }),
        );
        if (verdict.ok) {
          const [l95, l80, p, u80, u95] = [a, b, c, d, e].map(Number) as [
            number,
            number,
            number,
            number,
            number,
          ];
          expect(0 <= l95 && l95 <= l80 && l80 <= p && p <= u80 && u80 <= u95).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
