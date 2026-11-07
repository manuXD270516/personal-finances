import { currency as makeCurrency, FixedClock, Instant, Money } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CurrencyRiskEvaluation, RiskEvaluation } from './cash-flow-calendar.queries.js';
import { EvaluateShortfallRisk } from './evaluate-shortfall-risk.js';
import type { ShortfallEpisode, ShortfallEpisodeRepository } from './ports/index.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const BOB = makeCurrency('BOB', 2);
const bob = (a: string) => Money.parse(a, BOB);

let clock: FixedClock;
let episodes: ShortfallEpisode[];
let events: {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
}[];
let notifications: { episodeId: string; sourceEventId: string; belowZero: boolean; currency: string }[];
let evaluation: RiskEvaluation;
let loseRace = false;
let ids = 0;

const repository: ShortfallEpisodeRepository = {
  listOpen: async () => episodes.filter((e) => e.closedAt === null),
  open: async (e) => {
    if (loseRace) return false;
    if (episodes.some((x) => x.currency === e.currency && x.closedAt === null)) return false;
    episodes.push(e);
    return true;
  },
  touch: async (id, input) => {
    const i = episodes.findIndex((e) => e.id === id);
    episodes[i] = {
      ...episodes[i]!,
      lastEvaluatedAt: input.evaluatedAt,
      lastLowestAmount: input.lowestAmount,
    };
  },
  close: async (id, closedAt) => {
    const i = episodes.findIndex((e) => e.id === id && e.closedAt === null);
    if (i < 0) return false;
    episodes[i] = { ...episodes[i]!, closedAt };
    return true;
  },
  purgeClosedBefore: async (cutoff) => {
    const before = episodes.length;
    episodes = episodes.filter((e) => e.closedAt === null || e.closedAt >= cutoff);
    return before - episodes.length;
  },
};

const currencyRisk = (over: Partial<CurrencyRiskEvaluation> = {}): CurrencyRiskEvaluation => ({
  currency: 'BOB',
  risk: 'HIGH',
  lowest: bob('-679.00'),
  lowestDate: '2026-11-01',
  firstShortfallDate: '2026-11-01',
  threshold: bob('1500.00'),
  thresholdSource: 'MINIMUM_RESERVE',
  belowZero: true,
  ...over,
});

const watch = () =>
  new EvaluateShortfallRisk(
    {
      uow: { run: (_ctx, fn) => fn() },
      workspaces: {
        list: async () => [{ workspaceId: WS, timeZone: 'America/La_Paz', baseCurrency: 'BOB' }],
      },
      episodes: repository,
      outbox: { append: async (e) => void events.push(e) },
      notifier: {
        notify: async (f) =>
          void notifications.push({
            episodeId: f.episodeId,
            sourceEventId: f.sourceEventId,
            belowZero: f.belowZero,
            currency: f.currency,
          }),
      },
      ids: { next: () => `0190a000-0000-7000-8000-${String(++ids).padStart(12, '0')}` },
      clock,
      horizonDays: 30,
    },
    { evaluateRisk: async () => evaluation },
  );

beforeEach(() => {
  clock = new FixedClock(Instant.parse('2026-10-20T12:25:00Z'));
  episodes = [];
  events = [];
  notifications = [];
  loseRace = false;
  ids = 0;
  evaluation = {
    today: '2026-10-20',
    now: clock.now().toString(),
    horizonDays: 30,
    currencies: [currencyRisk()],
  };
});

