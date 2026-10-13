import { describe, expect, it } from 'vitest';
import {
  anomalyRetainedPayload,
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
const anomalyPlan = anomaly.plan(anomalyRetainedPayload(), FX_RATE_ID);
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

  it('[TC-NOTIFICATIONS-FX-004] anomalía: WARNING, deduplicada por tasa, con enlace a su revisión y valores con signo', () => {
    expect(anomalyPlan).toMatchObject({
      type: 'FX_RATE_ANOMALY_RETAINED',
      severity: 'WARNING',
      dedupeKey: `fx-rate-anomaly-retained:${FX_RATE_ID}`,
      link: { kind: 'FX_RATE', fxRateId: FX_RATE_ID, periodId: FX_RATE_ID, periodLabel: '2026-10' },
    });
    const { title, body } = inApp('es', anomalyPlan);
    expect(title).toContain('BTC/USDT');
    expect(title).toContain('+10,77 %');
    expect(body).toContain('72.000,00');
    expect(body).toContain('65.000,00');
    expect(body).toContain('CRYPTO_EXAMPLE');
    // La variación es exacta: 10.7692 → +10,77 (HALF_EVEN a 2 decimales) y en inglés usa el punto decimal.
    expect(inApp('en', anomalyPlan).title).toContain('+10.77 %');
  });

  it('[TC-NOTIFICATIONS-FX-004] la tasa guardada sin ceros de relleno se presenta con al menos 2 decimales', () => {
    const plan = anomaly.plan(
      anomalyRetainedPayload({ value: '72000', baselineValue: '65000.5', variationPct: '10.7' }),
      FX_RATE_ID,
    );
    const { body } = inApp('es', plan);
    expect(body).toContain('72.000,00');
    expect(body).toContain('65.000,50');
    // Sin recortar los decimales de más.
    const fine = anomaly.plan(
      anomalyRetainedPayload({ value: '0.00001234', baselineValue: '0.00001' }),
      FX_RATE_ID,
    );
    expect(inApp('en', fine).body).toContain('0.00001234');
  });

  it('[TC-NOTIFICATIONS-FX-004] una variación negativa conserva su signo', () => {
    const plan = anomaly.plan(
      anomalyRetainedPayload({ value: '58000.00', variationPct: '-10.7692' }),
      FX_RATE_ID,
    );
    expect(inApp('es', plan).title).toContain('-10,77 %');
  });

  it('rechaza hechos mal formados (el puerto falla y la transacción de FX se revierte)', () => {
    expect(() => stale.plan(feedStalePayload({ base: 'usdt' }), EPISODE_ID)).toThrow(/base/);
    expect(() => stale.plan(feedStalePayload({ detectedAt: 'ayer' }), EPISODE_ID)).toThrow(/detectedAt/);
    expect(() => stale.plan(feedStalePayload({ timeZone: 'Mars/Base' }), EPISODE_ID)).toThrow(/timeZone/);
    expect(() => stale.plan(feedStalePayload(), 'no-uuid')).toThrow(/factKey/);
    expect(() => recovered.plan(feedRecoveredPayload({ rateId: 'x' }), EPISODE_ID)).toThrow(/rateId/);
    expect(() => anomaly.plan(anomalyRetainedPayload({ value: '7x' }), FX_RATE_ID)).toThrow(/value/);
    expect(() => anomaly.plan(anomalyRetainedPayload({ variationPct: '' }), FX_RATE_ID)).toThrow(
      /variationPct/,
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
    expect(email('es', 'basic', anomalyPlan).text).toContain('retenida');
    expect(email('es', 'basic', anomalyPlan).text).toContain('revisión');
  });

  it('[TC-NOTIFICATIONS-FX-005] con opt-in el email incluye el par y los valores', () => {
    const e = email('es', 'detailed', anomalyPlan);
    expect(e.text).toContain('BTC/USDT');
    expect(e.text).toContain('72.000,00');
    expect(e.text).toContain('65.000,00');
    expect(email('es', 'detailed', stalePlan).text).toContain('USDT/BOB');
  });
});
