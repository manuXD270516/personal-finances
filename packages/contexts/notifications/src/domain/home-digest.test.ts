import { describe, expect, it } from 'vitest';
import {
  buildDigestParams,
  currentDigestWindow,
  digestDedupeKey,
  financialPeriodStart,
  isoWeek,
  localClock,
  type DigestInput,
} from './home-digest.js';
import { renderHomeDigestEmail } from './home-digest-render.js';
import { renderInApp } from './render.js';
import { HOME_DIGEST_MESSAGE_KEY } from './home-digest.js';
import { notificationLocaleOf, type NotificationLocale } from './types.js';

const LA_PAZ = { timeZone: 'America/La_Paz', fiscalMonthStartDay: 1 };
/** 08:05 en La Paz (UTC-4) es 12:05Z. */
const at = (iso: string): Date => new Date(iso);

/** Digest del Home con datos de ejemplo (TC-NOTIFICATIONS-DIGEST-004): 3 pagos, 41.5 %, riesgo alto, disponible 5521.00 BOB. */
const digest = (overrides: Partial<DigestInput> = {}): DigestInput => {
  const money = (amount: string) => ({ amount, currency: 'BOB' });
  const base = {
    counts: {},
    percents: {},
    dates: {},
    states: {},
    amounts: {},
  };
  return {
    today: '2026-11-02',
    timeZone: 'America/La_Paz',
    reportingCurrency: 'BOB',
    questions: [
      { ...base, question: 'Q1', status: 'AVAILABLE', amounts: { liquid: money('15800.00') } },
      {
        ...base,
        question: 'Q2',
        status: 'AVAILABLE',
        percents: { incomeChange: '3.20' },
        amounts: { income: money('8000.00') },
      },
      {
        ...base,
        question: 'Q3',
        status: 'AVAILABLE',
        percents: { expenseChange: '-12.50' },
        amounts: { expense: money('4300.00') },
      },
      { ...base, question: 'Q4', status: 'AVAILABLE', amounts: { committed: money('3179.00') } },
      {
        ...base,
        question: 'Q5',
        status: 'AVAILABLE',
        states: { spendableSign: 'POSITIVE' },
        amounts: { spendable: money('5521.00') },
      },
      {
        ...base,
        question: 'Q6',
        status: 'AVAILABLE',
        percents: { savingsRate: '41.5' },
        amounts: { savings: money('3700.00') },
      },
      { ...base, question: 'Q7', status: 'AVAILABLE', percents: { incomeChange: '3.20' } },
      {
        ...base,
        question: 'Q8',
        status: 'AVAILABLE',
        counts: { upcoming7d: 3, overdue: 0 },
        dates: { firstShortfall: '2026-11-15' },
        states: { risk: 'HIGH', riskCurrency: 'BOB' },
        amounts: { lowestBalance: money('-679.00') },
      },
      { ...base, question: 'Q9', status: 'NO_DATA' },
    ],
    ...overrides,
  };
};
const window = { frequency: 'WEEKLY', key: '2026-W45' } as const;

