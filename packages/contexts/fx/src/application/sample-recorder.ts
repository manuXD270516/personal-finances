import { Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import {
  anomalyDetectorFor,
  DEFAULT_ANOMALY_THRESHOLDS,
  ExchangeRate,
  pairKey,
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
        if (options.detectAnomalies) {
          const baseline = await this.deps.rates.latestAccepted(workspaceId, feed);
          if (baseline && Date.parse(baseline.rate.snapshot.asOf) < Date.parse(sample.asOf)) {
            const cls = this.deps.pairs.policy.classOf({ code: base.code, kind: base.kind });
            anomaly =
              detectorFor(cls).assess(sample.value, {
                rateId: baseline.rate.id,
                value: baseline.rate.valueText,
              })?.mark ?? null;
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
      }
      if (last) await this.publish(last, options.correlationId);
      return inserted;
    });
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
