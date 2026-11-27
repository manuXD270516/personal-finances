import { describe, expect, it } from 'vitest';
import { WS } from './fixtures.js';
import { intakeDefinitionOf } from './intake-catalog.js';
import { MESSAGE_CATALOGS } from './messages.js';
import { defaultTypePreference } from './preferences.js';
import { renderEmail, renderInApp } from './render.js';
import { NOTIFICATION_LOCALES, NOTIFICATION_TYPES } from './types.js';

const definition = intakeDefinitionOf('SPENDING_ANOMALY');
const payload = (count = 2) => ({
  workspaceId: WS,
  passDate: '2026-11-13',
  count,
  top: {
    anomalyId: '01928c4e-0000-7000-8000-0000000a0001',
    transactionDate: '2026-11-12',
    reportingAmount: { amount: '304.00', currency: 'BOB' },
    reasons: ['CATEGORY_OUTLIER', 'COUNTERPARTY_OUTLIER'],
  },
  timeZone: 'America/La_Paz',
});
const plan = (count = 2) => definition.plan(payload(count), 'spending-anomalies:2026-11-13');

describe('Catálogo del aviso de gastos atípicos (entrega directa, desactivado por omisión)', () => {
  it('[TC-NOTIFICATIONS-ANOMALY-001] es el único tipo apagado por omisión y los demás siguen activos', () => {
    expect(NOTIFICATION_TYPES).toContain('SPENDING_ANOMALY');
    expect(defaultTypePreference('SPENDING_ANOMALY')).toEqual({ inApp: false, email: false });
    for (const type of NOTIFICATION_TYPES.filter(
      (t) => t !== 'SPENDING_ANOMALY' && t !== 'BUDGET_OVERRUN_RISK',
    )) {
      expect(defaultTypePreference(type), type).toEqual({ inApp: true, email: true });
    }
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] es de entrega directa para OWNER y EDITOR, sin consumidor ni evento', () => {
    expect(definition.recipients).toEqual(['OWNER', 'EDITOR']);
    expect(definition).not.toHaveProperty('consumer');
    expect(definition).not.toHaveProperty('event');
  });

  it('[TC-NOTIFICATIONS-ANOMALY-003] el plan se deduplica por la fecha de la pasada', () => {
    expect(plan()).toMatchObject({
      type: 'SPENDING_ANOMALY',
      severity: 'INFO',
      dedupeKey: 'SPENDING_ANOMALY:2026-11-13',
      messageKey: 'notifications.spending_anomaly.v1',
      link: { kind: 'SPENDING_ANOMALIES', periodId: WS, periodLabel: '2026-11' },
    });
  });
});

describe('Textos del aviso de gastos atípicos', () => {
  const locales = ['es', 'en', 'pt'] as const;

  it('[TC-FORECAST-ANOMALY-014] ningún texto habla de error ni de fraude, en los tres idiomas', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      for (const [key, text] of Object.entries(MESSAGE_CATALOGS[locale])) {
        if (!key.includes('spending_anomaly')) continue;
        expect(text, `${locale}:${key}`).not.toMatch(
          /\b(error|errores|erro|erros|fraude|fraud|fraudulent)\b/i,
        );
      }
    }
  });

  it('[TC-NOTIFICATIONS-ANOMALY-004] los asuntos y los textos basic no tienen marcadores de monto, motivo ni nombre', () => {
    for (const locale of locales) {
      for (const [key, text] of Object.entries(MESSAGE_CATALOGS[locale])) {
        if (!key.startsWith('email.spending_anomaly.') || key.includes('detailed')) continue;
        for (const forbidden of ['amount', 'reason', 'transactionDate', 'name', 'currency']) {
          expect(text, `${locale}:${key}`).not.toContain(`{${forbidden}}`);
        }
      }
    }
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] el texto in-app lleva el monto del mayor y el motivo, con plural en los tres idiomas', () => {
    const names = { targetName: null };
    const es = renderInApp('es', plan(2).messageKey, plan(2).params, names);
    expect(es.title).toBe('2 gastos atípicos para revisar');
    expect(es.body).toContain('304,00 BOB el 12/11/2026');
    expect(es.body).toContain(
      'muy por encima de lo habitual en su categoría y muy por encima de lo habitual con su contraparte',
    );
    expect(renderInApp('es', plan(1).messageKey, plan(1).params, names).title).toBe(
      'Un gasto atípico para revisar',
    );
    expect(renderInApp('en', plan(1).messageKey, plan(1).params, names).title).toBe(
      'An unusual expense to review',
    );
    expect(renderInApp('pt', plan(2).messageKey, plan(2).params, names).title).toBe(
      '2 despesas atípicas para revisar',
    );
  });

  it('[TC-NOTIFICATIONS-ANOMALY-004] el email basic no menciona el monto ni el motivo', () => {
    const mail = renderEmail({
      locale: 'es',
      variant: 'basic',
      messageKey: plan().messageKey,
      params: plan().params,
      names: { targetName: null },
      notificationUrl: 'https://app.pfos.test/notificaciones/x',
      preferencesUrl: 'https://app.pfos.test/preferencias',
    });
    expect(mail.text).toContain('El 13/11/2026 se detectaron 2 gastos atípicos nuevos.');
    expect(mail.text).not.toContain('304');
    expect(mail.text).not.toContain('habitual');
  });
});
