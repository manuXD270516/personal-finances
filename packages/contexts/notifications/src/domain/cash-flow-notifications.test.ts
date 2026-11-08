import { describe, expect, it } from 'vitest';
import { SHORTFALL_EPISODE_ID, shortfallPayload } from './fixtures.js';
import { intakeDefinitionOf } from './intake-catalog.js';
import { renderEmail, renderInApp } from './render.js';
import { NOTIFICATION_TYPES } from './types.js';

const definition = intakeDefinitionOf('CASH_FLOW_SHORTFALL_RISK');
const plan = definition.plan(shortfallPayload(), SHORTFALL_EPISODE_ID);
const names = { targetName: null };
const links = {
  notificationUrl: 'https://app.pfos.test/notificaciones/01928c4e-0000-7000-8000-0000000aa001',
  preferencesUrl: 'https://app.pfos.test/preferencias',
};
type Locale = 'es' | 'en' | 'pt';
const email = (locale: Locale, variant: 'basic' | 'detailed') =>
  renderEmail({
    locale,
    variant,
    messageKey: plan.messageKey,
    params: plan.params,
    names,
    ...links,
  });

describe('Catálogo del riesgo de déficit (entrega directa, sin consumidor de eventos)', () => {
  it('[TC-NOTIFICATIONS-SHORTFALL-001] es un tipo de entrega directa para OWNER y EDITOR, sin consumidor ni evento', () => {
    expect(NOTIFICATION_TYPES).toContain('CASH_FLOW_SHORTFALL_RISK');
    expect(definition.recipients).toEqual(['OWNER', 'EDITOR']);
    expect(definition).not.toHaveProperty('consumer');
    expect(definition).not.toHaveProperty('event');
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-001] el plan es crítico bajo cero y advertencia sobre cero, deduplicado por episodio', () => {
    expect(plan).toMatchObject({
      severity: 'CRITICAL',
      dedupeKey: `CASH_FLOW_SHORTFALL_RISK:${SHORTFALL_EPISODE_ID}`,
      messageKey: 'notifications.cash_flow_shortfall_risk.v1',
    });
    const warning = definition.plan(
      shortfallPayload({ lowest: { amount: '621.00', currency: 'BOB' }, belowZero: false }),
      SHORTFALL_EPISODE_ID,
    );
    expect(warning.severity).toBe('WARNING');
  });
});

describe('Render del riesgo de déficit', () => {
  it('[TC-NOTIFICATIONS-SHORTFALL-003] el email sin opt-in lleva moneda, fecha y enlace, y ningún monto, umbral ni cuenta', () => {
    const basic = email('es', 'basic');
    const everything = `${basic.subject}\n${basic.text}\n${basic.html}`;
    expect(everything).toContain('BOB');
    expect(everything).toContain('01/11/2026');
    expect(everything).toContain(links.notificationUrl);
    expect(everything).not.toMatch(/679/);
    expect(everything).not.toMatch(/1[.,]?500/);
    expect(everything).not.toContain('Banco BOB');
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-003] con opt-in el email muestra además el saldo más bajo y el umbral', () => {
    const detailed = email('es', 'detailed');
    expect(detailed.text).toContain('-679,00 BOB');
    expect(detailed.text).toContain('1.500,00 BOB');
    expect(detailed.text).toContain('01/11/2026');
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-004] en inglés (en-US) la notificación y el email usan la fecha 11/01/2026', () => {
    const inApp = renderInApp('en', plan.messageKey, plan.params, names);
    expect(inApp.title).toBe('Shortfall risk in BOB from 11/01/2026');
    expect(inApp.body).toContain('11/01/2026');
    expect(inApp.body).toContain('The balance would be negative.');
    const basic = email('en', 'basic');
    expect(basic.subject).toBe('Shortfall risk in your cash flow');
    expect(basic.text).toContain('11/01/2026');
    expect(basic.text).not.toMatch(/679/);
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-004] en portugués y con locale no soportado cae a español', () => {
    expect(renderInApp('pt', plan.messageKey, plan.params, names).title).toBe(
      'Risco de déficit em BOB a partir de 01/11/2026',
    );
    expect(renderInApp('es', plan.messageKey, plan.params, names).title).toBe(
      'Riesgo de déficit en BOB desde el 01/11/2026',
    );
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-001] el aviso solo bajo la reserva no dice que el saldo sea negativo', () => {
    const warning = definition.plan(
      shortfallPayload({ lowest: { amount: '621.00', currency: 'BOB' }, belowZero: false }),
      SHORTFALL_EPISODE_ID,
    );
    expect(renderInApp('es', warning.messageKey, warning.params, names).body).not.toContain('negativo');
  });
});
