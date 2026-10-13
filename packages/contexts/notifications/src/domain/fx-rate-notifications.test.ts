import { describe, expect, it } from 'vitest';
import {
  anomalyGroupPayload,
  anomalyGroupWithPeak,
  usdtBobGroupPayload,
  EPISODE_ID,
  feedRecoveredPayload,
  feedStalePayload,
  FX_RATE_ID,
} from './fixtures.js';
import { intakeDefinitionOf, NOTIFICATION_INTAKE_CATALOG } from './fx-rate-notifications.js';
import { renderEmail, renderInApp } from './render.js';
import { NOTIFICATION_TYPES } from './types.js';

const stale = intakeDefinitionOf('FX_RATE_FEED_STALE');
const recovered = intakeDefinitionOf('FX_RATE_FEED_RECOVERED');
const anomaly = intakeDefinitionOf('FX_RATE_ANOMALY_RETAINED');
const names = { targetName: null };
const links = {
  notificationUrl: 'https://app.pfos.test/notificaciones/01928c4e-0000-7000-8000-0000000aa001',
  preferencesUrl: 'https://app.pfos.test/preferencias',
};
type Locale = 'es' | 'en' | 'pt';
const stalePlan = stale.plan(feedStalePayload(), EPISODE_ID);
const recoveredPlan = recovered.plan(feedRecoveredPayload(), EPISODE_ID);
const anomalyPlan = anomaly.plan(anomalyGroupPayload(), FX_RATE_ID);
const inApp = (l: Locale, plan: typeof stalePlan) => renderInApp(l, plan.messageKey, plan.params, names);
const email = (l: Locale, variant: 'basic' | 'detailed', plan: typeof stalePlan) =>
  renderEmail({ locale: l, variant, messageKey: plan.messageKey, params: plan.params, names, ...links });
const withoutUrls = (value: string): string => value.replace(/https?:\/\/\S+/g, '');

