import type { RateAnomalyGroupFact } from '@pf/notifications/contracts';
import { Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import {
  anomalyDetectorFor,
  DEFAULT_ANOMALY_THRESHOLDS,
  ExchangeRate,
  pairKey,
  resolveAnomalyGroup,
  type AnomalyDetector,
  type AnomalyThresholds,
  type AssetClass,
  type CurrencyDefinition,
  type ProviderSample,
} from '../domain/index.js';
import type {
  CurrencyRepository,
  ExchangeRateRepository,
  IdGenerator,
  NotificationIntakePort,
  OutboxPort,
  UnitOfWork,
} from './ports/index.js';
import type { RatePairResolver } from './rate-pairs.js';

/**
 * Moneda base por defecto de un workspace cuyo destino no la informa (tests y jobs antiguos): la moneda de reporte del
 * producto (`APP_REPORTING_CURRENCY`, BOB). En producción el job de ingesta siempre la recibe de IDENTITY.
 */
export const DEFAULT_WORKSPACE_BASE_CURRENCY = 'BOB';

/** Workspace destino de las muestras (IDENTITY, vía el composition root). */
export interface RecordTarget {
  readonly workspaceId: string;
  readonly timeZone: string;
  readonly baseCurrency?: string;
}

export interface RecordOptions {
  /** La carga histórica no detecta anomalías (design.md decisión 8). */
  readonly detectAnomalies: boolean;
  /** Un evento por tasa (polling) o uno por workspace y ejecución (carga histórica; design.md decisión 13). */
  readonly eventPerRate: boolean;
  readonly correlationId: string;
  /** Solo relleno: omite muestras de días que ya tienen alguna tasa del feed. */
  readonly skipDaysWithRates: boolean;
}

export interface SampleRecorderDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly currencies: CurrencyRepository;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly thresholds?: AnomalyThresholds;
  readonly pairs: RatePairResolver;
  /**
   * Puerto síncrono de NOTIFY (add-rate-feed-alerts, D249; refine-rate-anomaly-alert-grouping): las muestras retenidas
   * como anómalas se avisan agrupadas, un aviso por par al final de la misma unidad de trabajo que su inserción. Sin él
   * se escribe igual el evento del outbox (uno por muestra).
   */
  readonly notifications?: NotificationIntakePort | undefined;
}

/**
 * Copia de muestras de provider a UN workspace en su propia unidad de trabajo (`SET LOCAL app.workspace_id`),
 * idempotente por (provider, par, tipo, vigencia) (fx/market-rate-providers; design.md decisiones 3, 8 y 13). Registra
 * SOLO las muestras de los pares de la lista configurada del workspace (add-crypto-rate-providers decisión 4): las
 * demás se descartan sin tocar nada. El umbral de anomalía depende de la clase de la moneda base del par (5 % fiat y
 * estables, 10 % cripto volátil; D228). Escrituras del sistema (actor `SYSTEM`): se trazan con `fx.RateRecorded.v1`.
 */
export class SampleRecorder {
  constructor(private readonly deps: SampleRecorderDeps) {}

