import { describe, expect, it } from 'vitest';
import { cardPaymentDuePayload, cardUtilizationPayload } from './fixtures.js';
import { MESSAGE_CATALOGS, placeholdersOf } from './messages.js';
import { renderEmail, renderInApp, trimDecimalZeros } from './render.js';
import { definitionOf } from './type-catalog.js';
import { NOTIFICATION_LOCALES, notificationLocaleOf } from './types.js';

const due = definitionOf('CARD_PAYMENT_DUE').plan(cardPaymentDuePayload());
const utilization = definitionOf('CARD_UTILIZATION').plan(cardUtilizationPayload());
const names = { targetName: null };
const links = {
  notificationUrl: 'https://app.pfos.test/notificaciones/01928c4e-0000-7000-8000-0000000aa001',
  preferencesUrl: 'https://app.pfos.test/preferencias',
};

describe('Render: tarjetas de crédito', () => {
  it('[TC-DEBT-CARD-037] el vencimiento se renderiza en inglés con la fecha en formato inglés', () => {
    const en = renderInApp(notificationLocaleOf('en-US'), due.messageKey, due.params, names);
    expect(en.title).toBe('Visa Oro (BOB) due on 11/15/2026');
    expect(en.body).toBe(
      'To avoid interest you still need to pay 1,120.50 BOB; the minimum payment still due is 56.02 BOB.',
    );
  });

  it('[TC-DEBT-CARD-037] español (formato es-BO) y portugués (pt-BR)', () => {
    const es = renderInApp('es', due.messageKey, due.params, names);
    expect(es.title).toBe('Vencimiento de Visa Oro (BOB): 15/11/2026');
    expect(es.body).toBe(
      'Para no pagar intereses faltan 1.120,50 BOB; el pago mínimo pendiente es 56,02 BOB.',
    );
    const pt = renderInApp('pt', due.messageKey, due.params, names);
    expect(pt.title).toBe('Vencimento de Visa Oro (BOB): 15/11/2026');
  });

  it('[TC-DEBT-CARD-037] un locale no soportado cae a español', () => {
    const locale = notificationLocaleOf('fr-FR');
    expect(renderInApp(locale, due.messageKey, due.params, names).title).toBe(
      'Vencimiento de Visa Oro (BOB): 15/11/2026',
    );
  });

  it('[TC-DEBT-CARD-035] "Visa Oro alcanzó el 80 % de su límite" con el umbral más alto y la utilización formateada', () => {
    const es = renderInApp('es', utilization.messageKey, utilization.params, names);
    expect(es.title).toBe('Visa Oro alcanzó el 80 % de su límite');
    expect(es.body).toBe('Utilización actual: 85,00 % (850,00 USD de 1.000,00 USD).');
    const en = renderInApp('en', utilization.messageKey, utilization.params, names);
    expect(en.title).toBe('Visa Oro reached 80 % of its limit');
    expect(en.body).toBe('Current utilization: 85.00 % (850.00 USD of 1,000.00 USD).');
    expect(renderInApp('pt', utilization.messageKey, utilization.params, names).title).toBe(
      'Visa Oro atingiu 80 % do limite',
    );
  });

  it('[TC-DEBT-CARD-035] el umbral conserva su parte fraccionaria sin ceros sobrantes', () => {
    expect(trimDecimalZeros('80.00')).toBe('80');
    expect(trimDecimalZeros('12.50')).toBe('12.5');
    expect(trimDecimalZeros('100.00')).toBe('100');
    expect(trimDecimalZeros('90')).toBe('90');
  });

  it('[TC-DEBT-CARD-034] el email basic de vencimiento no lleva nombre, moneda ni montos; detailed sí', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      const basic = renderEmail({
        locale,
        variant: 'basic',
        messageKey: due.messageKey,
        params: due.params,
        names,
        ...links,
      });
      const content = (basic.subject + basic.text + basic.html).replace(/https?:\/\/\S+/g, '');
      for (const leak of ['Visa Oro', 'BOB', '1120', '1.120', '1,120', '56']) {
        expect(content, `${locale} ${leak}`).not.toContain(leak);
      }
    }
    const detailed = renderEmail({
      locale: 'en',
      variant: 'detailed',
      messageKey: due.messageKey,
      params: due.params,
      names,
      ...links,
    });
    expect(detailed.text).toContain(
      'The statement of Visa Oro (BOB) is due on 11/15/2026: 1,120.50 BOB left to avoid interest.',
    );
  });

  it('[TC-DEBT-CARD-037] toda clave de tarjeta existe en es, en y pt con los mismos marcadores', () => {
    const keys = Object.keys(MESSAGE_CATALOGS.es).filter((k) => k.includes('.card_'));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) {
      for (const locale of ['en', 'pt'] as const) {
        const text = MESSAGE_CATALOGS[locale][key];
        expect(text, `${locale} ${key}`).toBeDefined();
        expect(placeholdersOf(text as string), `${locale} ${key}`).toEqual(
          placeholdersOf(MESSAGE_CATALOGS.es[key] as string),
        );
      }
    }
  });
});