describe('Catálogo de alertas de tasas (sin consumidor de eventos)', () => {
  it('[TC-NOTIFICATIONS-FX-001] los tres tipos están en NOTIFICATION_TYPES y en el catálogo de entrega directa, solo para OWNER y EDITOR', () => {
    for (const type of ['FX_RATE_FEED_STALE', 'FX_RATE_FEED_RECOVERED', 'FX_RATE_ANOMALY_RETAINED']) {
      expect(NOTIFICATION_TYPES).toContain(type);
      expect(intakeDefinitionOf(type).recipients).toEqual(['OWNER', 'EDITOR']);
    }
    expect(NOTIFICATION_INTAKE_CATALOG.map((d) => d.type)).toHaveLength(3);
    // Ningún tipo de entrega directa tiene consumidor ni evento: NOTIFY no suscribe colas nuevas (D249).
    for (const d of NOTIFICATION_INTAKE_CATALOG) {
      expect(d).not.toHaveProperty('consumer');
      expect(d).not.toHaveProperty('event');
    }
    expect(() => intakeDefinitionOf('BUDGET_THRESHOLD')).toThrow(/unknown/);
  });

  it('[TC-NOTIFICATIONS-FX-001] obsolescencia: WARNING, deduplicada por episodio, con enlace al estado de las tasas automáticas', () => {
    expect(stalePlan).toMatchObject({
      type: 'FX_RATE_FEED_STALE',
      severity: 'WARNING',
      dedupeKey: `fx-rate-feed-stale:${EPISODE_ID}`,
      link: { kind: 'FX_FEED_STATUS', periodId: EPISODE_ID, periodLabel: '2026-10' },
    });
    expect(stalePlan.params).toMatchObject({
      base: 'USDT',
      quote: 'BOB',
      lastRateAsOf: '2026-10-13T08:00:00.000Z',
      staleAfterSeconds: 21600,
    });
    const { title, body } = inApp('es', stalePlan);
    expect(title).toBe('USDT/BOB lleva más de 6 horas sin tasa automática');
    expect(body).toContain('13/10/2026 04:00');
    expect(body).toContain('6 h 15 min');
  });

  it('[TC-NOTIFICATIONS-FX-001] un par que nunca tuvo tasa automática lo dice sin inventar una vigencia', () => {
    const plan = stale.plan(feedStalePayload({ lastRateAsOf: null }), EPISODE_ID);
    const { body } = inApp('es', plan);
    expect(body).toContain('todavía no tiene');
    expect(body).not.toContain('1970');
  });

  it('[TC-NOTIFICATIONS-FX-003] recuperación: INFO, deduplicada por episodio, con la nueva vigencia', () => {
    expect(recoveredPlan).toMatchObject({
      type: 'FX_RATE_FEED_RECOVERED',
      severity: 'INFO',
      dedupeKey: `fx-rate-feed-recovered:${EPISODE_ID}`,
      link: { kind: 'FX_FEED_STATUS', periodId: EPISODE_ID, periodLabel: '2026-10' },
    });
    const { title, body } = inApp('es', recoveredPlan);
    expect(title).toBe('USDT/BOB volvió a tener tasa automática');
    expect(body).toContain('13/10/2026 11:58');
  });

  it('[TC-NOTIFICATIONS-FX-004] anomalía: WARNING, deduplicada por ancla del grupo, con enlace a la pendiente más antigua y valores con signo', () => {
    expect(anomalyPlan).toMatchObject({
      type: 'FX_RATE_ANOMALY_RETAINED',
      severity: 'WARNING',
      messageKey: 'notifications.fx_rate_anomaly_retained.v2',
      dedupeKey: `fx-rate-anomaly-retained:${FX_RATE_ID}`,
      link: { kind: 'FX_RATE', fxRateId: FX_RATE_ID, periodId: FX_RATE_ID, periodLabel: '2026-10' },
    });
    expect(anomaly.refreshable).toBe(true);
    expect(anomalyPlan.params).toMatchObject({
      pendingCount: 1,
      retainedCount: 1,
      providers: ['CRYPTO_EXAMPLE'],
    });
    const { title, body } = inApp('es', anomalyPlan);
    expect(title).toBe('BTC/USDT: 1 tasa automática retenida');
    expect(body).toContain('72.000,00');
    expect(body).toContain('65.000,00');
    expect(body).toContain('+10,77 %');
    expect(body).toContain('CRYPTO_EXAMPLE');
    // La variación es exacta: 10.7692 → +10,77 (HALF_EVEN a 2 decimales) y en inglés usa el punto decimal.
    expect(inApp('en', anomalyPlan).body).toContain('+10.77 %');
    expect(inApp('en', anomalyPlan).title).toBe('BTC/USDT: 1 automatic rate held');
  });

  it('[TC-NOTIFICATIONS-FX-010] el aviso de un salto de USDT/BOB con 3 muestras muestra la cantidad, la mayor variación y el provider', () => {
    const plan = anomaly.plan(usdtBobGroupPayload(), FX_RATE_ID);
    const { title, body } = inApp('es', plan);
    expect(title).toBe('USDT/BOB: 3 tasas automáticas retenidas');
    expect(body).toContain('PARALLEL_SELL 12,90 frente a 12,10 (+6,61 %)');
    expect(body).toContain('paralelo.bo');
    expect(inApp('en', plan).title).toBe('USDT/BOB: 3 automatic rates held');
  });

  it('[TC-NOTIFICATIONS-FX-011] varios providers se listan por su nombre y la cantidad cambia con la foto', () => {
    const plan = anomaly.plan(
      usdtBobGroupPayload({ pendingCount: 5, retainedCount: 5, providers: ['DOLARAPI_BO', 'PARALELO_BO'] }),
      FX_RATE_ID,
    );
    expect(inApp('es', plan).title).toBe('USDT/BOB: 5 tasas automáticas retenidas');
    expect(inApp('es', plan).body).toContain('bo.dolarapi.com y paralelo.bo');
  });

  it('[TC-NOTIFICATIONS-FX-019] el aviso agrupado en portugués usa el plural de 3 muestras y +6,61 % con la coma decimal', () => {
    const plan = anomaly.plan(usdtBobGroupPayload(), FX_RATE_ID);
    const { title, body } = inApp('pt', plan);
    expect(title).toBe('USDT/BOB: 3 taxas automáticas retidas');
    expect(body).toContain('+6,61 %');
    expect(body).toContain('12,90 contra 12,10');
    expect(inApp('pt', anomalyPlan).title).toBe('BTC/USDT: 1 taxa automática retida');
  });

  it('[TC-NOTIFICATIONS-FX-004] una variación negativa conserva su signo', () => {
    const plan = anomaly.plan(
      anomalyGroupWithPeak({ value: '58000.00', variationPct: '-10.7692' }),
      FX_RATE_ID,
    );
    expect(inApp('es', plan).body).toContain('-10,77 %');
  });

  it('[TC-NOTIFICATIONS-FX-018] una notificación v1 (una por muestra) se sigue renderizando con su mensaje v1', () => {
    const v1 = {
      rateId: FX_RATE_ID,
      base: 'BTC',
      quote: 'USDT',
      rateType: 'MARKET',
      provider: 'CRYPTO_EXAMPLE',
      value: '72000.00',
      baselineRateId: FX_RATE_ID,
      baselineValue: '65000.00',
      variationPct: '10.7692',
      thresholdPct: '10',
      detectedAt: '2026-10-13T14:02:10.000Z',
      timeZone: 'America/La_Paz',
    };
    const { title, body } = renderInApp(
      'es',
      'notifications.fx_rate_anomaly_retained.v1',
      v1 as never,
      names,
    );
    expect(title).toBe('Tasa BTC/USDT retenida: variación de +10,77 %');
    expect(body).toContain('72.000,00');
  });

  it('rechaza hechos mal formados (el puerto falla y la transacción de FX se revierte)', () => {
    expect(() => stale.plan(feedStalePayload({ base: 'usdt' }), EPISODE_ID)).toThrow(/base/);
    expect(() => stale.plan(feedStalePayload({ detectedAt: 'ayer' }), EPISODE_ID)).toThrow(/detectedAt/);
    expect(() => stale.plan(feedStalePayload({ timeZone: 'Mars/Base' }), EPISODE_ID)).toThrow(/timeZone/);
    expect(() => stale.plan(feedStalePayload(), 'no-uuid')).toThrow(/factKey/);
    expect(() => recovered.plan(feedRecoveredPayload({ rateId: 'x' }), EPISODE_ID)).toThrow(/rateId/);
    expect(() => anomaly.plan(anomalyGroupWithPeak({ value: '7x' }), FX_RATE_ID)).toThrow(/value/);
    expect(() => anomaly.plan(anomalyGroupWithPeak({ variationPct: '' }), FX_RATE_ID)).toThrow(
      /variationPct/,
    );
    expect(() => anomaly.plan(anomalyGroupPayload({ pendingCount: 0 }), FX_RATE_ID)).toThrow(/pendingCount/);
    expect(() =>
      anomaly.plan(anomalyGroupPayload({ pendingCount: 2, retainedCount: 1 }), FX_RATE_ID),
    ).toThrow(/retainedCount/);
    expect(() => anomaly.plan(anomalyGroupPayload({ providers: [] }), FX_RATE_ID)).toThrow(/providers/);
    expect(() => anomaly.plan(anomalyGroupPayload({ lastRetainedAt: 'ayer' }), FX_RATE_ID)).toThrow(
      /lastRetainedAt/,
    );
    // La clave del grupo es su ancla: un factKey distinto al del hecho es un hecho mal formado.
    expect(() => anomaly.plan(anomalyGroupPayload({ anchorRateId: EPISODE_ID }), FX_RATE_ID)).toThrow(
      /anchorRateId/,
    );
  });
});

