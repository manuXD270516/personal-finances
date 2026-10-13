import type { Clock } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import { evaluateFeedFreshness, pairKey, type FeedPairObservation } from '../domain/index.js';
import type {
  ActiveWorkspacesPort,
  ExchangeRateRepository,
  IdGenerator,
  NotificationIntakePort,
  OutboxPort,
  RateFeedEpisodeRepository,
  UnitOfWork,
} from './ports/index.js';
import { enabledProviders, type FxProviderSettings } from './provider-settings.js';
import { coversOf, defaultRateTypeOf } from './rate-pair-views.js';
import type { RatePairResolver } from './rate-pairs.js';
import { DEFAULT_WORKSPACE_BASE_CURRENCY } from './sample-recorder.js';

export interface FeedCheckSummary {
  /** Workspaces verificados (con al menos un par evaluable). */
  readonly workspaces: number;
  readonly opened: number;
  readonly closed: number;
  /** Episodios cerrados sin aviso porque el par se quitó o perdió su cobertura automática. */
  readonly retired: number;
  /** Workspaces cuya transacción falló (se reintentan en el ciclo siguiente); solo el nombre del error, sin datos. */
  readonly failed: number;
  readonly errors: readonly string[];
}

export const EMPTY_FEED_CHECK: FeedCheckSummary = Object.freeze({
  workspaces: 0,
  opened: 0,
  closed: 0,
  retired: 0,
  failed: 0,
  errors: [],
});

export interface FeedFreshnessCheckDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly pairs: RatePairResolver;
  readonly episodes: RateFeedEpisodeRepository;
  readonly workspaces: ActiveWorkspacesPort;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: FxProviderSettings;
  /** Puerto síncrono de NOTIFY (D249); sin él los episodios y los eventos se escriben igual. */
  readonly notifications?: NotificationIntakePort | undefined;
}

/**
 * `CheckFeedFreshness` (openspec fx/market-rate-providers, add-rate-feed-alerts; D233, D249): al final de cada ciclo de
 * `PollMarketRates`, por workspace y en SU unidad de trabajo, abre o cierra los episodios de obsolescencia de los pares
 * configurados con cobertura automática. Cada apertura y cada cierre escribe, en la misma transacción, el episodio, el
 * evento del outbox y la notificación (puerto de NOTIFY): o se confirman juntos o se revierten juntos y el ciclo siguiente
 * reintenta. Las consultas son secuenciales sobre el mismo cliente. La falla de un workspace no detiene a los demás.
 */
export class CheckFeedFreshness {
  constructor(private readonly deps: FeedFreshnessCheckDeps) {}

  async run(correlationId: string): Promise<FeedCheckSummary> {
    // Con todos los providers deshabilitados no hay ciclo ni episodios (el job ni siquiera se registra).
    if (enabledProviders(this.deps.settings).length === 0) return EMPTY_FEED_CHECK;
    let workspaces = 0;
    let opened = 0;
    let closed = 0;
    let retired = 0;
    const errors: string[] = [];
    for (const target of await this.deps.workspaces.list()) {
      try {
        const r = await this.checkWorkspace(target, correlationId);
        if (r.evaluated) workspaces += 1;
        opened += r.opened;
        closed += r.closed;
        retired += r.retired;
      } catch (err) {
        errors.push(err instanceof Error ? err.name : typeof err);
      }
    }
    return { workspaces, opened, closed, retired, failed: errors.length, errors };
  }