describe('Ventanas del digest', () => {
  it('[TC-NOTIFICATIONS-DIGEST-006] la semana ISO del lunes 2026-11-02 es 2026-W45 y la del 2026-11-09 es 2026-W46', () => {
    expect(isoWeek('2026-11-02')).toEqual({ year: 2026, week: 45, monday: '2026-11-02' });
    expect(isoWeek('2026-11-08')).toMatchObject({ week: 45, monday: '2026-11-02' });
    expect(isoWeek('2026-11-09')).toMatchObject({ week: 46 });
    // El jueves fija el año: el 2027-01-01 (viernes) cae en la semana 53 de 2026.
    expect(isoWeek('2027-01-01')).toMatchObject({ year: 2026, week: 53 });
  });

  it('[TC-NOTIFICATIONS-DIGEST-002] el digest semanal sale desde el lunes 08:00 en la zona del workspace', () => {
    expect(currentDigestWindow('WEEKLY', at('2026-11-02T11:59:00Z'), LA_PAZ)).toBeNull();
    expect(currentDigestWindow('WEEKLY', at('2026-11-02T12:05:00Z'), LA_PAZ)).toEqual({
      frequency: 'WEEKLY',
      key: '2026-W45',
      startsOn: '2026-11-02',
    });
    expect(digestDedupeKey({ frequency: 'WEEKLY', key: '2026-W45' })).toBe('HOME_DIGEST:WEEKLY:2026-W45');
  });

  it('[TC-NOTIFICATIONS-DIGEST-002] el lunes a las 23:30 de La Paz (03:30Z del martes) sigue en la semana W45, no en UTC', () => {
    expect(currentDigestWindow('WEEKLY', at('2026-11-03T03:30:00Z'), LA_PAZ)?.key).toBe('2026-W45');
    // El domingo a las 22:00 de La Paz (02:00Z del lunes) todavía es la semana anterior.
    expect(currentDigestWindow('WEEKLY', at('2026-11-02T02:00:00Z'), LA_PAZ)?.key).toBe('2026-W44');
  });

  it('[TC-NOTIFICATIONS-DIGEST-006] un digest no enviado se recupera dentro de la misma semana y la semana siguiente es otra ventana', () => {
    expect(currentDigestWindow('WEEKLY', at('2026-11-04T14:00:00Z'), LA_PAZ)?.key).toBe('2026-W45');
    expect(currentDigestWindow('WEEKLY', at('2026-11-09T12:05:00Z'), LA_PAZ)?.key).toBe('2026-W46');
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] el digest mensual sigue el periodo financiero: con día de inicio 25 sale el 2026-10-25 y no abre otro el 2026-11-01', () => {
    const start25 = { timeZone: 'America/La_Paz', fiscalMonthStartDay: 25 };
    expect(currentDigestWindow('MONTHLY', at('2026-10-25T12:05:00Z'), start25)).toEqual({
      frequency: 'MONTHLY',
      key: '2026-10',
      startsOn: '2026-10-25',
    });
    expect(currentDigestWindow('MONTHLY', at('2026-11-01T12:05:00Z'), start25)?.key).toBe('2026-10');
    expect(currentDigestWindow('MONTHLY', at('2026-11-25T12:05:00Z'), start25)?.key).toBe('2026-11');
    expect(currentDigestWindow('MONTHLY', at('2026-10-25T11:00:00Z'), start25)).toBeNull();
    expect(financialPeriodStart('2026-01-10', 25)).toBe('2025-12-25');
  });

  it('con la frecuencia desactivada no hay ventana', () => {
    expect(currentDigestWindow('OFF', at('2026-11-02T12:05:00Z'), LA_PAZ)).toBeNull();
  });

  it('la hora local sale de la zona IANA, no de la del servidor', () => {
    expect(localClock(at('2026-11-02T12:05:00Z'), 'America/La_Paz')).toEqual({
      date: '2026-11-02',
      minutes: 8 * 60 + 5,
    });
  });
});

describe('Contenido guardado del digest', () => {
  it('[TC-NOTIFICATIONS-DIGEST-004] sin opt-in no se guarda ningún monto, aunque REPORTING los entregue', () => {
    const params = buildDigestParams({ digest: digest(), window, includeDetails: false });
    expect(JSON.stringify(params)).not.toMatch(/amount/i);
    expect(JSON.stringify(params)).not.toMatch(/\b5521\b/);
    expect(params).toMatchObject({ frequency: 'WEEKLY', windowKey: '2026-W45', includeDetails: false });
  });

  it('[TC-NOTIFICATIONS-DIGEST-004] con opt-in se guardan los montos consolidados', () => {
    const params = buildDigestParams({ digest: digest(), window, includeDetails: true });
    expect(JSON.stringify(params)).toContain('"5521.00"');
  });

  it('solo se guardan las claves conocidas: un nombre de cuenta o de meta nunca llega a los parámetros', () => {
    const noisy = digest({
      questions: [
        {
          question: 'Q1',
          status: 'AVAILABLE',
          counts: { upcoming7d: 3 },
          percents: {},
          dates: {},
          states: { accountName: 'Banco BOB' } as Record<string, string>,
          amounts: {},
        },
      ],
    });
    const params = buildDigestParams({ digest: noisy, window, includeDetails: true });
    expect(JSON.stringify(params)).not.toContain('Banco BOB');
  });
});

