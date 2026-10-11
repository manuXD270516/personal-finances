import { describe, expect, it } from 'vitest';
import {
  contributionRecordedPayload,
  earmarkExceedsPayload,
  EMERGENCY_GOAL_ID,
  GOAL_ACCOUNT_ID,
  GOAL_EPISODE_ID,
  goalReachedPayload,
  LAPTOP_GOAL_ID,
} from './fixtures.js';
import { MESSAGE_CATALOGS, placeholdersOf } from './messages.js';
import { renderEmail, renderInApp } from './render.js';
import { crossedMilestones, definitionOf, type NotificationPlan } from './type-catalog.js';
import { notificationLocaleOf, type NotificationLocale } from './types.js';

const overAllocated = definitionOf('GOAL_OVER_ALLOCATED');
const reached = definitionOf('GOAL_REACHED');
const milestone = definitionOf('GOAL_MILESTONE');
const names = { targetName: null };
const links = {
  notificationUrl: 'https://app.pfos.test/notificaciones/01928c4e-0000-7000-8000-0000000aa001',
  preferencesUrl: 'https://app.pfos.test/preferencias',
};
/** Palabra completa (límites de letra/dígito): los números sueltos aparecen en ids y marcas de tiempo. */
const wholeWord = (word: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u');

describe('Catálogo: metas de ahorro', () => {
  it('[TC-GOALS-SAVINGS-042] sobre-asignación: OWNER y EDITOR, clave (cuenta, episodio) y enlace a las reservas', () => {
    expect(overAllocated.recipients).toEqual(['OWNER', 'EDITOR']);
    expect(overAllocated.event).toEqual({ type: 'goals.EarmarkExceedsBalance', version: 1 });
    const plan = overAllocated.plan(earmarkExceedsPayload());
    expect(plan).toMatchObject({
      type: 'GOAL_OVER_ALLOCATED',
      dedupeKey: `goal-over-allocated:${GOAL_ACCOUNT_ID}:${GOAL_EPISODE_ID}`,
      severity: 'WARNING',
      link: { kind: 'GOAL_RESERVATIONS', accountId: GOAL_ACCOUNT_ID },
      params: { accountName: 'Banco BOB', shortfall: { amount: '1200.00', currency: 'BOB' } },
    });
    expect(plan.params['goals']).toHaveLength(2);
  });

  it('[TC-GOALS-SAVINGS-042] meta alcanzada y hitos: todos los miembros activos', () => {
    expect(reached.recipients).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(milestone.recipients).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(milestone.event).toEqual({ type: 'goals.SavingsContributionRecorded', version: 1 });
    expect(reached.event).toEqual({ type: 'goals.GoalReached', version: 1 });
  });

  it('[TC-GOALS-SAVINGS-042] la meta alcanzada se deduplica por (meta, versión del agregado) y enlaza a la meta', () => {
    const a = reached.plan(goalReachedPayload(), { aggregateVersion: 7 });
    expect(a.dedupeKey).toBe(`goal-reached:${LAPTOP_GOAL_ID}:7`);
    expect(a.link).toMatchObject({ kind: 'GOAL', goalId: LAPTOP_GOAL_ID });
    expect(reached.plan(goalReachedPayload(), { aggregateVersion: 9 }).dedupeKey).not.toBe(a.dedupeKey);
    expect(() => reached.plan(goalReachedPayload(), { aggregateVersion: 0 })).toThrow(/aggregateVersion/);
  });

  it('lectura defensiva: un payload malformado lanza un error de validación', () => {
    expect(() => overAllocated.plan(earmarkExceedsPayload({ episodeId: 'x' }))).toThrow(/episodeId/);
    expect(() => overAllocated.plan(earmarkExceedsPayload({ goals: 'x' }))).toThrow(/goals/);
    expect(() => overAllocated.plan(earmarkExceedsPayload({ goals: [null] }))).toThrow(/goals/);
    expect(() =>
      overAllocated.plan(earmarkExceedsPayload({ shortfall: { amount: '1x', currency: 'BOB' } })),
    ).toThrow(/amount/);
    expect(() => reached.plan(goalReachedPayload({ reachedOn: '20/10/2026' }))).toThrow(/reachedOn/);
    expect(() => reached.plan(null)).toThrow(/payload/);
    expect(() => milestone.plan(contributionRecordedPayload({ percentAfter: 'mucho' }))).toThrow(
      /percentAfter/,
    );
    expect(() => milestone.plan(contributionRecordedPayload({ progressComplete: 'si' }))).toThrow(
      /progressComplete/,
    );
    expect(() => milestone.suppressed?.(undefined)).toThrow(/payload/);
  });
});

describe('Hitos 25/50/75 %', () => {
  const suppressed = (o: Record<string, unknown>): boolean | undefined =>
    milestone.suppressed?.(contributionRecordedPayload(o));

  it('[TC-GOALS-SAVINGS-045] cruce del 50 %: de 46.67 a 53.33 notifica el 50 con clave (meta, hito)', () => {
    expect(suppressed({})).toBe(false);
    const plan = milestone.plan(contributionRecordedPayload());
    expect(plan.dedupeKey).toBe(`goal-milestone:${EMERGENCY_GOAL_ID}:50`);
    expect(plan.params).toMatchObject({ milestone: '50', alsoCrossed: [] });
    expect(plan.link).toMatchObject({ kind: 'GOAL', goalId: EMERGENCY_GOAL_ID });
  });

  it('[TC-GOALS-SAVINGS-045] dos hitos en un aporte: el mayor, con el otro en alsoCrossed', () => {
    const plan = milestone.plan(
      contributionRecordedPayload({ percentBefore: '20.00', percentAfter: '55.56' }),
    );
    expect(plan.params).toMatchObject({ milestone: '50', alsoCrossed: ['25'] });
    expect(crossedMilestones('10.00', '80.00')).toEqual({ milestone: '75', alsoCrossed: ['25', '50'] });
  });

  it('[TC-GOALS-SAVINGS-045] la frontera: percentBefore < m <= percentAfter, comparado como Decimal', () => {
    expect(crossedMilestones('49.99', '50.00')?.milestone).toBe('50');
    expect(crossedMilestones('50.00', '50.01')).toBeNull();
    expect(crossedMilestones('9.99', '25')?.milestone).toBe('25');
    expect(crossedMilestones('100.00', '120.00')).toBeNull();
    // 9.90 como texto es mayor que "25.00": la comparación no es lexicográfica
    expect(crossedMilestones('9.90', '100.00')).toEqual({ milestone: '75', alsoCrossed: ['25', '50'] });
    expect(crossedMilestones('52.00', '48.00')).toBeNull();
  });

  it('[TC-GOALS-SAVINGS-045] sin cruce o con progreso incompleto: sin hitos; el 100 % no es un hito', () => {
    expect(suppressed({ percentBefore: '53.33', percentAfter: '48.00' })).toBe(true);
    expect(suppressed({ percentBefore: '20.00', percentAfter: '30.00', progressComplete: false })).toBe(true);
    expect(suppressed({ percentBefore: '51.00', percentAfter: '60.00' })).toBe(true);
    expect(suppressed({ percentBefore: '80.00', percentAfter: '100.00' })).toBe(true);
  });
});

describe('Render: metas de ahorro', () => {
  const overPlan = overAllocated.plan(earmarkExceedsPayload());
  const reachedPlan = reached.plan(goalReachedPayload(), { aggregateVersion: 3 });
  const milestonePlan = milestone.plan(
    contributionRecordedPayload({ percentBefore: '20.00', percentAfter: '55.56' }),
  );
  const email = (plan: NotificationPlan, locale: NotificationLocale, variant: 'basic' | 'detailed') =>
    renderEmail({ locale, variant, messageKey: plan.messageKey, params: plan.params, names, ...links });

  it('[TC-GOALS-SAVINGS-044] meta alcanzada en en-US: asunto citado y fecha en formato inglés', () => {
    const en = notificationLocaleOf('en-US');
    const mail = email(reachedPlan, en, 'basic');
    expect(mail.subject).toBe('You reached one of your savings goals');
    expect(mail.text).toContain('One of your savings goals reached its target.');
    const inApp = renderInApp(en, reachedPlan.messageKey, reachedPlan.params, names);
    expect(inApp.title).toBe('You reached your goal Laptop');
    expect(inApp.body).toBe('You have 9,000.00 BOB of 9,000.00 BOB (as of 10/20/2026).');
  });

  it('[TC-GOALS-SAVINGS-044] español (es-BO) y portugués (pt-BR) con su formato; respaldo en español', () => {
    const es = renderInApp('es', reachedPlan.messageKey, reachedPlan.params, names);
    expect(es.title).toBe('Alcanzaste tu meta Laptop');
    expect(es.body).toBe('Llevas 9.000,00 BOB de 9.000,00 BOB (al 20/10/2026).');
    const pt = renderInApp('pt', reachedPlan.messageKey, reachedPlan.params, names);
    expect(pt.title).toBe('Você alcançou sua meta Laptop');
    expect(email(reachedPlan, 'pt', 'basic').subject).toBe('Você alcançou uma das suas metas de poupança');
    const fallback = renderInApp(
      notificationLocaleOf('fr-FR'),
      reachedPlan.messageKey,
      reachedPlan.params,
      names,
    );
    expect(fallback.title).toBe('Alcanzaste tu meta Laptop');
    expect(email(reachedPlan, notificationLocaleOf('de'), 'basic').subject).toBe(
      'Alcanzaste una de tus metas de ahorro',
    );
  });

  it('[TC-GOALS-SAVINGS-044] sobre-asignación in-app con cuenta, saldo, reservado, faltante y metas', () => {
    const es = renderInApp('es', overPlan.messageKey, overPlan.params, names);
    expect(es.title).toBe('Lo reservado para metas supera el saldo de Banco BOB');
    expect(es.body).toBe(
      'Saldo 5.800,00 BOB, reservado 7.000,00 BOB: faltan 1.200,00 BOB. Metas afectadas: Laptop y Fondo de emergencia.',
    );
    const en = renderInApp('en', overPlan.messageKey, overPlan.params, names);
    expect(en.body).toBe(
      'Balance 5,800.00 BOB, set aside 7,000.00 BOB: 1,200.00 BOB short. Affected goals: Laptop and Fondo de emergencia.',
    );
  });

  it('[TC-GOALS-SAVINGS-044] hito: porcentaje, objetivo y los hitos adicionales', () => {
    const es = renderInApp('es', milestonePlan.messageKey, milestonePlan.params, names);
    expect(es.title).toBe('Fondo de emergencia llegó al 50 % de su objetivo');
    expect(es.body).toBe(
      'Llevas 8.000,50 BOB de 15.000,00 BOB (55,56 %). También se cruzaron los hitos 25 %.',
    );
    const single = milestone.plan(contributionRecordedPayload());
    expect(renderInApp('en', single.messageKey, single.params, names).body).toBe(
      'You have 8,000.50 BOB of 15,000.00 BOB (53.33 %).',
    );
  });

  it('[TC-GOALS-SAVINGS-043] el email sin detalles no lleva montos, monedas ni nombres (palabras completas)', () => {
    const forbidden = [
      'Banco',
      'BOB',
      'Laptop',
      'Fondo',
      'emergencia',
      '1200',
      '1\\.200',
      '5800',
      '7000',
      '9000',
    ];
    for (const plan of [overPlan, reachedPlan, milestonePlan]) {
      for (const locale of ['es', 'en', 'pt'] as const) {
        const mail = email(plan, locale, 'basic');
        const content = `${mail.subject}\n${mail.text}\n${mail.html}`.replaceAll(links.notificationUrl, '');
        for (const word of forbidden) {
          expect(content, `${locale}/${plan.type}/${word}`).not.toMatch(wholeWord(word));
        }
      }
    }
    expect(email(overPlan, 'es', 'basic').text).toContain(
      'Una de tus cuentas tiene más dinero reservado para metas que su saldo.',
    );
  });

  it('[TC-GOALS-SAVINGS-043] con opt-in de detalles el email sí lleva los nombres y montos', () => {
    const mail = email(overPlan, 'es', 'detailed');
    expect(mail.text).toMatch(wholeWord('Banco'));
    expect(mail.text).toContain('1.200,00 BOB');
    expect(mail.text).toContain('Laptop y Fondo de emergencia');
  });

  it('[TC-GOALS-SAVINGS-044] los tres idiomas tienen todas las claves de metas con los mismos marcadores', () => {
    const keys = Object.keys(MESSAGE_CATALOGS.es).filter((k) => k.includes('goal_'));
    expect(keys.length).toBe(16);
    for (const key of keys) {
      for (const locale of ['en', 'pt'] as const) {
        const text = MESSAGE_CATALOGS[locale][key];
        expect(text, `${locale}:${key}`).toBeDefined();
        expect(placeholdersOf(text ?? '')).toEqual(placeholdersOf(MESSAGE_CATALOGS.es[key] ?? ''));
      }
    }
  });
});
