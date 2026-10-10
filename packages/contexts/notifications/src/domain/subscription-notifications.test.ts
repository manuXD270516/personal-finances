import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_ID,
  SUBSCRIPTION_ID,
  priceChangedPayload,
  renewalPayload,
  trialEndingPayload,
} from './fixtures.js';
import { renderEmail, renderInApp } from './render.js';
import { definitionForConsumer, definitionOf } from './type-catalog.js';
import { NOTIFICATION_LOCALES } from './types.js';

const renewal = definitionOf('SUBSCRIPTION_RENEWAL');
const trial = definitionOf('SUBSCRIPTION_TRIAL_ENDING');
const priceChange = definitionOf('SUBSCRIPTION_PRICE_CHANGE');
const names = { targetName: null };

const email = (
  locale: (typeof NOTIFICATION_LOCALES)[number],
  variant: 'basic' | 'detailed',
  plan: { messageKey: string; params: never },
) =>
  renderEmail({
    locale,
    variant,
    messageKey: plan.messageKey,
    params: plan.params,
    names,
    notificationUrl: 'https://app.pfos.test/notificaciones/abc',
    preferencesUrl: 'https://app.pfos.test/preferencias',
  });

describe('Catálogo: tipos de suscripciones', () => {
  it('[TC-COMMITMENTS-SUBS-030] la renovación se traduce con su clave de deduplicación por suscripción y fecha', () => {
    const plan = renewal.plan(renewalPayload());
    expect(plan).toMatchObject({
      type: 'SUBSCRIPTION_RENEWAL',
      severity: 'INFO',
      dedupeKey: `subscription-renewal:${SUBSCRIPTION_ID}:2026-11-15`,
      link: { kind: 'SUBSCRIPTION', subscriptionId: SUBSCRIPTION_ID, periodLabel: '2026-11' },
    });
    expect(plan.params).toMatchObject({
      providerName: 'Streamly',
      planName: 'Premium',
      renewalDate: '2026-11-15',
      expectedPrice: { amount: '10.99', currency: 'USD' },
      paymentAccountName: 'Visa USD',
    });
    // otra fecha de renovación es otro hecho; el mismo hecho con otro identificador de evento, no
    expect(renewal.plan(renewalPayload({ renewalDate: '2026-12-15' })).dedupeKey).not.toBe(plan.dedupeKey);
    expect(renewal.plan(renewalPayload()).dedupeKey).toBe(plan.dedupeKey);
    expect(renewal.recipients).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(renewal.event).toEqual({ type: 'commitments.SubscriptionRenewalUpcoming', version: 1 });
    expect(definitionForConsumer('notifications.subscription-renewal')?.type).toBe('SUBSCRIPTION_RENEWAL');
  });

  it('[TC-COMMITMENTS-SUBS-031] el fin de trial es WARNING para todos los miembros y deduplica por fecha de fin', () => {
    const plan = trial.plan(trialEndingPayload());
    expect(plan).toMatchObject({
      type: 'SUBSCRIPTION_TRIAL_ENDING',
      severity: 'WARNING',
      dedupeKey: `subscription-trial:${SUBSCRIPTION_ID}:2026-11-20`,
    });
    expect(trial.recipients).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(definitionForConsumer('notifications.subscription-trial-ending')?.type).toBe(
      'SUBSCRIPTION_TRIAL_ENDING',
    );
  });

  it('[TC-COMMITMENTS-SUBS-032] el cambio de precio detectado va a OWNER y EDITOR con enlace a la propuesta; el manual se descarta', () => {
    const plan = priceChange.plan(priceChangedPayload());
    expect(plan).toMatchObject({
      type: 'SUBSCRIPTION_PRICE_CHANGE',
      severity: 'WARNING',
      dedupeKey: `subscription-price:${SUBSCRIPTION_ID}:2026-11-05`,
      link: { kind: 'SUBSCRIPTION', subscriptionId: SUBSCRIPTION_ID, proposalId: PROPOSAL_ID },
    });
    expect(priceChange.recipients).toEqual(['OWNER', 'EDITOR']);
    expect(priceChange.suppressed?.(priceChangedPayload())).toBe(false);
    expect(priceChange.suppressed?.(priceChangedPayload({ origin: 'MANUAL', proposalId: null }))).toBe(true);
    expect(priceChange.suppressed?.(priceChangedPayload({ origin: 'CORRECTION', proposalId: null }))).toBe(
      true,
    );
    // un hecho manual sigue siendo un payload válido (sin enlace a propuesta)
    expect(priceChange.plan(priceChangedPayload({ origin: 'MANUAL', proposalId: null })).link).toEqual({
      kind: 'SUBSCRIPTION',
      subscriptionId: SUBSCRIPTION_ID,
      periodId: SUBSCRIPTION_ID,
      periodLabel: '2026-11',
    });
  });

  it('rechaza un payload mal formado (el consumidor falla y el evento termina en dead-letter)', () => {
    expect(() => renewal.plan(renewalPayload({ renewalDate: '15/11/2026' }))).toThrow();
    expect(() =>
      renewal.plan(renewalPayload({ expectedPrice: { amount: 10.99, currency: 'USD' } })),
    ).toThrow();
    expect(() => renewal.plan(renewalPayload({ daysBefore: 0 }))).toThrow();
    expect(() => trial.plan(trialEndingPayload({ providerName: '' }))).toThrow();
    expect(() => priceChange.plan(priceChangedPayload({ changePercentage: '20.02' }))).toThrow();
    expect(() => priceChange.plan(priceChangedPayload({ origin: 'MAGIC' }))).toThrow();
  });
});