describe('Idioma y zona horaria de las alertas de tasas', () => {
  it('[TC-NOTIFICATIONS-FX-006] pt-BR muestra la obsolescencia en portugués con 04:00 del 13/10/2026 (America/La_Paz)', () => {
    const { title, body } = inApp('pt', stalePlan);
    expect(title).toBe('USDT/BOB está há mais de 6 horas sem taxa automática');
    expect(body).toContain('13/10/2026 04:00');
  });

  it('[TC-NOTIFICATIONS-FX-006] en-US usa su orden de fecha y el inglés', () => {
    const { title, body } = inApp('en', stalePlan);
    expect(title).toBe('USDT/BOB has had no automatic rate for more than 6 hours');
    expect(body).toContain('10/13/2026 04:00');
  });

  it('[TC-NOTIFICATIONS-FX-006] los tres tipos se renderizan en es, en y pt (in-app y email) sin marcadores sin resolver', () => {
    for (const plan of [stalePlan, recoveredPlan, anomalyPlan]) {
      for (const l of ['es', 'en', 'pt'] as const) {
        const rendered = inApp(l, plan);
        expect(rendered.title).not.toMatch(/\{\w+\}/);
        expect(rendered.body).not.toMatch(/\{\w+\}/);
        for (const v of ['basic', 'detailed'] as const) {
          const e = email(l, v, plan);
          expect(e.subject.length).toBeGreaterThan(0);
          expect(e.text).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  it('[TC-NOTIFICATIONS-FX-006] la hora sigue la zona del hecho y no la del servidor', () => {
    const plan = stale.plan(feedStalePayload({ timeZone: 'America/Sao_Paulo' }), EPISODE_ID);
    expect(inApp('es', plan).body).toContain('13/10/2026 05:00');
  });
});

describe('Emails de tasas sin valores salvo opt-in', () => {
  const secrets = [
    '72000.00',
    '72.000,00',
    '72,000.00',
    '65000.00',
    '65.000,00',
    '10.77',
    '10,77',
    'BTC',
    'USDT',
    'BOB',
    'CRYPTO_EXAMPLE',
    'paralelo.bo',
    'dolarapi',
  ];

  it('[TC-NOTIFICATIONS-FX-005] sin opt-in el email no incluye valores, variaciones, monedas ni providers, y enlaza a la app', () => {
    for (const plan of [stalePlan, recoveredPlan, anomalyPlan]) {
      for (const l of ['es', 'en', 'pt'] as const) {
        const e = email(l, 'basic', plan);
        const content = withoutUrls(`${e.subject}\n${e.text}\n${e.html}`);
        for (const secret of secrets) expect(content, `${plan.type} ${l} ${secret}`).not.toContain(secret);
        expect(e.text).toContain(links.notificationUrl);
      }
    }
    // El email del grupo no dice cuántas muestras hay: "una o más tasas automáticas".
    expect(email('es', 'basic', anomalyPlan).text).toContain(
      'Una o más tasas automáticas quedaron retenidas',
    );
    expect(email('es', 'basic', anomalyPlan).text).toContain('revisión');
  });

  it('[TC-NOTIFICATIONS-FX-020] el email del grupo sin opt-in no contiene valores, variación, monedas, providers ni la cantidad', () => {
    const plan = anomaly.plan(usdtBobGroupPayload(), FX_RATE_ID);
    for (const l of ['es', 'en', 'pt'] as const) {
      const e = email(l, 'basic', plan);
      const content = withoutUrls(`${e.subject}\n${e.text}\n${e.html}`);
      for (const secret of [
        '12.90',
        '12,90',
        '12.10',
        '12,10',
        '6.61',
        '6,61',
        'USDT',
        'BOB',
        'paralelo.bo',
      ]) {
        expect(content, `${l} ${secret}`).not.toContain(secret);
      }
      expect(content, `${l} cantidad`).not.toMatch(/(^|[^\d.,])3([^\d.,]|$)/);
    }
    expect(email('es', 'basic', plan).text).toContain('Una o más tasas automáticas quedaron retenidas');
  });

  it('[TC-NOTIFICATIONS-FX-005] con opt-in el email incluye el par y los valores', () => {
    const e = email('es', 'detailed', anomalyPlan);
    expect(e.text).toContain('BTC/USDT');
    expect(e.text).toContain('72.000,00');
    expect(e.text).toContain('65.000,00');
    expect(email('es', 'detailed', stalePlan).text).toContain('USDT/BOB');
  });

  it('[TC-NOTIFICATIONS-FX-020] con opt-in el email del grupo muestra su estado: cantidad, mayor variación y provider', () => {
    const e = email(
      'es',
      'detailed',
      anomaly.plan(usdtBobGroupPayload({ pendingCount: 5, retainedCount: 5 }), FX_RATE_ID),
    );
    expect(e.text).toContain('USDT/BOB: 5 tasas automáticas retenidas pendientes de revisión');
    expect(e.text).toContain('PARALLEL_SELL 12,90 frente a 12,10 (+6,61 %, paralelo.bo)');
  });
});
