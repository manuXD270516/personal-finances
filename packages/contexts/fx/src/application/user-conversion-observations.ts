import { DomainError, Instant } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import { ExchangeRate } from '../domain/index.js';
import type {
  ExchangeRateRepository,
  CurrencyRepository,
  IdGenerator,
  OutboxPort,
  UnitOfWork,
} from './ports/index.js';
import type { Clock } from '@pf/shared-kernel';

/** Actor de los hechos que registra el consumidor (no hay usuario en el worker). */
const SYSTEM_ACTOR = { type: 'SYSTEM', id: 'fx-user-conversion' } as const;
const VOIDED_REASON = 'conversión anulada';

export interface UserConversionObservationDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly currencies: CurrencyRepository;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Hecho común de `ConversionRecorded.v1` y `ConversionRevised.v1` que origina una observación. */
export interface ConversionObservationFact {
  readonly workspaceId: string;
  readonly transactionId: string;
  /** Revisión del `ConversionDetail` observada (1 en el registro; `revisionTo` en una revisión). */
  readonly revision: number;
  /** Par en la orientación de visualización de la conversión. */
  readonly base: string;
  readonly quote: string;
  /** Tasa efectiva registrada. */
  readonly value: string;
  readonly executedAt: string;
  /** Fecha de negocio de la conversión. */
  readonly businessDate: string;
}

export type ObservationOutcome = 'RECORDED' | 'REPLACED' | 'DUPLICATE' | 'STALE';
export type WithdrawalOutcome = 'WITHDRAWN' | 'DUPLICATE' | 'NO_OBSERVATION';

/** Conversión posteada anterior al cambio, tal como la entrega la carga inicial (adapter de TRANSACTIONS). */
export interface BackfillConversion extends Omit<ConversionObservationFact, 'workspaceId'> {
  readonly voided: boolean;
}

/** Fuente de la carga inicial: revisión vigente de las conversiones del workspace, anuladas incluidas. */
export interface ConversionBackfillSource {
  listCurrentConversions(workspaceId: string): Promise<readonly BackfillConversion[]>;
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;

/**
 * Hecho de observación de un payload `ConversionRecorded.v1` (revisión 1 si el payload no la trae) o
 * `ConversionRevised.v1` (`revisionTo`). Un payload mal formado falla fuerte: el evento va a reintentos y a la
 * dead-letter, nunca se descarta en silencio.
 */
export function observationFactOf(workspaceId: string, payload: unknown): ConversionObservationFact {
  const p = asObject(payload);
  const effective = asObject(p?.['effectiveRate']);
  const transactionId = asString(p?.['transactionId']);
  const revisionRaw = p?.['revisionTo'] ?? p?.['revision'] ?? 1;
  const base = asString(effective?.['base']);
  const quote = asString(effective?.['quote']);
  const value = asString(effective?.['value']);
  const executedAt = asString(p?.['executedAt']);
  const businessDate = asString(p?.['businessDate']);
  if (
    !transactionId ||
    !base ||
    !quote ||
    !value ||
    !executedAt ||
    !businessDate ||
    typeof revisionRaw !== 'number' ||
    !Number.isInteger(revisionRaw) ||
    revisionRaw < 1
  ) {
    throw new DomainError('VALIDATION_FAILED', 'conversion event payload is not a valid conversion fact');
  }
  return {
    workspaceId,
    transactionId,
    revision: revisionRaw,
    base,
    quote,
    value,
    executedAt,
    businessDate,
  };
}

/**
 * `RecordUserConversionObservation` (fx/market-rates, D231): cada conversión posteada queda en el historial de su par
 * como una observación INMUTABLE con origen `USER_CONVERSION` (tasa efectiva, vigencia = ejecución, tipo `CUSTOM`);
 * nunca se usa para valorar (`RateResolver` y el repositorio la excluyen). Corre en la unidad de trabajo del consumidor
 * (inbox + RLS del workspace): la fila y su `fx.RateRecorded.v1` se confirman juntas.
 *   - Idempotencia de negocio: el índice único por (workspace, conversión, revisión) hace que reprocesar el mismo hecho
 *     no registre una segunda observación y no emita un segundo evento.
 *   - Revisión: la observación de la revisión nueva REEMPLAZA a la vigente con el motivo "conversión revisada".
 *   - Anulación: marca la observación vigente como anulada en `fx.rate_withdrawal`, sin tocar la tasa.
 * Sin auditoría de usuario: son hechos derivados del sistema, trazados con su evento (como las tasas de providers).
 */
export class UserConversionObservations {
  constructor(private readonly deps: UserConversionObservationDeps) {}

