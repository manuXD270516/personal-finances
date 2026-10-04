import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FxRate } from '../common/types';
import { RateSourceBadge } from '../dashboard/RateSourceBadge';
import type { RateAttribution, ResolvedRate } from '../dashboard/types';
import { esContext, textOf } from '../test-support';
import { AnomalyInbox, ProviderCard, ValuationList } from './ProvidersPanel';
import {
  pendingAnomalies,
  quoteSidesByProviderPair,
  reviewedAnomalies,
  reviewReasonError,
  type FxProviderStatus,
} from './providers-logic';

const f = esContext('Fx');
const dash = esContext('Dashboard');

const PARALELO: RateAttribution = {
  provider: 'PARALELO_BO',
  text: 'Fuente: paralelo.bo',
  url: 'https://paralelo.bo',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};
const DOLARAPI: RateAttribution = {
  provider: 'DOLARAPI_BO',
  text: 'Fuente: bo.dolarapi.com',
  url: 'https://bo.dolarapi.com',
  license: null,
  licenseUrl: null,
};

const rate = (over: Partial<FxRate> & Pick<FxRate, 'id' | 'value'>): FxRate => ({
  base: 'USD',
  quote: 'BOB',
  rateType: 'PARALLEL',
  source: 'PROVIDER',
  provider: 'PARALELO_BO',
  attribution: PARALELO,
  asOf: '2026-10-02T08:53:07.532Z',
  effectiveDate: '2026-10-02',
  createdAt: '2026-10-02T09:00:00Z',
  ...over,
});

const resolved = (over: Partial<ResolvedRate>): ResolvedRate => ({
  rate: { base: 'USD', quote: 'BOB', value: '12.02' },
  fxRateId: '0190a000-0000-7000-8000-0000000000f1',
  derivation: 'DIRECT',
  rateType: 'PARALLEL',
  source: 'PROVIDER',
  asOf: '2026-10-02T08:53:07.532Z',
  ageDays: 0,
  approx: false,
  ageSeconds: 412,
  provider: 'PARALELO_BO',
  selection: 'PRIMARY',
  stale: false,
  attribution: PARALELO,
  ...over,
});

/** TC-FX-PROVIDER-015: paralelo.bo con 3 fallas desde las 09:00Z, consultado a las 09:45:30Z. */
const DEGRADED: FxProviderStatus = {
  provider: 'PARALELO_BO',
  enabled: true,
  health: 'DEGRADED',
  feeds: [
    {
      base: 'USD',
      quote: 'BOB',
      rateType: 'PARALLEL',
      role: 'PRIMARY',
      lastRate: rate({ id: 'r1', value: '12.020000000000000000' }),
      stale: false,
      ageSeconds: 3142,
    },
    {
      base: 'USDT',
      quote: 'BOB',
      rateType: 'PARALLEL',
      role: 'PRIMARY',
      lastRate: null,
      stale: true,
      ageSeconds: null,
    },
  ],
  lastAttemptAt: '2026-10-02T09:45:00Z',
  lastSuccessAt: '2026-10-02T09:00:00Z',
  lastError: { code: 'PROVIDER_UNAVAILABLE', httpStatus: 503, at: '2026-10-02T09:45:00Z' },
  consecutiveFailures: 3,
  nextAttemptAt: '2026-10-02T10:00:00Z',
  pollIntervalSeconds: 900,
  rateLimit: { limitPerMinute: 60, retryAfterUntil: null },
  backfill: {
    status: 'COMPLETED',
    pointsImported: 787,
    from: '2024-08-06',
    to: '2026-10-01',
    lastRunAt: '2026-10-02T09:01:00Z',
  },
  attribution: PARALELO,
};

