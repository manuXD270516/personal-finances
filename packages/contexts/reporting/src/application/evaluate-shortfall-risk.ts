import { CASH_FLOW_WATCH_JOB, REPORTING_SHORTFALL_EVENTS } from '../contracts/index.js';
import { ShortfallEpisodePolicy } from '../domain/index.js';
import type { RiskEvaluation } from './cash-flow-calendar.queries.js';
import type { ShortfallEpisode, ShortfallWatchDeps } from './ports/index.js';

export interface ShortfallWatchSummary {
  /** Workspaces evaluados sin error. */
  readonly workspaces: number;
  readonly opened: number;
  readonly closed: number;
  readonly sustained: number;
  /** Workspaces cuya unidad de trabajo falló (se reintentan en la corrida siguiente); solo el nombre del error. */
  readonly failed: number;
  readonly errors: readonly string[];
}

/** Lo que el job necesita del calendario: el riesgo por moneda en la unidad de trabajo YA abierta. */
export interface ShortfallRiskSource {
  evaluateRisk(input: {
    readonly workspaceId: string;
    readonly timeZone: string;
    readonly baseCurrency: string;
    readonly horizonDays: number;
  }): Promise<RiskEvaluation>;
}

export const DEFAULT_EPISODE_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;

/**
 * `EvaluateShortfallRisk` (job `reporting.cash-flow-watch`; openspec add-cash-flow-forecast, design.md decisión 13; D381):
 * por workspace, UNO a UNO y en su unidad de trabajo con RLS, calcula el calendario del horizonte de la alerta y compara el
 * riesgo de cada moneda con su episodio abierto. Abrir, cerrar y sostener siguen `ShortfallEpisodePolicy`; abrir escribe
 * el episodio, el hecho `reporting.CashFlowShortfallRiskDetected.v1` y la notificación, y cerrar el episodio y el hecho
 * `reporting.CashFlowShortfallRiskCleared.v1` (sin notificación, D380), todo en la misma transacción: o se confirma junto o
 * se revierte y la corrida siguiente reintenta. Dos corridas simultáneas chocan en el índice único del episodio abierto y
 * la segunda no publica. Dato derivado: sin auditoría. Nunca consultas en paralelo sobre el mismo cliente.
 */
export class EvaluateShortfallRisk {
  constructor(
    private readonly deps: ShortfallWatchDeps,
    private readonly source: ShortfallRiskSource,
  ) {}

  async run(): Promise<ShortfallWatchSummary> {
    let workspaces = 0;
    let opened = 0;
    let closed = 0;
    let sustained = 0;
    const errors: string[] = [];
    for (const target of await this.deps.workspaces.list()) {
      try {
        const r = await this.evaluateWorkspace(target);
        workspaces += 1;
        opened += r.opened;
        closed += r.closed;
        sustained += r.sustained;
      } catch (err) {
        // Solo el nombre del error (y el código de dominio), sin datos del workspace.
        const code = (err as { code?: unknown }).code;
        errors.push(
          err instanceof Error ? (typeof code === 'string' ? `${err.name}:${code}` : err.name) : typeof err,
        );
      }
    }
    return { workspaces, opened, closed, sustained, failed: errors.length, errors };
  }

