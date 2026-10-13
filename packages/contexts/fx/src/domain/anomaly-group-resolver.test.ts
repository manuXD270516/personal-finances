import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveAnomalyGroup, type RetainedSample } from './anomaly-group-resolver.js';

// TDD de `AnomalyGroupResolver` (fx/market-rate-providers, refine-rate-anomaly-alert-grouping; TC-NOTIFICATIONS-FX-012,
// -013, -014 y -023): un grupo es una isla de muestras retenidas del par cuyos intervalos de pendencia se solapan.
const T = (iso: string) => iso;
const id = (n: number) => `0192f3c4-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const sample = (n: number, createdAt: string, over: Partial<RetainedSample> = {}): RetainedSample => ({
  rateId: id(n),
  createdAt,
  decidedAt: null,
  provider: 'PARALELO_BO',
  rateType: 'PARALLEL',
  value: '12.80',
  baselineRateId: id(900 + n),
  variationPct: '6.2241',
  ...over,
});

describe('AnomalyGroupResolver', () => {
  it('[TC-NOTIFICATIONS-FX-010] sin muestras retenidas no hay grupo', () => {
    expect(resolveAnomalyGroup([])).toBeNull();
  });

  it('[TC-NOTIFICATIONS-FX-010] tres muestras del mismo ciclo forman un grupo con la primera como ancla y la mayor variación como pico', () => {
    const t = T('2026-10-13T14:00:00.000Z');
    const group = resolveAnomalyGroup([
      sample(3, t, { rateType: 'PARALLEL_SELL', value: '12.90', variationPct: '6.6116' }),
      sample(1, t),
      sample(2, t, { rateType: 'PARALLEL_BUY', value: '12.70', variationPct: '5.8333' }),
    ]);
    expect(group).toMatchObject({
      anchorRateId: id(1),
      reviewRateId: id(1),
      pendingCount: 3,
      retainedCount: 3,
      providers: ['PARALELO_BO'],
      firstRetainedAt: t,
      peak: { rateId: id(3), rateType: 'PARALLEL_SELL' },
    });
  });

  it('[TC-NOTIFICATIONS-FX-011] los providers pendientes son distintos y van en orden alfabético', () => {
    const t = T('2026-10-13T14:00:00.000Z');
    const group = resolveAnomalyGroup([
      sample(1, t),
      sample(2, t, { provider: 'DOLARAPI_BO' }),
      sample(3, t, { provider: 'DOLARAPI_BO', rateType: 'PARALLEL_BUY' }),
    ]);
    expect(group?.providers).toEqual(['DOLARAPI_BO', 'PARALELO_BO']);
    expect(group?.pendingCount).toBe(3);
  });

  it('[TC-NOTIFICATIONS-FX-012] las muestras de ciclos siguientes se suman al mismo grupo y conservan el ancla', () => {
    const first = [sample(1, T('2026-10-13T14:00:00.000Z')), sample(2, T('2026-10-13T14:00:00.000Z'))];
    const next = [sample(3, T('2026-10-13T14:15:00.000Z')), sample(4, T('2026-10-13T14:15:00.000Z'))];
    const before = resolveAnomalyGroup(first);
    const after = resolveAnomalyGroup([...first, ...next]);
    expect(after?.anchorRateId).toBe(before?.anchorRateId);
    expect(after?.pendingCount).toBe(4);
  });

  it('[TC-NOTIFICATIONS-FX-013] confirmar la más antigua no abre un grupo nuevo: el ancla se conserva y el enlace va a la pendiente más antigua', () => {
    const group = resolveAnomalyGroup([
      sample(1, T('2026-10-13T14:00:00.000Z'), { decidedAt: T('2026-10-13T14:30:00.000Z') }),
      sample(2, T('2026-10-13T14:00:00.000Z')),
      sample(3, T('2026-10-13T14:45:00.000Z')),
    ]);
    expect(group).toMatchObject({
      anchorRateId: id(1),
      reviewRateId: id(2),
      pendingCount: 2,
      retainedCount: 3,
    });
  });

  it('[TC-NOTIFICATIONS-FX-014] tras revisar todas, no hay grupo; una muestra nueva abre otro con su propia ancla', () => {
    const reviewed = [
      sample(1, T('2026-10-13T14:00:00.000Z'), { decidedAt: T('2026-10-13T15:00:00.000Z') }),
      sample(2, T('2026-10-13T14:00:00.000Z'), { decidedAt: T('2026-10-13T15:00:00.000Z') }),
    ];
    expect(resolveAnomalyGroup(reviewed)).toBeNull();
    const group = resolveAnomalyGroup([...reviewed, sample(3, T('2026-10-13T18:00:00.000Z'))]);
    expect(group).toMatchObject({ anchorRateId: id(3), pendingCount: 1, retainedCount: 1 });
  });

  it('[TC-NOTIFICATIONS-FX-014] una muestra creada en el mismo instante en que se revisó la última abre un grupo nuevo', () => {
    const group = resolveAnomalyGroup([
      sample(1, T('2026-10-13T14:00:00.000Z'), { decidedAt: T('2026-10-13T15:00:00.000Z') }),
      sample(2, T('2026-10-13T15:00:00.000Z')),
    ]);
    expect(group?.anchorRateId).toBe(id(2));
  });

  it('[TC-NOTIFICATIONS-FX-012] con empate de variación absoluta el pico es la muestra más reciente; el signo no cuenta', () => {
    const group = resolveAnomalyGroup([
      sample(1, T('2026-10-13T14:00:00.000Z'), { variationPct: '-6.0000' }),
      sample(2, T('2026-10-13T14:00:00.000Z'), { variationPct: '6.0000' }),
      sample(3, T('2026-10-13T14:00:00.000Z'), { variationPct: '-5.9999' }),
    ]);
    expect(group?.peak.rateId).toBe(id(2));
  });

  it('[TC-NOTIFICATIONS-FX-013] el pico se elige solo entre las pendientes', () => {
    const group = resolveAnomalyGroup([
      sample(1, T('2026-10-13T14:00:00.000Z'), {
        variationPct: '50.0000',
        decidedAt: T('2026-10-13T14:30:00.000Z'),
      }),
      sample(2, T('2026-10-13T14:00:00.000Z'), { variationPct: '6.0000' }),
    ]);
    expect(group?.peak.rateId).toBe(id(2));
  });
});

// ───────────────────────────────────────────────────────────────────────────── propiedades (TC-NOTIFICATIONS-FX-023)

const BASE = Date.parse('2026-10-13T00:00:00.000Z');
const iso = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();

/** Muestras con minutos de creación crecientes (empates permitidos) y revisión opcional posterior. */
const samplesArb = fc
  .array(
    fc.record({
      gap: fc.integer({ min: 0, max: 40 }),
      review: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
      variation: fc.integer({ min: -2000, max: 2000 }),
      provider: fc.constantFrom('DOLARAPI_BO', 'PARALELO_BO'),
    }),
    { minLength: 1, maxLength: 14 },
  )
  .map((rows) => {
    let minutes = 0;
    return rows.map((row, i): RetainedSample => {
      minutes += row.gap;
      return sample(i + 1, iso(minutes), {
        decidedAt: row.review === null ? null : iso(minutes + row.review),
        provider: row.provider,
        variationPct: (row.variation / 100).toFixed(4),
      });
    });
  });

describe('AnomalyGroupResolver: propiedades', () => {
  it('[TC-NOTIFICATIONS-FX-023] existe solo con alguna pendiente, es independiente del orden y mantiene pendingCount <= retainedCount', () => {
    fc.assert(
      fc.property(samplesArb, fc.array(fc.integer(), { minLength: 14, maxLength: 14 }), (samples, keys) => {
        const group = resolveAnomalyGroup(samples);
        const pending = samples.filter((s) => s.decidedAt === null);
        expect(group === null).toBe(pending.length === 0);
        const shuffled = samples
          .map((s, i) => ({ s, key: keys[i] ?? 0 }))
          .sort((a, b) => a.key - b.key)
          .map((entry) => entry.s);
        expect(resolveAnomalyGroup(shuffled)).toEqual(group);
        if (group) {
          expect(group.pendingCount).toBeLessThanOrEqual(group.retainedCount);
          const oldestPending = [...pending].sort(
            (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.rateId < b.rateId ? -1 : 1),
          )[0];
          // La pendiente más antigua pertenece a la isla vigente y es el destino del enlace.
          expect(group.reviewRateId).toBe(oldestPending?.rateId);
        }
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('[TC-NOTIFICATIONS-FX-023] el ancla no cambia al agregar muestras pendientes mientras el par siempre tenga alguna pendiente', () => {
    fc.assert(
      fc.property(samplesArb, fc.integer({ min: 0, max: 30 }), (samples, extraGap) => {
        const before = resolveAnomalyGroup(samples);
        fc.pre(before !== null);
        const lastCreated = Math.max(...samples.map((s) => Date.parse(s.createdAt)));
        const extra = sample(500, new Date(lastCreated + extraGap * 60_000).toISOString());
        const after = resolveAnomalyGroup([...samples, extra]);
        // Hay al menos una pendiente antes y la nueva también lo es: el grupo no se interrumpe.
        expect(after?.anchorRateId).toBe(before?.anchorRateId);
        expect(after?.pendingCount).toBe((before?.pendingCount ?? 0) + 1);
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});