describe('Render: suscripciones', () => {
  const renewalPlan = renewal.plan(renewalPayload());
  const trialPlan = trial.plan(trialEndingPayload());
  const pricePlan = priceChange.plan(priceChangedPayload());

  it('[TC-COMMITMENTS-SUBS-030] in-app muestra provider, plan, fecha, precio y cuenta de pago', () => {
    const es = renderInApp('es', renewalPlan.messageKey, renewalPlan.params, names);
    expect(es.title).toBe('Renovación próxima: Streamly');
    expect(es.body).toBe('Plan Premium. Se renueva el 15/11/2026 por 10,99 USD. Cuenta de pago: Visa USD.');
    const en = renderInApp('en', renewalPlan.messageKey, renewalPlan.params, names);
    expect(en.body).toBe('Plan Premium. Renews on 11/15/2026 for 10.99 USD. Payment account: Visa USD.');
  });

  it('[TC-COMMITMENTS-SUBS-030] indica el cargo estimado en la moneda de la cuenta y si requiere aprobación', () => {
    const plan = renewal.plan(
      renewalPayload({
        planName: null,
        expectedCharge: { amount: '107.70', currency: 'BOB' },
        paymentAccountName: 'Visa BOB',
        requiresApproval: true,
      }),
    );
    expect(renderInApp('es', plan.messageKey, plan.params, names).body).toBe(
      'Se renueva el 15/11/2026 por 10,99 USD. Cuenta de pago: Visa BOB. Cargo estimado: 107,70 BOB. Requiere tu aprobación.',
    );
  });

  it('[TC-COMMITMENTS-SUBS-031] el fin de trial muestra provider, fecha y precio del primer cobro', () => {
    const es = renderInApp('es', trialPlan.messageKey, trialPlan.params, names);
    expect(es.title).toBe('El trial de CloudDrive termina el 20/11/2026; primer cobro 99,99 USD');
    expect(es.body).toContain('Visa USD');
    expect(renderInApp('en', trialPlan.messageKey, trialPlan.params, names).title).toBe(
      'The CloudDrive trial ends on 11/20/2026; first charge 99.99 USD',
    );
  });

  it('[TC-COMMITMENTS-SUBS-032] el cambio de precio muestra precio anterior, observado y variación', () => {
    const es = renderInApp('es', pricePlan.messageKey, pricePlan.params, names);
    expect(es.title).toBe('Posible cambio de precio: MusicBox');
    expect(es.body).toBe(
      'El precio pasó de 9,99 USD a 11,99 USD (+20,02 %) desde el 05/11/2026. Acepta o rechaza la propuesta.',
    );
    const negative = priceChange.plan(priceChangedPayload({ changePercentage: '-3.50' }));
    expect(renderInApp('en', negative.messageKey, negative.params, names).body).toContain('(-3.50 %)');
  });

  it('[TC-COMMITMENTS-SUBS-033] el email basic no lleva provider, plan, cuenta, monto ni moneda; detailed sí', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      for (const plan of [renewalPlan, trialPlan, pricePlan]) {
        const mail = email(locale, 'basic', plan as never);
        const content = (mail.subject + mail.text + mail.html).replaceAll(/https?:\/\/\S+/g, '');
        for (const leak of [
          'Streamly',
          'Premium',
          'CloudDrive',
          'MusicBox',
          'Visa',
          '10.99',
          '10,99',
          '99,99',
          'USD',
        ]) {
          expect(content, `${locale}:${plan.type}:${leak}`).not.toContain(leak);
        }
      }
    }
    expect(email('es', 'basic', renewalPlan as never).text).toContain(
      'Una de tus suscripciones se renueva en 3 días.',
    );
    const detailed = email('es', 'detailed', renewalPlan as never).text;
    expect(detailed).toContain('Streamly');
    expect(detailed).toContain('15/11/2026');
    expect(detailed).toContain('10,99 USD');
    expect(email('es', 'detailed', trialPlan as never).text).toContain('CloudDrive');
    expect(email('es', 'detailed', pricePlan as never).text).toContain('+20,02');
  });

  it('[TC-COMMITMENTS-SUBS-034] los textos existen en inglés y portugués con el formato del locale', () => {
    expect(email('en', 'basic', renewalPlan as never).subject).toBe(
      'You have an upcoming subscription renewal',
    );
    expect(email('pt', 'basic', pricePlan as never).subject).toBe('Detectamos uma possível mudança de preço');
    expect(email('pt', 'detailed', renewalPlan as never).text).toContain(
      'Streamly renova em 15/11/2026: 10,99 USD',
    );
    expect(email('en', 'detailed', renewalPlan as never).text).toContain(
      'Streamly renews on 11/15/2026: 10.99 USD with Visa USD.',
    );
    expect(email('es', 'basic', trialPlan as never).subject).toBe('Tienes un trial por terminar');
  });
});
