import { describe, expect, it } from 'vitest';
import { closePendingPayload, occurrenceDuePayload, thresholdPayload } from './fixtures.js';
import { MESSAGE_CATALOGS, placeholdersOf } from './messages.js';
import { formatDate, formatDecimal, renderEmail, renderInApp } from './render.js';
import { definitionOf } from './type-catalog.js';
import { NOTIFICATION_LOCALES, notificationLocaleOf } from './types.js';

const thresholdPlan = definitionOf('BUDGET_THRESHOLD').plan(thresholdPayload());
const closePlan = definitionOf('MONTH_CLOSE_PENDING').plan(closePendingPayload());
const names = { targetName: 'Restaurantes' };
const links = {
  notificationUrl: 'https://app.pfos.test/notificaciones/01928c4e-0000-7000-8000-0000000aa001',
  preferencesUrl: 'https://app.pfos.test/preferencias',
};
const email = (locale: 'es' | 'en' | 'pt', variant: 'basic' | 'detailed', plan = thresholdPlan, n = names) =>
  renderEmail({ locale, variant, messageKey: plan.messageKey, params: plan.params, names: n, ...links });

/** El contenido de un email sin las URL (el id opaco del enlace puede contener cualquier secuencia hexadecimal). */
const withoutUrls = (value: string): string => value.replace(/https?:\/\/\S+/g, '');

describe('Idioma según el locale del usuario', () => {
  it('[TC-NOTIFICATIONS-I18N-002] es-*→es, en-*→en, pt-*→pt y cualquier otro (fr-FR, vacío) cae a español', () => {
    expect(notificationLocaleOf('es-BO')).toBe('es');
    expect(notificationLocaleOf('en-US')).toBe('en');
    expect(notificationLocaleOf('pt-BR')).toBe('pt');
    expect(notificationLocaleOf('fr-FR')).toBe('es');
    expect(notificationLocaleOf('')).toBe('es');
    expect(notificationLocaleOf(undefined)).toBe('es');
    expect(notificationLocaleOf('EN_gb')).toBe('en');
  });

  it('[TC-NOTIFICATIONS-I18N-001] asuntos del email en es, en y pt', () => {
    expect(email('es', 'basic').subject).toBe('Tienes una alerta de presupuesto');
    expect(email('en', 'basic').subject).toBe('You have a budget alert');
    expect(email('pt', 'basic').subject).toBe('Você tem um alerta de orçamento');
    const close = (l: 'es' | 'en' | 'pt') => email(l, 'basic', closePlan).subject;
    expect(close('es')).toBe('Tienes un mes pendiente de cierre');
    expect(close('en')).toBe('You have a month pending close');
    expect(close('pt')).toBe('Você tem um mês pendente de fechamento');
  });

  it('[TC-NOTIFICATIONS-I18N-001] el in-app se compone en el idioma pedido y cambia con el locale', () => {
    const render = (l: 'es' | 'en' | 'pt') =>
      renderInApp(l, thresholdPlan.messageKey, thresholdPlan.params, names);
    expect(render('en').title).toBe('Budget alert: Restaurantes reached 90 %');
    expect(render('pt').title).toBe('Alerta de orçamento: Restaurantes atingiu 90 %');
    expect(render('es').title).toBe('Alerta de presupuesto: Restaurantes alcanzó el 90 %');
    expect(render('en').body).toContain('550.00 of 600.00 BOB');
  });

  it('[TC-NOTIFICATIONS-INAPP-001] el in-app indica objetivo, periodo, umbral, umbrales menores y montos en formato es-BO', () => {
    const { title, body } = renderInApp('es', thresholdPlan.messageKey, thresholdPlan.params, names);
    expect(title).toContain('Restaurantes');
    expect(title).toContain('90 %');
    expect(body).toContain('2026-11');
    expect(body).toContain('550,00 de 600,00 BOB');
    expect(body).toContain('91,7 %');
    expect(body).toContain('50 % y 75 %');
  });

  it('un objetivo que ya no existe se muestra con un texto genérico y un gasto parcial se advierte', () => {
    const plan = definitionOf('BUDGET_THRESHOLD').plan(
      thresholdPayload({ actualComplete: false, alsoCrossed: [] }),
    );
    const es = renderInApp('es', plan.messageKey, plan.params, { targetName: null });
    expect(es.title).toBe('Alerta de presupuesto: una línea del presupuesto alcanzó el 90 %');
    expect(es.body).toContain('Cifra parcial');
    expect(es.body).not.toContain('También se cruzaron');
  });

  it('el cierre pendiente se compone con el periodo y su fecha de fin en el formato del locale', () => {
    const es = renderInApp('es', closePlan.messageKey, closePlan.params, { targetName: null });
    expect(es.title).toBe('El mes 2026-10 está pendiente de cierre');
    expect(es.body).toContain('31/10/2026');
    expect(renderInApp('en', closePlan.messageKey, closePlan.params, { targetName: null }).body).toContain(
      '10/31/2026',
    );
  });

  it('una clave de mensaje desconocida falla', () => {
    expect(() => renderInApp('es', 'otra.clave', {}, names)).toThrow(/unknown message key/);
  });
});

