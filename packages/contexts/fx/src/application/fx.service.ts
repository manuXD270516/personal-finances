import type {
  AuditChangeInput,
  AuditPort,
  LifecycleDto,
  LifecycleEventRefDto,
  LifecycleTransitionInput,
} from '@pf/audit/contracts';
import { DomainError, Instant, LocalDate, type Currency } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import {
  DEFAULT_WORKSPACE_CURRENCIES,
  EXCHANGE_RATE_LIFECYCLE,
  ExchangeRate,
  isFxRateType,
  type FxRateType,
} from '../domain/index.js';
import { notFound } from './fx.queries.js';
import type { FxDeps, RatePreference, RatePreferenceSet, StoredRate } from './ports/index.js';

export interface RecordManualRateCommand {
  readonly workspaceId: string;
  readonly userId: string | null;
  readonly base: string;
  readonly quote: string;
  readonly value: string;
  readonly rateType: FxRateType;
  readonly asOf: string;
  readonly sourceLabel?: string | null;
}

export interface SupersedeRateCommand {
  readonly workspaceId: string;
  readonly userId: string | null;
  readonly rateId: string;
  readonly value: string;
  readonly reason: string;
  readonly sourceLabel?: string | null;
}

export interface ReviewRateAnomalyCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly rateId: string;
  readonly decision: 'CONFIRM' | 'REJECT';
  readonly reason: string;
}

export interface ReplacePreferencesCommand {
  readonly workspaceId: string;
  readonly expectedVersion: number;
  readonly preferences: readonly RatePreference[];
}

/**
 * Comandos de FX (fx/market-rates; design.md decisiones 5, 6, 8, 9). Cada uno corre en UNA unidad de trabajo:
 * validación → agregado inmutable → repositorio append-only → outbox `fx.RateRecorded.v1` → auditoría (INV-029).
 */
