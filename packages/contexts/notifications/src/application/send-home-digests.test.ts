import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { HomeDigestSnapshot } from '../contracts/index.js';
import { WS } from '../domain/fixtures.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { InboxQueries } from './inbox.queries.js';
import { SendHomeDigests } from './send-home-digests.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const money = (amount: string) => ({ amount, currency: 'BOB' });
const empty = { counts: {}, percents: {}, dates: {}, states: {}, amounts: {} };

/** Contenido del Home de "W1" (REPORTING lo compone; aquí un doble): 3 pagos, 41.5 %, riesgo alto, disponible 5521.00 BOB. */
const snapshot = (withGoals = true): HomeDigestSnapshot => ({
  workspaceId: WS,
  generatedAt: '2026-11-02T12:05:00.000Z',
  timeZone: 'America/La_Paz',
  today: '2026-11-02',
  reportingCurrency: 'BOB',
  questions: [
    { ...empty, question: 'Q1', status: 'AVAILABLE', amounts: { liquid: money('15800.00') } },
    { ...empty, question: 'Q2', status: 'AVAILABLE', percents: { incomeChange: '3.20' } },
    { ...empty, question: 'Q3', status: 'AVAILABLE', percents: { expenseChange: '-12.50' } },
    { ...empty, question: 'Q4', status: 'AVAILABLE', amounts: { committed: money('3179.00') } },
    {
      ...empty,
      question: 'Q5',
      status: 'AVAILABLE',
      states: { spendableSign: 'POSITIVE' },
      amounts: { spendable: money('5521.00') },
    },
    { ...empty, question: 'Q6', status: 'AVAILABLE', percents: { savingsRate: '41.5' } },
    { ...empty, question: 'Q7', status: 'AVAILABLE', percents: { expenseChange: '-12.50' } },
    {
      ...empty,
      question: 'Q8',
      status: 'AVAILABLE',
      counts: { upcoming7d: 3, overdue: 0 },
      dates: { firstShortfall: '2026-11-15' },
      states: { risk: 'HIGH', riskCurrency: 'BOB' },
    },
    withGoals
      ? {
          ...empty,
          question: 'Q9',
          status: 'AVAILABLE',
          counts: { goals: 2, goalsOnTrack: 1, goalsBehind: 1 },
        }
      : { ...empty, question: 'Q9', status: 'NO_DATA' },
  ],
});

const setup = (fiscalMonthStartDay = 1, withGoals = true) => {
  const env = new NotificationsTestEnv();
  const composed: string[] = [];
  const digests = new SendHomeDigests({
    ...env.notifyDeps(),
    calendar: { calendarOf: () => Promise.resolve({ timeZone: 'America/La_Paz', fiscalMonthStartDay }) },
    source: {
      compose: ({ workspaceId }) => {
        composed.push(workspaceId);
        return Promise.resolve(snapshot(withGoals));
      },
    },
  });
  const choose = async (
    userId: string,
    digestFrequency: string,
    extra: { quiet?: boolean; details?: boolean } = {},
  ) => {
    const prefs = await env.preferences.load(WS, userId);
    prefs.update({
      types: [],
      quietHours: extra.quiet ? { start: '22:00', end: '09:00' } : null,
      includeDetailsInEmail: extra.details ?? false,
      digestFrequency,
    });
    await env.preferences.save(prefs);
  };
  const at = (iso: string) => env.clock.set(Instant.parse(iso));
  const rowsOf = (userId: string) => [...env.notifications.rows.values()].filter((n) => n.userId === userId);
  const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
  return { env, digests, composed, choose, at, rowsOf, dispatch };
};

