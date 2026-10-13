import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateFeedFreshness,
  type FeedFreshnessResult,
  type FeedPairObservation,
  type OpenFeedEpisode,
} from './feed-freshness.js';

// TDD de `FeedFreshnessEvaluator` (fx/market-rate-providers, add-rate-feed-alerts; D233): un episodio abierto por par
// configurado con cobertura automática, un hecho por apertura y uno por cierre.
const HOUR = 3_600_000;
const SIX_HOURS = 6 * HOUR;
const at = (iso: string) => Date.parse(iso);

const usdt = (latest: FeedPairObservation['latest']): FeedPairObservation => ({
  base: 'USDT',
  quote: 'BOB',
  latest,
});
const last = { rateId: 'r1', asOf: '2026-10-13T08:00:00Z' };

describe('FeedFreshnessEvaluator', () => {
  it('[TC-FX-PROVIDER-038] a las 6 h exactas no abre episodio; a las 6 h 15 min sí, desde la vigencia de la última tasa', () => {
    const exact = evaluateFeedFreshness({
      pairs: [usdt(last)],
      open: [],
      nowMs: at('2026-10-13T14:00:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(exact).toEqual({ open: [], close: [], retire: [] });

    const later = evaluateFeedFreshness({
      pairs: [usdt(last)],
      open: [],
      nowMs: at('2026-10-13T14:15:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(later.open).toEqual([{ base: 'USDT', quote: 'BOB', lastRateAsOf: '2026-10-13T08:00:00Z' }]);
    expect(later.close).toEqual([]);
  });

  it('[TC-FX-PROVIDER-038] con el episodio abierto, las verificaciones siguientes no abren otro ni cierran', () => {
    const episode: OpenFeedEpisode = {
      id: 'e1',
      base: 'USDT',
      quote: 'BOB',
      openedAt: '2026-10-13T14:15:00Z',
      lastRateAsOf: last.asOf,
    };
    for (const check of ['2026-10-13T14:30:00Z', '2026-10-13T15:00:00Z']) {
      const result = evaluateFeedFreshness({
        pairs: [usdt(last)],
        open: [episode],
        nowMs: at(check),
        staleAfterMs: SIX_HOURS,
      });
      expect(result).toEqual({ open: [], close: [], retire: [] });
    }
  });

  it('[TC-FX-PROVIDER-038] un par que nunca tuvo tasa aceptada abre con lastRateAsOf null', () => {
    const result = evaluateFeedFreshness({
      pairs: [usdt(null)],
      open: [],
      nowMs: at('2026-10-13T14:15:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(result.open).toEqual([{ base: 'USDT', quote: 'BOB', lastRateAsOf: null }]);
  });

  it('[TC-FX-PROVIDER-039] una tasa fresca cierra el episodio con la tasa de recuperación; una repetición no cierra otra vez', () => {
    const episode: OpenFeedEpisode = {
      id: 'e1',
      base: 'USDT',
      quote: 'BOB',
      openedAt: '2026-10-13T14:15:00Z',
      lastRateAsOf: last.asOf,
    };
    const fresh = { rateId: 'r2', asOf: '2026-10-13T15:58:00Z' };
    const closed = evaluateFeedFreshness({
      pairs: [usdt(fresh)],
      open: [episode],
      nowMs: at('2026-10-13T16:00:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(closed.close).toEqual([{ episode, recovered: fresh }]);
    expect(closed.open).toEqual([]);
    // Ya cerrado (sin episodio abierto) y fresca: nada.
    const again = evaluateFeedFreshness({
      pairs: [usdt(fresh)],
      open: [],
      nowMs: at('2026-10-13T16:15:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(again).toEqual({ open: [], close: [], retire: [] });
  });

  it('[TC-FX-PROVIDER-041] un episodio abierto de un par que ya no se evalúa se retira sin hecho de recuperación', () => {
    const episode: OpenFeedEpisode = {
      id: 'e9',
      base: 'EUR',
      quote: 'BOB',
      openedAt: '2026-10-13T14:15:00Z',
      lastRateAsOf: null,
    };
    const result = evaluateFeedFreshness({
      pairs: [usdt(last)],
      open: [episode],
      nowMs: at('2026-10-13T14:00:00Z'),
      staleAfterMs: SIX_HOURS,
    });
    expect(result.retire).toEqual([episode]);
    expect(result.close).toEqual([]);
  });

  it('[TC-FX-PROVIDER-038] PBT: nunca hay dos episodios abiertos del mismo par y cada apertura y cada cierre producen un solo hecho', () => {
    const step = fc.record({
      advanceMin: fc.integer({ min: 1, max: 180 }),
      // Muestra nueva en este paso (retraso de su vigencia respecto del reloj) o ninguna.
      sampleLagMin: fc.option(fc.integer({ min: 0, max: 600 }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 120 }), (steps) => {
        let now = at('2026-10-13T00:00:00Z');
        let latest: FeedPairObservation['latest'] = { rateId: 'r0', asOf: '2026-10-13T00:00:00Z' };
        let open: OpenFeedEpisode[] = [];
        let rateSeq = 0;
        let opens = 0;
        let closes = 0;
        for (const s of steps) {
          now += s.advanceMin * 60_000;
          if (s.sampleLagMin !== null) {
            const asOfMs = now - s.sampleLagMin * 60_000;
            // La última tasa nunca retrocede (la ingesta solo agrega vigencias; `latest` es el máximo).
            if (!latest || asOfMs > Date.parse(latest.asOf)) {
              rateSeq += 1;
              latest = { rateId: `r${rateSeq}`, asOf: new Date(asOfMs).toISOString() };
            }
          }
          const result: FeedFreshnessResult = evaluateFeedFreshness({
            pairs: [usdt(latest)],
            open,
            nowMs: now,
            staleAfterMs: SIX_HOURS,
          });
          // A lo sumo un hecho por verificación y par, nunca apertura y cierre a la vez.
          expect(result.open.length + result.close.length).toBeLessThanOrEqual(1);
          if (open.length > 0) expect(result.open).toEqual([]);
          const stale = latest === null || now - Date.parse(latest.asOf) > SIX_HOURS;
          for (const o of result.open) {
            expect(stale).toBe(true);
            opens += 1;
            open = [
              {
                id: `e${opens}`,
                base: o.base,
                quote: o.quote,
                openedAt: new Date(now).toISOString(),
                lastRateAsOf: o.lastRateAsOf,
              },
            ];
          }
          for (const c of result.close) {
            expect(stale).toBe(false);
            closes += 1;
            open = open.filter((e) => e.id !== c.episode.id);
          }
          expect(open.length).toBeLessThanOrEqual(1);
          expect(opens - closes).toBe(open.length);
        }
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