describe('Formato de montos y fechas sin float', () => {
  it('conserva la escala y agrupa miles según el locale', () => {
    expect(formatDecimal('1234567.50', 'es')).toBe('1.234.567,50');
    expect(formatDecimal('1234567.50', 'en')).toBe('1,234,567.50');
    expect(formatDecimal('1234567.50', 'pt')).toBe('1.234.567,50');
    expect(formatDecimal('0.000001', 'en')).toBe('0.000001');
    expect(formatDecimal('-12.5', 'es')).toBe('-12,5');
    expect(formatDecimal('999', 'es')).toBe('999');
    expect(formatDecimal('x', 'es')).toBe('x');
  });

  it('una cifra mayor que 2^53 no pierde dígitos', () => {
    expect(formatDecimal('12345678901234567890.12', 'en')).toBe('12,345,678,901,234,567,890.12');
  });

  it('fecha corta del locale', () => {
    expect(formatDate('2026-10-31', 'es')).toBe('31/10/2026');
    expect(formatDate('2026-10-31', 'pt')).toBe('31/10/2026');
    expect(formatDate('2026-10-31', 'en')).toBe('10/31/2026');
  });
});

describe('Privacidad del email (FR-NOTIFY-006)', () => {
  it('[TC-NOTIFICATIONS-EMAIL-001] la variante basic no contiene categoría, montos ni moneda; dice que la línea alcanzó el 90 %', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      const { subject, text, html } = email(locale, 'basic');
      for (const content of [subject, withoutUrls(text), withoutUrls(html)]) {
        for (const forbidden of ['Restaurantes', '550', '600', 'BOB', 'Alimentación']) {
          expect(content).not.toContain(forbidden);
        }
      }
      expect(text).toContain('2026-11');
      expect(text).toContain('90');
    }
    expect(email('es', 'basic').text).toContain('Una línea de tu presupuesto de 2026-11 alcanzó el 90 %.');
  });

  it('[TC-NOTIFICATIONS-EMAIL-002] con opt-in de detalles el email indica categoría, 90 % y 550,00 de 600,00 BOB', () => {
    const { text, html } = email('es', 'detailed');
    for (const content of [text, html]) {
      expect(content).toContain('Restaurantes');
      expect(content).toContain('90 %');
      expect(content).toContain('550,00 de 600,00 BOB');
    }
  });

  it('[TC-NOTIFICATIONS-EMAIL-003] el enlace es la ruta con el id opaco, sin tokens ni consultas; el pie lleva el enlace a preferencias', () => {
    const { text, html } = email('es', 'basic');
    expect(text).toContain(links.notificationUrl);
    expect(text).toContain(links.preferencesUrl);
    expect(html).toContain(`href="${links.notificationUrl}"`);
    expect(links.notificationUrl).not.toMatch(/[?#=]/);
  });

  it('el HTML escapa los valores (un nombre de categoría con marcado no inyecta etiquetas) y no carga recursos remotos', () => {
    const { html, text } = email('es', 'detailed', thresholdPlan, {
      targetName: '<script>alert(1)</script> & "Co"',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<img|<link|src=|url\(/i);
    expect(text).toContain('<script>');
  });

  it('el cierre pendiente basic no incluye la fecha de fin; detailed sí', () => {
    expect(email('es', 'basic', closePlan).text).not.toContain('31/10/2026');
    expect(email('es', 'detailed', closePlan).text).toContain('31/10/2026');
  });
});

describe('Catálogo de mensajes', () => {
  it('[TC-NOTIFICATIONS-I18N-001] toda clave existe en es, en y pt con los mismos marcadores', () => {
    const keys = Object.keys(MESSAGE_CATALOGS.es);
    for (const locale of NOTIFICATION_LOCALES) {
      expect(Object.keys(MESSAGE_CATALOGS[locale]).sort(), locale).toEqual([...keys].sort());
      for (const key of keys) {
        expect(placeholdersOf(MESSAGE_CATALOGS[locale][key] ?? ''), `${locale}:${key}`).toEqual(
          placeholdersOf(MESSAGE_CATALOGS.es[key] ?? ''),
        );
      }
    }
  });

  it('[TC-NOTIFICATIONS-EMAIL-001] las plantillas basic y los asuntos no tienen marcadores de monto, moneda ni nombre', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      for (const [key, template] of Object.entries(MESSAGE_CATALOGS[locale])) {
        if (!key.endsWith('.basic') && !key.endsWith('.subject')) continue;
        for (const forbidden of [
          'target',
          'actual',
          'reference',
          'currency',
          'utilization',
          'periodEnd',
          'name',
          'amount',
        ]) {
          expect(placeholdersOf(template), `${locale}:${key}`).not.toContain(forbidden);
        }
      }
    }
  });
});