  evaluateWorkspace(target: {
    readonly workspaceId: string;
    readonly timeZone: string;
    readonly baseCurrency: string;
  }) {
    const { deps } = this;
    const { workspaceId } = target;
    return deps.uow.run({ userId: null, workspaceId }, async () => {
      const evaluation = await this.source.evaluateRisk({
        workspaceId,
        timeZone: target.timeZone,
        baseCurrency: target.baseCurrency,
        horizonDays: deps.horizonDays,
      });
      const now = deps.clock.now();
      const nowIso = now.toString();
      const open = new Map<string, ShortfallEpisode>(
        (await deps.episodes.listOpen(workspaceId)).map((e) => [e.currency, e]),
      );
      let opened = 0;
      let closed = 0;
      let sustained = 0;
      for (const c of evaluation.currencies) {
        const episode = open.get(c.currency);
        open.delete(c.currency);
        const action = ShortfallEpisodePolicy.decide({ hasOpenEpisode: episode !== undefined, risk: c.risk });
        if (action === 'OPEN' && c.firstShortfallDate !== null) {
          const episodeId = deps.ids.next();
          // Otra réplica del worker ya abrió el episodio de esta moneda: no se publica otro hecho.
          const inserted = await deps.episodes.open({
            id: episodeId,
            workspaceId,
            currency: c.currency,
            openedAt: nowIso,
            closedAt: null,
            firstShortfallDate: c.firstShortfallDate,
            lowestAmount: c.lowest.toFixed(),
            lowestDate: c.lowestDate,
            thresholdAmount: c.threshold.toFixed(),
            belowZero: c.belowZero,
            lastEvaluatedAt: nowIso,
            lastLowestAmount: c.lowest.toFixed(),
          });
          if (!inserted) continue;
          opened += 1;
          const eventId = deps.ids.next();
          const lowest = { amount: c.lowest.toFixed(), currency: c.currency };
          const threshold = { amount: c.threshold.toFixed(), currency: c.currency };
          await deps.outbox.append({
            eventId,
            eventType: REPORTING_SHORTFALL_EVENTS.detected.type,
            eventVersion: REPORTING_SHORTFALL_EVENTS.detected.version,
            occurredAt: nowIso,
            workspaceId,
            aggregateType: 'CashFlowShortfallEpisode',
            aggregateId: episodeId,
            aggregateVersion: 1,
            actor: { type: 'SYSTEM', id: CASH_FLOW_WATCH_JOB },
            payload: {
              episodeId,
              currency: c.currency,
              horizonDays: evaluation.horizonDays,
              evaluatedAt: nowIso,
              today: evaluation.today,
              lowest,
              lowestDate: c.lowestDate,
              firstShortfallDate: c.firstShortfallDate,
              threshold,
              thresholdSource: c.thresholdSource,
              belowZero: c.belowZero,
            },
          });
          await deps.notifier.notify({
            workspaceId,
            episodeId,
            sourceEventId: eventId,
            occurredAt: nowIso,
            timeZone: target.timeZone,
            currency: c.currency,
            horizonDays: evaluation.horizonDays,
            firstShortfallDate: c.firstShortfallDate,
            lowest,
            lowestDate: c.lowestDate,
            threshold,
            belowZero: c.belowZero,
          });
        } else if (action === 'SUSTAIN' && episode) {
          await deps.episodes.touch(episode.id, { evaluatedAt: nowIso, lowestAmount: c.lowest.toFixed() });
          sustained += 1;
        } else if (action === 'CLOSE' && episode) {
          closed += (await this.close(workspaceId, episode, c.risk === 'LOW' ? 'LOW' : 'NONE', nowIso))
            ? 1
            : 0;
        }
      }
      // Episodio abierto de una moneda que ya no tiene cuentas líquidas: el riesgo desapareció.
      for (const episode of open.values()) {
        closed += (await this.close(workspaceId, episode, 'NONE', nowIso)) ? 1 : 0;
      }
      const retention = deps.retentionDays ?? DEFAULT_EPISODE_RETENTION_DAYS;
      await deps.episodes.purgeClosedBefore(new Date(now.epochMillis - retention * DAY_MS).toISOString());
      return { opened, closed, sustained };
    });
  }

  private async close(
    workspaceId: string,
    episode: ShortfallEpisode,
    risk: 'NONE' | 'LOW',
    nowIso: string,
  ): Promise<boolean> {
    const { deps } = this;
    if (!(await deps.episodes.close(episode.id, nowIso))) return false;
    await deps.outbox.append({
      eventId: deps.ids.next(),
      eventType: REPORTING_SHORTFALL_EVENTS.cleared.type,
      eventVersion: REPORTING_SHORTFALL_EVENTS.cleared.version,
      occurredAt: nowIso,
      workspaceId,
      aggregateType: 'CashFlowShortfallEpisode',
      aggregateId: episode.id,
      aggregateVersion: 2,
      actor: { type: 'SYSTEM', id: CASH_FLOW_WATCH_JOB },
      payload: { episodeId: episode.id, currency: episode.currency, evaluatedAt: nowIso, risk },
    });
    return true;
  }
}