  /** Tasas nuevas registradas en el workspace. */
  recordIn(
    target: RecordTarget,
    samples: readonly ProviderSample[],
    options: RecordOptions,
  ): Promise<number> {
    if (samples.length === 0) return Promise.resolve(0);
    const { workspaceId, timeZone } = target;
    return this.deps.uow.run(workspaceId, async () => {
      // Con detección de anomalías, las transacciones del mismo workspace se serializan (el orden `(created_at, id)` de
      // las muestras retenidas coincide con el de confirmación) y `now` se lee DESPUÉS del bloqueo. El ciclo normal ya
      // es secuencial, así que en una sola réplica nunca espera.
      if (options.detectAnomalies) await this.deps.rates.lockAnomalyGroups(workspaceId);
      const configured = await this.deps.pairs.effective(
        workspaceId,
        target.baseCurrency ?? DEFAULT_WORKSPACE_BASE_CURRENCY,
      );
      const wanted = new Set(configured.pairs.map(pairKey));
      const thresholds = this.deps.thresholds ?? DEFAULT_ANOMALY_THRESHOLDS;
      const detectors = new Map<AssetClass, AnomalyDetector>();
      const detectorFor = (cls: AssetClass): AnomalyDetector => {
        let d = detectors.get(cls);
        if (!d) {
          d = anomalyDetectorFor(thresholds, cls);
          detectors.set(cls, d);
        }
        return d;
      };
      const now = this.deps.clock.now().toString();
      const daysWithRates = new Map<string, Set<string>>();
      let inserted = 0;
      let last: ExchangeRate | null = null;
      // Pares con alguna muestra retenida nueva en esta transacción (en orden de aparición): un aviso por par al final.
      const retainedPairs = new Map<
        string,
        { base: string; quote: string; thresholdPct: string; sourceEventId: string }
      >();
      const catalog = new Map<string, CurrencyDefinition | null>();
      const currency = async (code: string) => {
        if (!catalog.has(code)) catalog.set(code, await this.deps.currencies.find(code));
        return catalog.get(code) ?? null;
      };
      for (const sample of samples) {
        if (!wanted.has(pairKey(sample))) continue;
        const base = await currency(sample.base);
        const quote = await currency(sample.quote);
        if (!base || !quote) continue;
        const feed = {
          provider: sample.provider,
          base: sample.base,
          quote: sample.quote,
          rateType: sample.rateType,
        };
        const effectiveDate = LocalDate.ofInstant(Instant.parse(sample.asOf), timeZone).toString();
        if (options.skipDaysWithRates) {
          const key = `${feed.base}/${feed.quote}/${feed.rateType}`;
          let days = daysWithRates.get(key);
          if (!days) {
            days = await this.deps.rates.providerDays(workspaceId, feed, '0001-01-01', '9999-12-31');
            daysWithRates.set(key, days);
          }
          if (days.has(effectiveDate)) continue;
        }
        let anomaly = null;
        let baselineFact: { readonly value: string; readonly thresholdPct: string } | null = null;
        if (options.detectAnomalies) {
          const baseline = await this.deps.rates.latestAccepted(workspaceId, feed);
          if (baseline && Date.parse(baseline.rate.snapshot.asOf) < Date.parse(sample.asOf)) {
            const cls = this.deps.pairs.policy.classOf({ code: base.code, kind: base.kind });
            const detector = detectorFor(cls);
            anomaly =
              detector.assess(sample.value, {
                rateId: baseline.rate.id,
                value: baseline.rate.valueText,
              })?.mark ?? null;
            baselineFact = { value: baseline.rate.valueText, thresholdPct: detector.thresholdPct };
          }
        }
        const rate = ExchangeRate.fromProviderSample(sample, {
          id: this.deps.ids.next(),
          workspaceId,
          base: base.toCurrency(),
          quote: quote.toCurrency(),
          effectiveDate,
          createdAt: now,
          anomaly,
        });
        if (!(await this.deps.rates.insertProviderRate(rate))) continue;
        inserted++;
        if (options.eventPerRate) await this.publish(rate, options.correlationId);
        else last = rate;
        // Un único hecho por muestra retenida: la inserción es idempotente (misma vigencia ⇒ `continue` arriba).
        if (options.detectAnomalies && rate.snapshot.anomaly !== null && baselineFact !== null) {
          const eventId = await this.publishRetained(rate, baselineFact, options.correlationId);
          retainedPairs.set(pairKey(sample), {
            base: sample.base,
            quote: sample.quote,
            thresholdPct: baselineFact.thresholdPct,
            sourceEventId: eventId,
          });
        }
      }
      if (last) await this.publish(last, options.correlationId);
      // Consultas y avisos secuenciales: nunca en paralelo sobre el mismo cliente pg de la unidad de trabajo.
      for (const retained of retainedPairs.values()) {
        await this.notifyGroup(workspaceId, timeZone, now, retained);
      }
      return inserted;
    });
  }