export class FxService {
  constructor(
    private readonly deps: FxDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  /** `RecordManualRate` (FR-FX-002): tasa del workspace con origen MANUAL; el valor se guarda exacto. */
  recordManualRate(cmd: RecordManualRateCommand): Promise<StoredRate> {
    return this.deps.uow.run(cmd.workspaceId, async () => {
      if (!isFxRateType(cmd.rateType)) {
        throw new DomainError('VALIDATION_FAILED', `invalid rate type ${String(cmd.rateType)}`).at(
          '/rateType',
        );
      }
      const base = await this.currency(cmd.base, '/base');
      const quote = await this.currency(cmd.quote, '/quote');
      const asOf = Instant.parse(cmd.asOf);
      const rate = ExchangeRate.record({
        id: this.deps.ids.next(),
        workspaceId: cmd.workspaceId,
        base,
        quote,
        value: cmd.value,
        rateType: cmd.rateType,
        source: 'MANUAL',
        sourceLabel: cmd.sourceLabel ?? null,
        asOf: asOf.toString(),
        effectiveDate: await this.effectiveDate(cmd.workspaceId, asOf),
        createdAt: this.deps.clock.now().toString(),
        createdBy: cmd.userId,
      });
      await this.deps.rates.insert(rate);
      const recorded = await this.publish(rate);
      await this.deps.lifecycle.record(
        {
          workspaceId: cmd.workspaceId,
          action: 'fx.exchange_rate.recorded',
          aggregateType: 'ExchangeRate',
          aggregateId: rate.id,
          aggregateVersion: 1,
          changes: rateChanges(rate),
        },
        [rateStep('RECORD', null, [recorded])],
      );
      return { rate, supersededById: null };
    });
  }

  /**
   * `SupersedeRate` (FR-FX-003): nueva versión con motivo que reemplaza a la indicada (misma vigencia, tipo y par);
   * la original sigue consultable. Reemplazar dos veces la misma versión ⇒ `FX_RATE_ALREADY_SUPERSEDED` (409).
   */
  supersedeRate(cmd: SupersedeRateCommand): Promise<StoredRate> {
    return this.deps.uow.run(cmd.workspaceId, async () => {
      const original = await this.deps.rates.findById(cmd.workspaceId, cmd.rateId);
      if (!original) throw notFound(cmd.rateId);
      const next = original.rate.supersede(
        {
          id: this.deps.ids.next(),
          value: cmd.value,
          reason: cmd.reason,
          ...(cmd.sourceLabel !== undefined ? { sourceLabel: cmd.sourceLabel } : {}),
          createdAt: this.deps.clock.now().toString(),
          createdBy: cmd.userId,
        },
        original.supersededById,
      );
      await this.deps.rates.insert(next);
      const recorded = await this.publish(next);
      // Una corrección registra la versión nueva (RECORD) y reemplaza la original (SUPERSEDE, enlazada a la nueva),
      // ambas respaldadas por el mismo registro de auditoría (add-lifecycle-timeline decisión 4; INV-011).
      await this.deps.lifecycle.record(
        {
          workspaceId: cmd.workspaceId,
          action: 'fx.exchange_rate.superseded',
          aggregateType: 'ExchangeRate',
          aggregateId: next.id,
          aggregateVersion: 1,
          reason: next.snapshot.supersedeReason,
          changes: [
            ...rateChanges(next),
            { field: 'value', before: original.rate.valueText, after: next.valueText },
          ],
        },
        [
          { ...rateStep('RECORD', null, [recorded]), detailRefs: { supersedesRateId: original.rate.id } },
          {
            ...rateStep('SUPERSEDE', 'RECORDED', []),
            aggregateId: original.rate.id,
            aggregateVersion: 2,
            detailRefs: { supersededByRateId: next.id },
          },
        ],
      );
      return { rate: next, supersededById: null };
    });
  }

  /**
   * `ReviewRateAnomaly` (fx/market-rate-providers; design.md decisión 8): un EDITOR/OWNER confirma o rechaza una tasa
   * de provider marcada como anómala, con motivo obligatorio. La tasa sigue inmutable: la decisión es una fila
   * append-only de `fx.rate_anomaly_review` y se audita en la misma transacción (INV-029). Una tasa no marcada ⇒
   * `FX_RATE_NOT_ANOMALOUS` (422); una segunda revisión ⇒ `FX_RATE_ANOMALY_ALREADY_REVIEWED` (409).
   */
  reviewAnomaly(cmd: ReviewRateAnomalyCommand): Promise<StoredRate> {
    return this.deps.uow.run(cmd.workspaceId, async () => {
      if (cmd.decision !== 'CONFIRM' && cmd.decision !== 'REJECT') {
        throw new DomainError('VALIDATION_FAILED', 'decision must be CONFIRM or REJECT').at('/decision');
      }
      const reason = typeof cmd.reason === 'string' ? cmd.reason.trim() : '';
      if (reason.length < 3 || reason.length > 500) {
        throw new DomainError('VALIDATION_FAILED', 'reason must have between 3 and 500 characters').at(
          '/reason',
        );
      }
      const stored = await this.deps.rates.findById(cmd.workspaceId, cmd.rateId);
      if (!stored) throw notFound(cmd.rateId);
      if (stored.rate.snapshot.anomaly === null) {
        throw new DomainError('FX_RATE_NOT_ANOMALOUS', `fx rate ${cmd.rateId} is not flagged as anomalous`);
      }
      if (stored.anomalyReview) {
        throw new DomainError(
          'FX_RATE_ANOMALY_ALREADY_REVIEWED',
          `the anomaly of fx rate ${cmd.rateId} was already ${stored.anomalyReview.decision.toLowerCase()}`,
        );
      }
      const review = {
        rateId: stored.rate.id,
        workspaceId: cmd.workspaceId,
        decision: cmd.decision === 'CONFIRM' ? ('CONFIRMED' as const) : ('REJECTED' as const),
        reason,
        decidedBy: cmd.userId,
        decidedAt: this.deps.clock.now().toString(),
      };
      await this.deps.reviews.insert(review);
      // Los estados de revisión de anomalías los declarará su change con el mismo mecanismo: hoy, anotación.
      await this.deps.lifecycle.record(
        {
          workspaceId: cmd.workspaceId,
          action: 'fx.exchange_rate.anomaly_reviewed',
          aggregateType: 'ExchangeRate',
          aggregateId: stored.rate.id,
          aggregateVersion: 2,
          reason,
          changes: [{ field: 'anomalyStatus', before: 'PENDING', after: review.decision }],
        },
        [{ kind: 'ANNOTATION', changedFields: ['anomalyStatus'] }],
      );
      return { ...stored, anomalyReview: review };
    });
  }

  /** `SetRatePreferences` (FR-FX-006): reemplazo completo de la lista con `If-Match`; no altera tasas ni transacciones. */
  replacePreferences(cmd: ReplacePreferencesCommand): Promise<RatePreferenceSet> {
    return this.deps.uow.run(cmd.workspaceId, async () => {
      const current = await this.deps.preferences.get(cmd.workspaceId, { forUpdate: true });
      if (current.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: current.version },
        });
      }
      const seen = new Set<string>();
      for (const [i, p] of cmd.preferences.entries()) {
        if (p.base === p.quote) {
          throw new DomainError('VALIDATION_FAILED', 'base and quote must differ').at(`/data/${i}/quote`);
        }
        if (!isFxRateType(p.rateType)) {
          throw new DomainError('VALIDATION_FAILED', 'invalid rate type').at(`/data/${i}/rateType`);
        }
        await this.currency(p.base, `/data/${i}/base`);
        await this.currency(p.quote, `/data/${i}/quote`);
        const key = [p.base, p.quote].sort().join('/');
        if (seen.has(key)) {
          throw new DomainError('VALIDATION_FAILED', `duplicate pair ${key}`).at(`/data/${i}`);
        }
        seen.add(key);
      }
      if (!(await this.deps.preferences.replace(cmd.workspaceId, cmd.preferences, cmd.expectedVersion))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the preferences were modified concurrently');
      }
      const next: RatePreferenceSet = { preferences: cmd.preferences, version: current.version + 1 };
      await this.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'fx.rate_preferences.replaced',
        aggregateType: 'RatePreferences',
        aggregateId: cmd.workspaceId,
        aggregateVersion: next.version,
        // JSON canónico: la auditoría solo admite valores planos o `Money`.
        changes: [
          {
            field: 'preferences',
            before: JSON.stringify(current.preferences),
            after: JSON.stringify(next.preferences),
          },
        ],
      });
      return next;
    });
  }

  /** Gancho síncrono de `CreateWorkspace`: habilita BOB, USD, USDT y la moneda base (idempotente). */
  onWorkspaceCreated(input: { readonly workspaceId: string; readonly baseCurrency?: string }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const codes = new Set<string>(DEFAULT_WORKSPACE_CURRENCIES);
      if (input.baseCurrency) codes.add(input.baseCurrency);
      const active: string[] = [];
      for (const code of codes) if (await this.deps.currencies.find(code)) active.push(code);
      await this.deps.currencies.enable(input.workspaceId, active);
    });
  }

  /**
   * Habilita monedas ACTIVAS del catálogo en el workspace (idempotente; conserva las ya habilitadas, incluido el
   * conjunto por defecto de un workspace sin filas). Sin endpoint en Phase 1: lo usan los cargadores de datos (seed y
   * demo) para abrir cuentas en monedas fuera del conjunto por defecto (docs/31 D45). Inexistente o inactiva ⇒
   * `CURRENCY_NOT_ENABLED`.
   */
  enableCurrencies(input: {
    readonly workspaceId: string;
    readonly codes: readonly string[];
  }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      for (const [i, code] of input.codes.entries()) await this.currency(code, `/codes/${i}`);
      const current = (await this.deps.currencies.list(input.workspaceId, {}))
        .filter((r) => r.enabled)
        .map((r) => r.definition.code);
      await this.deps.currencies.enable(input.workspaceId, [...new Set([...current, ...input.codes])]);
    });
  }

  // ------------------------------------------------------------------ helpers

  private async currency(code: string, pointer: string): Promise<Currency> {
    const def = await this.deps.currencies.find(code);
    if (!def) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(pointer);
    return def.toCurrency();
  }

  private async effectiveDate(workspaceId: string, asOf: Instant): Promise<string> {
    const { timeZone } = await this.deps.workspaces.settingsOf(workspaceId);
    return LocalDate.ofInstant(asOf, timeZone).toString();
  }

  /** `fx.RateRecorded.v1` en la misma unidad de trabajo (idempotencia natural `rateId`). */
  private async publish(rate: ExchangeRate): Promise<LifecycleEventRefDto> {
    const s = rate.snapshot;
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
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
    return {
      eventId,
      eventType: `${FX_EVENTS.rateRecorded.eventType}.v${FX_EVENTS.rateRecorded.eventVersion}`,
    };
  }

  /**
   * `GET W/fx-rates/{id}/lifecycle` (add-lifecycle-timeline decisión 7; VIEWER+): verifica que la tasa existe en el
   * workspace (otro workspace ⇒ 404, RLS) y pide su recorrido a AUDIT con su estado (RECORDED/SUPERSEDED).
   */
  rateLifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly rateId: string;
  }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const stored = await this.deps.rates.findById(input.workspaceId, input.rateId);
      if (!stored) throw notFound(input.rateId);
      return this.deps.lifecycleQuery.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'ExchangeRate',
        aggregateId: stored.rate.id,
        currentState: stored.supersededById ? 'SUPERSEDED' : 'RECORDED',
      });
    });
  }
}