  private checkWorkspace(
    target: { readonly workspaceId: string; readonly timeZone: string; readonly baseCurrency?: string },
    correlationId: string,
  ) {
    const { deps } = this;
    const { workspaceId } = target;
    return deps.uow.run(workspaceId, async () => {
      const effective = await deps.pairs.effective(
        workspaceId,
        target.baseCurrency ?? DEFAULT_WORKSPACE_BASE_CURRENCY,
      );
      const configured = new Set(effective.pairs.map(pairKey));
      const open = await deps.episodes.listOpen(workspaceId);
      const observations: FeedPairObservation[] = [];
      for (const pair of effective.pairs) {
        // Tipo automático del par: PARALLEL (fiat y estables) o MARKET (cripto volátil); sin OFFICIAL ni compra/venta.
        const automatic = defaultRateTypeOf(deps.settings, pair);
        const feeds = coversOf(deps.settings, pair).filter((c) => c.rateType === automatic);
        // Un par que ningún provider habilitado publica en su tipo automático solo vive de tasas manuales: nunca alerta.
        if (feeds.length === 0) continue;
        let latest: FeedPairObservation['latest'] = null;
        for (const feed of feeds) {
          const found = await deps.rates.latestAccepted(workspaceId, {
            provider: feed.provider,
            base: pair.base,
            quote: pair.quote,
            rateType: feed.rateType,
          });
          if (found && (!latest || Date.parse(found.rate.snapshot.asOf) > Date.parse(latest.asOf))) {
            latest = { rateId: found.rate.id, asOf: found.rate.snapshot.asOf };
          }
        }
        observations.push({ base: pair.base, quote: pair.quote, latest });
      }
      const now = deps.clock.now();
      const nowIso = now.toString();
      const result = evaluateFeedFreshness({
        pairs: observations,
        open,
        nowMs: now.epochMillis,
        staleAfterMs: deps.settings.feedStaleAlertAfterMs,
      });

      for (const episode of result.retire) {
        await deps.episodes.close({
          id: episode.id,
          workspaceId,
          closedAt: nowIso,
          recoveredRateId: null,
          reason: configured.has(pairKey(episode)) ? 'COVERAGE_LOST' : 'PAIR_REMOVED',
        });
      }

      let opened = 0;
      for (const o of result.open) {
        const episodeId = deps.ids.next();
        // Otra réplica del worker ya abrió el episodio de este par: no se publica otro hecho.
        const inserted = await deps.episodes.open({
          id: episodeId,
          workspaceId,
          base: o.base,
          quote: o.quote,
          openedAt: nowIso,
          lastRateAsOf: o.lastRateAsOf,
        });
        if (!inserted) continue;
        opened += 1;
        const eventId = deps.ids.next();
        await deps.outbox.append({
          eventId,
          eventType: FX_EVENTS.rateFeedStale.eventType,
          eventVersion: FX_EVENTS.rateFeedStale.eventVersion,
          occurredAt: nowIso,
          workspaceId,
          aggregateType: 'RateFeedEpisode',
          aggregateId: episodeId,
          aggregateVersion: 1,
          actor: { type: 'SYSTEM', id: `fx-provider:${correlationId}` },
          correlationId,
          payload: {
            episodeId,
            base: o.base,
            quote: o.quote,
            lastRateAsOf: o.lastRateAsOf,
            staleAfterSeconds: Math.round(deps.settings.feedStaleAlertAfterMs / 1000),
            detectedAt: nowIso,
          },
        });
        await deps.notifications?.notify({
          workspaceId,
          type: 'FX_RATE_FEED_STALE',
          factKey: episodeId,
          sourceEventId: eventId,
          occurredAt: nowIso,
          payload: {
            episodeId,
            base: o.base,
            quote: o.quote,
            lastRateAsOf: o.lastRateAsOf,
            staleAfterSeconds: Math.round(deps.settings.feedStaleAlertAfterMs / 1000),
            detectedAt: nowIso,
            timeZone: target.timeZone,
          },
        });
      }

      let closed = 0;
      for (const { episode, recovered } of result.close) {
        // Ya cerrado por otra réplica: no se publica otro hecho de recuperación.
        const done = await deps.episodes.close({
          id: episode.id,
          workspaceId,
          closedAt: nowIso,
          recoveredRateId: recovered.rateId,
          reason: 'RECOVERED',
        });
        if (!done) continue;
        closed += 1;
        const eventId = deps.ids.next();
        await deps.outbox.append({
          eventId,
          eventType: FX_EVENTS.rateFeedRecovered.eventType,
          eventVersion: FX_EVENTS.rateFeedRecovered.eventVersion,
          occurredAt: nowIso,
          workspaceId,
          aggregateType: 'RateFeedEpisode',
          aggregateId: episode.id,
          aggregateVersion: 2,
          actor: { type: 'SYSTEM', id: `fx-provider:${correlationId}` },
          correlationId,
          payload: {
            episodeId: episode.id,
            base: episode.base,
            quote: episode.quote,
            rateId: recovered.rateId,
            asOf: recovered.asOf,
            openedAt: episode.openedAt,
          },
        });
        await deps.notifications?.notify({
          workspaceId,
          type: 'FX_RATE_FEED_RECOVERED',
          factKey: episode.id,
          sourceEventId: eventId,
          occurredAt: nowIso,
          payload: {
            episodeId: episode.id,
            base: episode.base,
            quote: episode.quote,
            rateId: recovered.rateId,
            asOf: recovered.asOf,
            openedAt: episode.openedAt,
            detectedAt: nowIso,
            timeZone: target.timeZone,
          },
        });
      }
      return {
        evaluated: observations.length > 0 || open.length > 0,
        opened,
        closed,
        retired: result.retire.length,
      };
    });
  }
}