describe('RateSourceBadge junto a toda tasa de provider (add-market-rate-providers 6.1)', () => {
  it('[TC-FX-PROVIDER-012] paralelo.bo: "Fuente: paralelo.bo" enlazado a https://paralelo.bo con la licencia CC BY 4.0 enlazada', () => {
    const html = renderToStaticMarkup(<RateSourceBadge rate={resolved({})} ctx={dash} />);
    expect(html).toContain(
      '<a href="https://paralelo.bo" target="_blank" rel="noopener noreferrer">Fuente: paralelo.bo</a>',
    );
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(textOf(html)).toContain('USD/BOB 12,02 · PARALLEL');
    expect(textOf(html)).toContain('(CC BY 4.0)');
    expect(textOf(html)).toContain('hace 6 min');
    expect(html).toContain('data-selection="PRIMARY"');
    expect(html).not.toContain('rate-level');
  });

  it('[TC-FX-PROVIDER-012] bo.dolarapi.com de respaldo: atribución sin licencia y nivel de fallback visible', () => {
    const html = renderToStaticMarkup(
      <RateSourceBadge
        rate={resolved({
          rate: { base: 'USD', quote: 'BOB', value: '12.055' },
          provider: 'DOLARAPI_BO',
          selection: 'FALLBACK',
          attribution: DOLARAPI,
          ageSeconds: 7140,
        })}
        ctx={dash}
      />,
    );
    expect(html).toContain(
      '<a href="https://bo.dolarapi.com" target="_blank" rel="noopener noreferrer">Fuente: bo.dolarapi.com</a>',
    );
    expect(html).not.toContain('CC BY');
    expect(textOf(html)).toContain('USD/BOB 12,055 · PARALLEL');
    expect(html).toContain('<span data-testid="rate-level">respaldo</span>');
    expect(textOf(html)).toContain('hace 1 h');
  });

  it('[TC-FX-PROVIDER-008] ambos caídos: última conocida 12,02 marcada como obsoleta con su antigüedad relativa', () => {
    const html = renderToStaticMarkup(
      <RateSourceBadge
        rate={resolved({ selection: 'LAST_KNOWN_STALE', stale: true, ageSeconds: 21600 })}
        ctx={dash}
      />,
    );
    expect(html).toContain('data-stale="true"');
    expect(html).toContain('<span data-testid="rate-level">última conocida</span>');
    expect(html).toContain('<strong data-testid="rate-stale">obsoleta</strong>');
    expect(textOf(html)).toContain('hace 6 h');
    expect(textOf(html)).toContain('Fuente: paralelo.bo');
  });

  it('[TC-FX-PROVIDER-018] una manual de otro tipo informa el tipo pedido y su fuente, sin atribución de provider', () => {
    const html = renderToStaticMarkup(
      <RateSourceBadge
        rate={resolved({
          rate: { base: 'USD', quote: 'BOB', value: '11.98' },
          rateType: 'P2P',
          requestedRateType: 'PARALLEL',
          source: 'MANUAL',
          provider: null,
          selection: 'MANUAL',
          attribution: null,
          sourceLabel: 'Casa de cambio centro',
        })}
        ctx={dash}
      />,
    );
    expect(textOf(html)).toContain('Fuente: Casa de cambio centro · origen manual');
    expect(textOf(html)).toContain('tipo pedido: PARALLEL');
    expect(html).not.toContain('paralelo.bo');
  });

  it('la lista de valoración muestra el nivel por par y, sin tasa, invita a registrar una manual', () => {
    const html = renderToStaticMarkup(
      <ValuationList
        valuations={[
          { base: 'USD', quote: 'BOB', rateType: 'PARALLEL', rate: resolved({}) },
          { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL', rate: null },
        ]}
        f={f}
        dash={dash}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('USD/BOB · Paralelo (principal)');
    expect(text).toContain('USD/BOB · Oficial sin tasa disponible (registra una manual)');
  });
});

describe('estado de los providers (add-market-rate-providers 6.2)', () => {
  it('[TC-FX-PROVIDER-015] paralelo.bo degradado: 3 fallas, último éxito, error HTTP 503, feed 12,02 de hace 52 min no obsoleto y carga histórica de 787 puntos', () => {
    const html = renderToStaticMarkup(<ProviderCard status={DEGRADED} f={f} dash={dash} sides={new Map()} />);
    const text = textOf(html);
    expect(html).toContain('data-health="DEGRADED"');
    expect(text).toContain('paralelo.bo Degradado');
    expect(text).toContain('Fallas seguidas3');
    expect(text).toContain('Último errorNo disponible (HTTP 503)');
    expect(text).toContain('Último éxito2 oct de 2026, 5:00 a. m.'); // 09:00Z en America/La_Paz
    expect(text).toContain('1 USD = 12,02 BOB');
    expect(text).toContain('hace 52 min');
    expect(html).toMatch(/data-pair="USD\/BOB" data-rate-type="PARALLEL" data-stale="false"/);
    expect(html).toMatch(/data-pair="USDT\/BOB" data-rate-type="PARALLEL" data-stale="true"/);
    expect(text).toContain('Carga histórica: completada · 787 puntos · del 6 ago de 2024 al 1 oct de 2026');
    expect(html).toContain('href="https://paralelo.bo"');
    expect(text).toContain('Fuente: paralelo.bo (CC BY 4.0)');
  });

  it('[TC-FX-PROVIDER-015] deshabilitado por configuración: sin intentos ni feeds', () => {
    const html = renderToStaticMarkup(
      <ProviderCard
        status={{
          ...DEGRADED,
          enabled: false,
          health: 'DISABLED',
          feeds: [],
          nextAttemptAt: null,
          backfill: { status: 'NOT_APPLICABLE' },
        }}
        f={f}
        dash={dash}
        sides={new Map()}
      />,
    );
    expect(textOf(html)).toContain('Deshabilitado por configuración');
    expect(html).not.toContain('provider-feed');
    expect(html).not.toContain('provider-backfill');
  });

  it('[TC-FX-PROVIDER-016] compra y venta desde el lado del owner (D39): Compra 12,12 (pagas) y Venta 11,92 (recibes)', () => {
    const rates = [
      rate({ id: 'b', value: '12.12', rateType: 'PARALLEL_BUY' }),
      rate({ id: 's', value: '11.92', rateType: 'PARALLEL_SELL' }),
      rate({ id: 'b-old', value: '12.50', rateType: 'PARALLEL_BUY', asOf: '2026-10-01T08:00:00Z' }),
      rate({
        id: 'b-pending',
        value: '13.60',
        rateType: 'PARALLEL_BUY',
        asOf: '2026-10-02T10:00:00Z',
        anomaly: { baselineRateId: 'b', variationPct: '12.2112', thresholdPct: '5', status: 'PENDING' },
      }),
    ];
    const sides = quoteSidesByProviderPair(rates);
    expect(sides.get('PARALELO_BO:USD/BOB')?.buy?.id).toBe('b');
    const html = renderToStaticMarkup(<ProviderCard status={DEGRADED} f={f} dash={dash} sides={sides} />);
    expect(textOf(html)).toContain('USD/BOB Compra 12,12 BOB · Venta 11,92 BOB');
    expect(textOf(html)).toContain('Compra: lo que pagas al comprar 1 USD.');
  });
});

describe('bandeja de anomalías (add-market-rate-providers 6.2)', () => {
  const anomaly = rate({
    id: 'a1',
    value: '13.50',
    asOf: '2026-10-02T09:15:00Z',
    anomaly: { baselineRateId: 'r1', variationPct: '12.3128', thresholdPct: '5', status: 'PENDING' },
  });
  const review = async () => true;

  it('[TC-FX-PROVIDER-010] EDITOR/OWNER ve 13,50 con +12,31 % (umbral 5 %) y puede confirmar o rechazar con motivo', () => {
    const html = renderToStaticMarkup(
      <AnomalyInbox pending={[anomaly]} reviewed={[]} f={f} canReview onReview={review} />,
    );
    const text = textOf(html);
    expect(text).toContain('Anomalías pendientes de revisión (1)');
    expect(text).toContain('1 USD = 13,50 BOB · Paralelo · paralelo.bo · variación +12,31 % (umbral 5 %)');
    expect(html).toContain('data-testid="anomaly-review-form"');
    expect(text).toContain('Confirmar');
    expect(text).toContain('Rechazar');
  });

  it('[TC-FX-PROVIDER-010] VIEWER: solo lectura, sin formulario de revisión', () => {
    const html = renderToStaticMarkup(
      <AnomalyInbox pending={[anomaly]} reviewed={[]} f={f} canReview={false} onReview={review} />,
    );
    expect(textOf(html)).toContain('Solo lectura');
    expect(html).not.toContain('anomaly-review-form');
  });

  it('separa pendientes de revisadas y valida el motivo (3–500 caracteres)', () => {
    const confirmed = rate({
      id: 'a2',
      value: '13.50',
      anomaly: {
        baselineRateId: 'r1',
        variationPct: '12.3128',
        thresholdPct: '5',
        status: 'CONFIRMED',
        reviewedAt: '2026-10-02T09:20:00Z',
        reason: 'Devaluación confirmada',
      },
    });
    expect(pendingAnomalies([confirmed, anomaly]).map((r) => r.id)).toEqual(['a1']);
    expect(reviewedAnomalies([confirmed, anomaly]).map((r) => r.id)).toEqual(['a2']);
    const html = renderToStaticMarkup(
      <AnomalyInbox pending={[]} reviewed={[confirmed]} f={f} canReview onReview={review} />,
    );
    expect(textOf(html)).toContain('No hay anomalías pendientes.');
    expect(textOf(html)).toContain('anomalía confirmada');
    expect(textOf(html)).toContain('motivo: Devaluación confirmada');
    expect(reviewReasonError('  ok ')).toBe('REASON_MIN');
    expect(reviewReasonError('x'.repeat(501))).toBe('REASON_MAX');
    expect(reviewReasonError('Dato verificado')).toBeNull();
  });
});