describe('EvaluateShortfallRisk: episodios de riesgo de déficit (job reporting.cash-flow-watch)', () => {
  it('[TC-REPORTING-FORECAST-018] el primer riesgo alto abre un episodio y publica el hecho detectado una sola vez con su notificación', async () => {
    const summary = await watch().run();
    expect(summary).toMatchObject({ workspaces: 1, opened: 1, closed: 0, failed: 0 });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      currency: 'BOB',
      belowZero: true,
      closedAt: null,
      firstShortfallDate: '2026-11-01',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'reporting.CashFlowShortfallRiskDetected',
      aggregateVersion: 1,
      aggregateId: episodes[0]!.id,
    });
    expect(events[0]!.payload).toMatchObject({
      currency: 'BOB',
      horizonDays: 30,
      lowest: { amount: '-679.00', currency: 'BOB' },
      lowestDate: '2026-11-01',
      firstShortfallDate: '2026-11-01',
      threshold: { amount: '1500.00', currency: 'BOB' },
      thresholdSource: 'MINIMUM_RESERVE',
      belowZero: true,
    });
    expect(notifications).toEqual([
      { episodeId: episodes[0]!.id, sourceEventId: events[0]!.eventId, belowZero: true, currency: 'BOB' },
    ]);
  });

  it('[TC-REPORTING-FORECAST-018] mientras el riesgo siga alto no se publica nada y el episodio sigue abierto', async () => {
    await watch().run();
    clock.set(Instant.parse('2026-10-20T13:25:00Z'));
    evaluation = { ...evaluation, currencies: [currencyRisk({ lowest: bob('-650.00') })] };
    const second = await watch().run();
    clock.set(Instant.parse('2026-10-20T14:25:00Z'));
    const third = await watch().run();
    expect(second).toMatchObject({ opened: 0, closed: 0, sustained: 1 });
    expect(third).toMatchObject({ opened: 0, closed: 0, sustained: 1 });
    expect(events).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ closedAt: null, lastLowestAmount: '-650.00' });
  });

  it('[TC-REPORTING-FORECAST-019] cuando el riesgo pasa a NONE el episodio se cierra con el hecho resuelto y un riesgo nuevo abre otro', async () => {
    await watch().run();
    clock.set(Instant.parse('2026-10-20T13:25:00Z'));
    evaluation = {
      ...evaluation,
      currencies: [
        currencyRisk({ risk: 'NONE', lowest: bob('3821.00'), firstShortfallDate: null, belowZero: false }),
      ],
    };
    const closed = await watch().run();
    expect(closed).toMatchObject({ opened: 0, closed: 1 });
    expect(events.map((e) => [e.eventType, e.aggregateVersion])).toEqual([
      ['reporting.CashFlowShortfallRiskDetected', 1],
      ['reporting.CashFlowShortfallRiskCleared', 2],
    ]);
    expect(events[1]!.payload).toMatchObject({ episodeId: episodes[0]!.id, currency: 'BOB', risk: 'NONE' });
    // El cierre no notifica.
    expect(notifications).toHaveLength(1);
    clock.set(Instant.parse('2026-10-25T13:25:00Z'));
    evaluation = { ...evaluation, currencies: [currencyRisk()] };
    const reopened = await watch().run();
    expect(reopened).toMatchObject({ opened: 1 });
    expect(episodes).toHaveLength(2);
    expect(notifications).toHaveLength(2);
    expect(episodes[0]!.id).not.toBe(episodes[1]!.id);
  });

  it('[TC-REPORTING-FORECAST-019] LOW cierra el episodio y POSSIBLE no abre ni cierra nada', async () => {
    await watch().run();
    evaluation = {
      ...evaluation,
      currencies: [currencyRisk({ risk: 'POSSIBLE', firstShortfallDate: '2026-10-28' })],
    };
    expect(await watch().run()).toMatchObject({ closed: 0, opened: 0, sustained: 0 });
    expect(episodes[0]!.closedAt).toBeNull();
    evaluation = { ...evaluation, currencies: [currencyRisk({ risk: 'LOW', firstShortfallDate: null })] };
    expect(await watch().run()).toMatchObject({ closed: 1 });
    expect(events.at(-1)!.payload).toMatchObject({ risk: 'LOW' });
    // LOW sin episodio abierto nunca abre.
    expect(await watch().run()).toMatchObject({ opened: 0, closed: 0 });
    expect(episodes).toHaveLength(1);
  });

  it('[TC-REPORTING-FORECAST-019] POSSIBLE sin episodio no abre ninguno ni publica un hecho', async () => {
    evaluation = {
      ...evaluation,
      currencies: [currencyRisk({ risk: 'POSSIBLE', firstShortfallDate: '2026-10-28' })],
    };
    expect(await watch().run()).toMatchObject({ opened: 0 });
    expect(episodes).toEqual([]);
    expect(events).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-018] si otra réplica ganó la carrera del episodio, esta no publica ni notifica', async () => {
    loseRace = true;
    expect(await watch().run()).toMatchObject({ opened: 0 });
    expect(events).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-019] un episodio de una moneda sin cuentas líquidas se cierra y los cerrados viejos se purgan', async () => {
    await watch().run();
    evaluation = { ...evaluation, currencies: [] };
    expect(await watch().run()).toMatchObject({ closed: 1 });
    clock.set(Instant.parse('2028-01-01T00:00:00Z'));
    await watch().run();
    expect(episodes).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-018] la falla de un workspace se cuenta y no detiene el resto', async () => {
    const failing = new EvaluateShortfallRisk(
      {
        uow: { run: (_ctx, fn) => fn() },
        workspaces: {
          list: async () => [
            { workspaceId: 'ws-malo', timeZone: 'America/La_Paz', baseCurrency: 'BOB' },
            { workspaceId: WS, timeZone: 'America/La_Paz', baseCurrency: 'BOB' },
          ],
        },
        episodes: repository,
        outbox: { append: async (e) => void events.push(e) },
        notifier: { notify: async () => undefined },
        ids: { next: () => `0190a000-0000-7000-8000-${String(++ids).padStart(12, '0')}` },
        clock,
        horizonDays: 30,
      },
      {
        evaluateRisk: async (input) => {
          if (input.workspaceId === 'ws-malo') throw new Error('boom');
          return evaluation;
        },
      },
    );
    const summary = await failing.run();
    expect(summary).toMatchObject({ workspaces: 1, failed: 1, opened: 1, errors: ['Error'] });
  });
});