  /** Registra la observación de una revisión de conversión (registro o revisión). */
  record(fact: ConversionObservationFact): Promise<ObservationOutcome> {
    return this.deps.uow.run(fact.workspaceId, () => this.recordInTransaction(fact));
  }

  /** Marca como anulada la observación vigente de la conversión (sin observación: no hace nada). */
  withdraw(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<WithdrawalOutcome> {
    return this.deps.uow.run(input.workspaceId, () => this.withdrawInTransaction(input));
  }

  /**
   * Carga inicial idempotente (D231, tarea 4.4): registra la revisión vigente de cada conversión anterior al cambio y
   * marca las anuladas. Repetirla no registra nada más. Una sola unidad de trabajo por workspace.
   */
  backfill(
    workspaceId: string,
    source: ConversionBackfillSource,
  ): Promise<{ readonly recorded: number; readonly withdrawn: number }> {
    return this.deps.uow.run(workspaceId, async () => {
      let recorded = 0;
      let withdrawn = 0;
      for (const c of await source.listCurrentConversions(workspaceId)) {
        const outcome = await this.recordInTransaction({ ...c, workspaceId });
        if (outcome === 'RECORDED' || outcome === 'REPLACED') recorded += 1;
        if (c.voided) {
          const w = await this.withdrawInTransaction({ workspaceId, transactionId: c.transactionId });
          if (w === 'WITHDRAWN') withdrawn += 1;
        }
      }
      return { recorded, withdrawn };
    });
  }

  // ------------------------------------------------------------------ interno

  private async recordInTransaction(fact: ConversionObservationFact): Promise<ObservationOutcome> {
    const { rates, currencies, ids, clock } = this.deps;
    const current = await rates.currentUserConversionObservation(fact.workspaceId, fact.transactionId);
    const currentRevision = current?.rate.snapshot.conversionRef?.revision ?? 0;
    if (current && currentRevision === fact.revision) return 'DUPLICATE';
    // Un evento atrasado (revisión menor que la ya observada) no reemplaza a una más nueva ni la deshace.
    if (current && currentRevision > fact.revision) return 'STALE';
    const base = await currencies.find(fact.base);
    const quote = await currencies.find(fact.quote);
    if (!base || !quote) {
      throw new DomainError(
        'CURRENCY_NOT_ENABLED',
        `currency ${base ? fact.quote : fact.base} is not in the catalog`,
      );
    }
    const replaces = current && current.supersededById === null ? current.rate : null;
    const observation = ExchangeRate.userConversionObservation(
      {
        id: ids.next(),
        workspaceId: fact.workspaceId,
        base: base.toCurrency(),
        quote: quote.toCurrency(),
        value: fact.value,
        executedAt: Instant.parse(fact.executedAt).toString(),
        effectiveDate: fact.businessDate,
        conversion: { transactionId: fact.transactionId, revision: fact.revision },
        createdAt: clock.now().toString(),
      },
      replaces,
    );
    if (!(await rates.insertUserConversionObservation(observation))) return 'DUPLICATE';
    await this.publish(observation);
    return replaces ? 'REPLACED' : 'RECORDED';
  }

  private async withdrawInTransaction(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<WithdrawalOutcome> {
    const current = await this.deps.rates.currentUserConversionObservation(
      input.workspaceId,
      input.transactionId,
    );
    if (!current) return 'NO_OBSERVATION';
    const inserted = await this.deps.rates.insertWithdrawal({
      rateId: current.rate.id,
      workspaceId: input.workspaceId,
      transactionId: input.transactionId,
      reason: VOIDED_REASON,
      withdrawnAt: this.deps.clock.now().toString(),
    });
    return inserted ? 'WITHDRAWN' : 'DUPLICATE';
  }

  /** `fx.RateRecorded.v1` en la misma unidad de trabajo (consumidor actual: REPORTING invalida su `dataVersion`). */
  private async publish(rate: ExchangeRate): Promise<void> {
    const s = rate.snapshot;
    await this.deps.outbox.append({
      actor: SYSTEM_ACTOR,
      eventId: this.deps.ids.next(),
      eventType: FX_EVENTS.rateRecorded.eventType,
      eventVersion: FX_EVENTS.rateRecorded.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: s.workspaceId as string,
      aggregateType: 'ExchangeRate',
      aggregateId: s.id,
      aggregateVersion: 1,
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
        supersedesRateId: s.supersedesId,
        provider: s.provider,
      },
    });
  }
}