describe('SendHomeDigests: digest semanal y mensual del Home', () => {
  it('[TC-NOTIFICATIONS-DIGEST-002] el lunes 08:05 el OWNER y el VIEWER con digest semanal reciben Q1 a Q9; el EDITOR sin digest, nada', async () => {
    const { env, digests, composed, choose, at, dispatch } = setup();
    await choose(OWNER, 'WEEKLY');
    await choose(VIEWER, 'WEEKLY');
    at('2026-11-02T12:05:00Z'); // lunes 08:05 en La Paz
    expect(await digests.run(WS)).toEqual({ created: 2, deliveries: 2 });
    expect(composed).toHaveLength(1);
    for (const delivery of env.deliveries.rows.values()) {
      expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery.id })).toBe('sent');
    }
    expect(env.sender.sent.map((m) => m.to).sort()).toEqual(['owner@pfos.test', 'viewer@pfos.test']);
    const owner = env.sender.sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.subject).toBe('Tu resumen financiero de PFOS');
    for (const title of [
      'Dinero disponible',
      'Ingresos',
      'Gastos',
      'Comprometido del periodo',
      'Disponible para gastar',
      'Ahorro',
      'Frente al periodo anterior',
      'Pagos próximos',
      'Metas',
    ]) {
      expect(owner?.text).toContain(title);
    }
    // El viewer tiene locale fr-FR: español de respaldo.
    expect(env.sender.sent.find((m) => m.to === 'viewer@pfos.test')?.text).toContain('Pagos próximos');
    expect(env.sender.sent.some((m) => m.to === 'editor@pfos.test')).toBe(false);
  });

  it('[TC-NOTIFICATIONS-DIGEST-002] el digest no aparece en el centro de notificaciones ni en el contador', async () => {
    const { env, digests, choose, at } = setup();
    await choose(OWNER, 'WEEKLY');
    at('2026-11-02T12:05:00Z');
    await digests.run(WS);
    const inbox = new InboxQueries(env.inboxDeps());
    expect(await inbox.list({ workspaceId: WS, userId: OWNER, limit: 20 })).toEqual([]);
    expect(await inbox.getUnreadCount(WS, OWNER)).toBe(0);
    expect(env.metrics.created_).toEqual(['HOME_DIGEST']);
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] el digest mensual con día de inicio 25 sale el 2026-10-25 y el 2026-11-01 no se repite; Q9 indica que no hay metas', async () => {
    const { env, digests, composed, choose, at, dispatch } = setup(25, false);
    await choose(EDITOR, 'MONTHLY');
    at('2026-10-25T12:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 1, deliveries: 1 });
    at('2026-11-01T12:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 0, deliveries: 0 });
    expect(composed).toHaveLength(1);
    const [delivery] = [...env.deliveries.rows.values()];
    await dispatch.run({ workspaceId: WS, deliveryId: delivery!.id });
    const mail = env.sender.sent[0];
    expect(mail?.to).toBe('editor@pfos.test');
    // locale pt-BR: portugués; la sección de Q9 dice que no hay metas, sin 0 %.
    expect(mail?.text).toContain('Você ainda não tem metas.');
    expect(mail?.text).not.toMatch(/\b0 %/);
    expect([...env.notifications.rows.values()][0]?.dedupeKey).toBe('HOME_DIGEST:MONTHLY:2026-10');
  });

  it('[TC-NOTIFICATIONS-DIGEST-002] sin digest elegido (OFF) nadie recibe nada ni se compone el contenido', async () => {
    const { env, digests, composed, at } = setup();
    at('2026-11-02T12:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 0, deliveries: 0 });
    expect(composed).toHaveLength(0);
    expect(env.notifications.rows.size).toBe(0);
  });

  it('[TC-NOTIFICATIONS-DIGEST-005] con silencio de 22:00 a 09:00 el digest de las 08:05 sale a las 09:00 y un segundo pase no lo duplica', async () => {
    const { env, digests, choose, at, dispatch } = setup();
    await choose(OWNER, 'WEEKLY', { quiet: true });
    at('2026-11-02T12:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 1, deliveries: 1 });
    const [job] = env.scheduler.jobs;
    expect(job?.startAfter?.toISOString()).toBe('2026-11-02T13:00:00.000Z');
    // Antes de las 09:00 el despacho se difiere; a las 09:00 sale.
    const [delivery] = [...env.deliveries.rows.values()];
    expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery!.id })).toBe('noop');
    at('2026-11-02T13:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 0, deliveries: 0 });
    expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery!.id })).toBe('sent');
    expect(env.sender.sent).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-DIGEST-005] el job ejecutado dos veces el mismo lunes deja un solo digest por destinatario', async () => {
    const { env, digests, composed, choose, at } = setup();
    await choose(OWNER, 'WEEKLY');
    at('2026-11-02T12:05:00Z');
    await digests.run(WS);
    at('2026-11-02T13:05:00Z');
    await digests.run(WS);
    expect(env.notifications.rows.size).toBe(1);
    expect(env.deliveries.rows.size).toBe(1);
    expect(composed).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-DIGEST-006] con el worker caído el lunes, el digest de la semana sale el miércoles 10:00; recién el lunes siguiente solo sale el de la semana nueva', async () => {
    const { env, digests, choose, at, rowsOf } = setup();
    await choose(OWNER, 'WEEKLY');
    at('2026-11-04T14:00:00Z'); // miércoles 10:00 en La Paz
    expect(await digests.run(WS)).toEqual({ created: 1, deliveries: 1 });
    expect(rowsOf(OWNER).map((n) => n.dedupeKey)).toEqual(['HOME_DIGEST:WEEKLY:2026-W45']);

    const other = setup();
    await other.choose(OWNER, 'WEEKLY');
    other.at('2026-11-09T12:05:00Z'); // lunes siguiente, sin haber corrido antes
    await other.digests.run(WS);
    expect(other.rowsOf(OWNER).map((n) => n.dedupeKey)).toEqual(['HOME_DIGEST:WEEKLY:2026-W46']);
    expect(env.notifications.rows.size).toBe(1);
  });

  it('antes de las 08:00 del lunes todavía no sale el digest de la semana nueva', async () => {
    const { env, digests, choose, at } = setup();
    await choose(OWNER, 'WEEKLY');
    at('2026-11-02T11:30:00Z'); // lunes 07:30 en La Paz
    expect(await digests.run(WS)).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
  });

  it('[TC-NOTIFICATIONS-DIGEST-004] sin opt-in el email no lleva ningún monto; con opt-in sí', async () => {
    const { env, digests, choose, at, dispatch } = setup();
    await choose(OWNER, 'WEEKLY');
    await choose(EDITOR, 'WEEKLY', { details: true });
    at('2026-11-02T12:05:00Z');
    await digests.run(WS);
    for (const delivery of env.deliveries.rows.values()) {
      await dispatch.run({ workspaceId: WS, deliveryId: delivery.id });
    }
    const plain = env.sender.sent.find((m) => m.to === 'owner@pfos.test');
    expect(plain?.text).toContain('3 pagos en los próximos 7 días');
    expect(plain?.text).toMatch(/Tasa de ahorro: 41,5 %/);
    expect(plain?.text).toContain('Riesgo de déficit alto en BOB desde el 15/11/2026');
    expect(plain?.text).not.toMatch(/\b5\.?521\b/);
    const rich = env.sender.sent.find((m) => m.to === 'editor@pfos.test');
    // El EDITOR es pt-BR: formato brasileño de los montos.
    expect(rich?.text).toMatch(/Disponível para gastar: 5\.521,00 BOB/);
  });

  it('con el canal email deshabilitado por entorno el digest no se envía (la entrega queda suprimida)', async () => {
    const { env, digests, choose, at, dispatch } = setup();
    await choose(OWNER, 'WEEKLY');
    env.sender.driver = 'none';
    at('2026-11-02T12:05:00Z');
    await digests.run(WS);
    const [delivery] = [...env.deliveries.rows.values()];
    expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery!.id })).toBe('suppressed');
    expect(env.sender.sent).toHaveLength(0);
  });

  it('un miembro que ya no es activo no recibe el digest', async () => {
    const { env, digests, choose, at } = setup();
    await choose(VIEWER, 'WEEKLY');
    env.recipients.members = env.recipients.members.filter((m) => m.userId !== VIEWER);
    at('2026-11-02T12:05:00Z');
    expect(await digests.run(WS)).toEqual({ created: 0, deliveries: 0 });
  });
});