describe('Render del digest', () => {
  const render = (locale: NotificationLocale, includeDetails: boolean, variant: 'basic' | 'detailed') =>
    renderHomeDigestEmail({
      locale,
      variant,
      params: buildDigestParams({ digest: digest(), window, includeDetails }),
      homeUrl: 'https://app.pfos.test/',
      preferencesUrl: 'https://app.pfos.test/preferencias',
    });

  it('[TC-NOTIFICATIONS-DIGEST-004] sin opt-in resume con cantidades, porcentajes, estados y fechas, sin ningún monto', () => {
    const { text, html, subject } = render('es', false, 'basic');
    expect(text).toContain('3 pagos en los próximos 7 días');
    expect(text).toContain('Tasa de ahorro: 41,5 %');
    expect(text).toContain('Riesgo de déficit alto en BOB desde el 15/11/2026');
    expect(text).toContain('Disponible para gastar: positivo');
    expect(text).toContain('Aún no tienes metas.');
    for (const output of [text, html, subject]) {
      expect(output).not.toMatch(/\b5521\b/);
      expect(output).not.toMatch(/\b15800\b|\b15\.800\b|\b8000\b|\b8\.000\b|\b679\b/);
      expect(output).not.toMatch(/BOB\b.*\d{3}[.,]\d{2}/);
    }
    // Q9 sin metas no inventa un 0 %.
    expect(text).not.toMatch(/\b0 %/);
  });

  it('[TC-NOTIFICATIONS-DIGEST-004] con opt-in muestra además el disponible para gastar y los montos de las demás preguntas', () => {
    const { text } = render('es', true, 'detailed');
    expect(text).toContain('Disponible para gastar: 5.521,00 BOB');
    expect(text).toContain('Dinero disponible: 15.800,00 BOB');
    expect(text).toContain('Comprometido: 3.179,00 BOB');
    expect(text).toContain('Saldo más bajo esperado: -679,00 BOB');
    expect(text).toContain('Tasa de ahorro: 41,5 %');
  });

  it('el variante detallado sin montos guardados (opt-in retirado) tampoco los inventa', () => {
    expect(render('es', false, 'detailed').text).not.toMatch(/\b5\.521\b/);
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] una pregunta sin datos se indica como tal y la de metas dice que no hay metas', () => {
    const { text } = render('es', false, 'basic');
    expect(text).toMatch(/Metas\n- Aún no tienes metas\./);
  });

  it('[TC-NOTIFICATIONS-DIGEST-008] en portugués usa el idioma y la fecha del locale; fr-FR cae a español en la capa de idioma', () => {
    const pt = render('pt', false, 'basic');
    expect(pt.text).toContain('3 pagamentos nos próximos 7 dias');
    expect(pt.text).toContain('Risco de déficit alto em BOB a partir de 15/11/2026');
    expect(pt.subject).toBe('Seu resumo financeiro do PFOS');
    const en = render('en', false, 'basic');
    expect(en.text).toContain('High shortfall risk in BOB from 11/15/2026');
    expect(en.text).toContain('Savings rate: 41.5 %');
  });

  it('[TC-NOTIFICATIONS-DIGEST-008] fr-FR cae a español y pt-BR usa portugués al elegir el idioma del destinatario', () => {
    expect(notificationLocaleOf('fr-FR')).toBe('es');
    expect(notificationLocaleOf('pt-BR')).toBe('pt');
    const fallback = render(notificationLocaleOf('fr-FR'), false, 'basic');
    expect(fallback.subject).toBe('Tu resumen financiero de PFOS');
    expect(fallback.text).toContain('Pagos próximos');
  });

  it('el digest archivado se puede renderizar en la bandeja sin lanzar', () => {
    const params = buildDigestParams({ digest: digest(), window, includeDetails: false });
    expect(renderInApp('es', HOME_DIGEST_MESSAGE_KEY, params, { targetName: null }).title).toBe(
      'Tu resumen financiero',
    );
  });
});