/** Paso de la máquina `ExchangeRate` validado contra `EXCHANGE_RATE_LIFECYCLE` (única fuente de las reglas). */
function rateStep(
  code: 'RECORD' | 'SUPERSEDE',
  from: 'RECORDED' | null,
  events: readonly LifecycleEventRefDto[],
): LifecycleTransitionInput {
  const t = EXCHANGE_RATE_LIFECYCLE.transition(code, from);
  return {
    kind: 'TRANSITION',
    transition: t.transition,
    fromState: t.from,
    toState: t.to,
    machineVersion: EXCHANGE_RATE_LIFECYCLE.version,
    events,
  };
}

function rateChanges(rate: ExchangeRate): AuditChangeInput[] {
  const s = rate.snapshot;
  const out: AuditChangeInput[] = [
    { field: 'base', before: null, after: s.rate.base.code },
    { field: 'quote', before: null, after: s.rate.quote.code },
    { field: 'rateType', before: null, after: s.rateType },
    { field: 'source', before: null, after: s.source },
    { field: 'asOf', before: null, after: s.asOf },
    { field: 'effectiveDate', before: null, after: s.effectiveDate },
  ];
  if (s.supersedesId === null) out.push({ field: 'value', before: null, after: rate.valueText });
  if (s.sourceLabel !== null) out.push({ field: 'sourceLabel', before: null, after: s.sourceLabel });
  if (s.supersedesId !== null) out.push({ field: 'supersedesRateId', before: null, after: s.supersedesId });
  return out;
}