  /**
   * Un aviso por par con muestras retenidas nuevas (refine-rate-anomaly-alert-grouping): calcula el grupo vigente del par
   * (`AnomalyGroupResolver` sobre las retenidas del par con sus revisiones) y entrega su foto a NOTIFY, que crea el aviso
   * del grupo o lo actualiza. La clave es el ancla del grupo: determinista, la misma en cualquier reintento.
   */
  private async notifyGroup(
    workspaceId: string,
    timeZone: string,
    now: string,
    retained: { base: string; quote: string; thresholdPct: string; sourceEventId: string },
  ): Promise<void> {
    if (!this.deps.notifications) return;
    const group = resolveAnomalyGroup(
      await this.deps.rates.retainedOfPair(workspaceId, retained.base, retained.quote),
    );
    if (!group) return;
    const baseline = await this.deps.rates.findById(workspaceId, group.peak.baselineRateId);
    if (!baseline) return;
    const fact: RateAnomalyGroupFact = {
      anchorRateId: group.anchorRateId,
      base: retained.base,
      quote: retained.quote,
      pendingCount: group.pendingCount,
      retainedCount: group.retainedCount,
      providers: group.providers,
      reviewRateId: group.reviewRateId,
      peak: {
        rateId: group.peak.rateId,
        base: retained.base,
        quote: retained.quote,
        rateType: group.peak.rateType,
        provider: group.peak.provider,
        value: group.peak.value,
        baselineRateId: group.peak.baselineRateId,
        baselineValue: baseline.rate.valueText,
        variationPct: group.peak.variationPct,
        thresholdPct: retained.thresholdPct,
        detectedAt: now,
        timeZone,
      },
      firstRetainedAt: group.firstRetainedAt,
      lastRetainedAt: now,
      detectedAt: now,
      timeZone,
    };
    await this.deps.notifications.notify({
      workspaceId,
      type: 'FX_RATE_ANOMALY_RETAINED',
      factKey: group.anchorRateId,
      sourceEventId: retained.sourceEventId,
      occurredAt: now,
      payload: fact,
    });
  }

  /**
   * `fx.RateAnomalyRetained.v1`: uno por muestra retenida, en la misma unidad de trabajo que su inserción (sin cambios;
   * el aviso se agrupa por par en `notifyGroup`). Actor `SYSTEM fx-provider:<ciclo>`; la muestra sigue retenida hasta su
   * revisión (D236). Devuelve el id del evento (origen del aviso).
   */
  private async publishRetained(
    rate: ExchangeRate,
    baseline: { readonly value: string; readonly thresholdPct: string },
    correlationId: string,
  ): Promise<string> {
    const s = rate.snapshot;
    const anomaly = s.anomaly;
    if (!anomaly) throw new Error('a retained sample needs its anomaly mark');
    const workspaceId = s.workspaceId as string;
    const eventId = this.deps.ids.next();
    const occurredAt = this.deps.clock.now().toString();
    await this.deps.outbox.append({
      eventId,
      eventType: FX_EVENTS.rateAnomalyRetained.eventType,
      eventVersion: FX_EVENTS.rateAnomalyRetained.eventVersion,
      occurredAt,
      workspaceId,
      aggregateType: 'ExchangeRate',
      aggregateId: s.id,
      aggregateVersion: 1,
      actor: { type: 'SYSTEM', id: `fx-provider:${correlationId}` },
      correlationId,
      payload: {
        rateId: s.id,
        base: s.rate.base.code,
        quote: s.rate.quote.code,
        rateType: s.rateType,
        provider: String(s.provider),
        value: rate.valueText,
        baselineRateId: anomaly.baselineRateId,
        baselineValue: baseline.value,
        variationPct: anomaly.variationPct,
        thresholdPct: baseline.thresholdPct,
      },
    });
    return eventId;
  }

  /** `fx.RateRecorded.v1` (aditivo: `provider`, `anomalyFlagged`) con actor `SYSTEM fx-provider:<id>`. */
  private publish(rate: ExchangeRate, correlationId: string): Promise<void> {
    const s = rate.snapshot;
    return this.deps.outbox.append({
      eventId: this.deps.ids.next(),
      eventType: FX_EVENTS.rateRecorded.eventType,
      eventVersion: FX_EVENTS.rateRecorded.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: s.workspaceId as string,
      aggregateType: 'ExchangeRate',
      aggregateId: s.id,
      aggregateVersion: 1,
      actor: { type: 'SYSTEM', id: `fx-provider:${String(s.provider)}` },
      correlationId,
      payload: {
        rateId: s.id,
        base: s.rate.base.code,
        quote: s.rate.quote.code,
        value: rate.valueText,
        rateType: s.rateType,
        source: s.source,
        sourceLabel: s.sourceLabel,
        asOf: s.asOf,
        effectiveDate: s.effectiveDate,
        supersedesRateId: null,
        provider: s.provider,
        anomalyFlagged: s.anomaly !== null,
      },
    });
  }
}