describe('Render: ocurrencia recurrente', () => {
  const approval = definitionOf('RECURRING_APPROVAL_REQUIRED').plan(occurrenceDuePayload());
  const upcoming = definitionOf('RECURRING_PAYMENT_UPCOMING').plan(
    occurrenceDuePayload({
      requiresApproval: false,
      mode: 'NOTIFY_ONLY',
      expected: { type: 'MIN_MAX', amount: null, min: '100.00', max: '250.50' },
    }),
  );
  const variable = definitionOf('RECURRING_PAYMENT_UPCOMING').plan(
    occurrenceDuePayload({
      requiresApproval: false,
      expected: { type: 'VARIABLE', amount: null, min: null, max: null },
    }),
  );

  it('in-app muestra nombre, fecha y monto en el idioma del usuario', () => {
    const es = renderInApp('es', approval.messageKey, approval.params, names);
    expect(es.title).toBe('Por aprobar: Alquiler');
    expect(es.body).toBe('La ocurrencia del 05/11/2026 (3.500,00 BOB) espera tu aprobación.');
    expect(renderInApp('en', approval.messageKey, approval.params, names).body).toContain('11/05/2026');
    expect(renderInApp('pt', upcoming.messageKey, upcoming.params, names).body).toContain(
      '100,00 – 250,50 BOB',
    );
  });

  it('un monto variable no muestra monto', () => {
    expect(renderInApp('es', variable.messageKey, variable.params, names).body).toBe(
      'Vence el 05/11/2026. El monto es variable.',
    );
    expect(email('es', 'detailed', variable).text).toContain(
      'Alquiler vence el 05/11/2026. El monto es variable.',
    );
  });

  it('[TC-COMMITMENTS-RECUR-043] el email basic no lleva monto ni nombre, solo la fecha; detailed sí', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      const mail = email(locale, 'basic', approval);
      const basic = withoutUrls(mail.text + mail.html);
      expect(basic, locale).not.toMatch(/3[.,\s]?500/);
      expect(basic, locale).not.toContain('Alquiler');
    }
    expect(email('es', 'basic', approval).text).toContain('05/11/2026');
    expect(email('es', 'detailed', approval).text).toContain('Alquiler del 05/11/2026 (3.500,00 BOB)');
  });
});
