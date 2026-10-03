import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { FxQueries } from '../application/fx.queries.js';
import type { FxService } from '../application/fx.service.js';
import {
  anomalyStatusOf,
  type RateListFilter,
  type RatePreference,
  type StoredRate,
} from '../application/ports/index.js';
import type { ProviderStatus, ProviderStatusQueries } from '../application/provider-status.queries.js';
import {
  attributionOf,
  ExchangeRate,
  type CurrencyKind,
  type ExchangeRateState,
  type FxRateProvider,
  type FxRateSource,
  type FxRateType,
  type ResolvedRate,
} from '../domain/index.js';

export const FX_SERVICE = Symbol('FX_SERVICE');
export const FX_QUERIES = Symbol('FX_QUERIES');
export const FX_PROVIDER_STATUS = Symbol('FX_PROVIDER_STATUS');
/** Umbral informado en `FxRate.anomaly.thresholdPct` cuando no se configuró otro (design.md decisión 5). */
const DEFAULT_THRESHOLD_PCT = '5';

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
const bool = (b: Json, k: string): boolean | undefined => {
  const v = b[k];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** `FxRateAnomaly` del contrato (`null` si la tasa no está marcada). */
function anomalyDto(stored: StoredRate, thresholdPct: string) {
  const mark = stored.rate.snapshot.anomaly;
  if (!mark) return null;
  const review = stored.anomalyReview ?? null;
  return {
    baselineRateId: mark.baselineRateId,
    variationPct: mark.variationPct,
    thresholdPct,
    status: anomalyStatusOf(stored),
    reviewedBy: review?.decidedBy ?? null,
    reviewedAt: review?.decidedAt ?? null,
    reason: review?.reason ?? null,
  };
}

/** `FxRate` del contrato (valor exacto como string decimal, nunca `number`; sin la respuesta cruda). */
export function toFxRateDto(stored: StoredRate, thresholdPct: string = DEFAULT_THRESHOLD_PCT) {
  const s: ExchangeRateState = stored.rate.snapshot;
  return {
    id: s.id,
    base: s.rate.base.code,
    quote: s.rate.quote.code,
    value: stored.rate.valueText,
    rateType: s.rateType,
    source: s.source,
    sourceLabel: s.sourceLabel,
    asOf: s.asOf,
    effectiveDate: s.effectiveDate,
    supersedesRateId: s.supersedesId,
    supersededByRateId: stored.supersededById,
    supersedeReason: s.supersedeReason,
    createdAt: s.createdAt,
    ...(s.createdBy ? { createdBy: s.createdBy } : {}),
    provider: s.provider,
    fetchedAt: s.fetchedAt,
    attribution: s.provider ? attributionOf(s.provider) : null,
    anomaly: anomalyDto(stored, thresholdPct),
  };
}

/** `ResolvedRate` del contrato: la directa con su valor exacto; inversa/cruzada a 18 decimales HALF_EVEN (solo display). */
export function toResolvedRateDto(r: ResolvedRate) {
  const component = (s: ExchangeRateState) => toFxRateDto({ rate: rehydrated(s), supersededById: null });
  return {
    rate: {
      base: r.rate.base.code,
      quote: r.rate.quote.code,
      value: r.derivation === 'DIRECT' ? r.rate.value.toFixed() : r.rate.toPersisted(),
    },
    fxRateId: r.fxRateId,
    derivation: r.derivation,
    components: r.components.map(component),
    rateType: r.rateType,
    source: r.source,
    asOf: r.asOf,
    ageDays: r.ageDays,
    ageSeconds: r.ageSeconds,
    approx: r.approx,
    provider: r.provider,
    selection: r.selection,
    stale: r.stale,
    attribution: r.provider ? attributionOf(r.provider) : null,
  };
}

/** `FxProviderStatus` del contrato. */
export function toProviderStatusDto(p: ProviderStatus, thresholdPct: string = DEFAULT_THRESHOLD_PCT) {
  return {
    provider: p.provider,
    enabled: p.enabled,
    health: p.health,
    feeds: p.feeds.map((f) => ({
      base: f.base,
      quote: f.quote,
      rateType: f.rateType,
      role: f.role,
      lastRate: f.lastRate ? toFxRateDto(f.lastRate, thresholdPct) : null,
      stale: f.stale,
      ageSeconds: f.ageSeconds,
    })),
    lastAttemptAt: p.lastAttemptAt,
    lastSuccessAt: p.lastSuccessAt,
    lastError: p.lastError,
    consecutiveFailures: p.consecutiveFailures,
    nextAttemptAt: p.nextAttemptAt,
    pollIntervalSeconds: p.pollIntervalSeconds,
    rateLimit: p.rateLimit,
    backfill: p.backfill,
    attribution: p.attribution,
  };
}

/** Rehidratación local de una componente (solo para serializarla): el estado ya es inmutable. */
const rehydrated = (s: ExchangeRateState) => ExchangeRate.rehydrate(s);

/**
 * `/api/v1/workspaces/{workspaceId}/{currencies, fx-rates*, fx-rate-preferences}` (design.md § Contratos).
 * Autenticación y `x-required-role` los aplica el guard global de IDENTITY; validación de contrato, Problem Details,
 * ETag/If-Match e `Idempotency-Key` (en la transacción del comando), las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class FxController {
  constructor(
    @Inject(FX_SERVICE) private readonly service: FxService,
    @Inject(FX_QUERIES) private readonly queries: FxQueries,
    @Inject(FX_PROVIDER_STATUS) private readonly providers: ProviderStatusQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  private get threshold(): string {
    return this.queries.anomalyThresholdPct;
  }

  @Get('workspaces/:workspaceId/currencies')
  async listCurrencies(
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const enabled = bool(query, 'enabled');
    const rows = await this.queries.listCurrencies(workspaceId, {
      ...(str(query, 'kind') ? { kind: str(query, 'kind') as CurrencyKind } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(str(query, 'q') ? { q: str(query, 'q') as string } : {}),
    });
    // Catálogo de datos de referencia (cambia solo por migración): ETag estable.
    res.setHeader('etag', '"1"');
    return {
      data: rows.map((r) => {
        const d = r.definition.snapshot;
        return {
          code: d.code,
          kind: d.kind,
          name: d.name,
          scale: d.scale,
          symbol: d.symbol,
          enabled: r.enabled,
        };
      }),
    };
  }

  @Get('workspaces/:workspaceId/fx-rates')
  async listFxRates(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filter: RateListFilter = {
      ...(str(query, 'base') ? { base: str(query, 'base') as string } : {}),
      ...(str(query, 'quote') ? { quote: str(query, 'quote') as string } : {}),
      ...(str(query, 'rateType') ? { rateType: str(query, 'rateType') as FxRateType } : {}),
      ...(str(query, 'source') ? { source: str(query, 'source') as FxRateSource } : {}),
      ...(str(query, 'provider') ? { provider: str(query, 'provider') as FxRateProvider } : {}),
      ...(str(query, 'asOfFrom') ? { asOfFrom: str(query, 'asOfFrom') as string } : {}),
      ...(str(query, 'asOfTo') ? { asOfTo: str(query, 'asOfTo') as string } : {}),
      includeSuperseded: bool(query, 'includeSuperseded') ?? false,
    };
    const scope = { resource: 'fx-rates', workspaceId, filters: { ...filter } };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const found = await this.queries.listRates(workspaceId, filter, { offset, limit: limit + 1 });
    const rows = found.map((s, i) => ({ s, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => toFxRateDto(r.s, this.threshold)), page: page.page };
  }

  @Post('workspaces/:workspaceId/fx-rates')
  @HttpCode(201)
  async createFxRate(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const stored = await this.service.recordManualRate({
      workspaceId,
      userId: userIdOf(req),
      base: str(body, 'base') ?? '',
      quote: str(body, 'quote') ?? '',
      value: str(body, 'value') ?? '',
      rateType: body['rateType'] as FxRateType,
      asOf: str(body, 'asOf') ?? '',
      sourceLabel: str(body, 'sourceLabel') ?? null,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/fx-rates/${stored.rate.id}`);
    res.setHeader('etag', '"1"');
    return toFxRateDto(stored);
  }

  @Get('workspaces/:workspaceId/fx-rates/latest')
  async getLatestFxRate(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const resolved = await this.queries.latest({
      workspaceId,
      base: str(query, 'base') ?? '',
      quote: str(query, 'quote') ?? '',
      ...(str(query, 'asOf') ? { asOf: str(query, 'asOf') as string } : {}),
      rateType: (str(query, 'rateType') as FxRateType | undefined) ?? null,
      allowCross: bool(query, 'allowCross') ?? false,
    });
    return toResolvedRateDto(resolved);
  }

  @Get('workspaces/:workspaceId/fx-rates/:fxRateId')
  async getFxRate(
    @Param('workspaceId') workspaceId: string,
    @Param('fxRateId') fxRateId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const stored = await this.queries.getRate(workspaceId, fxRateId);
    // Inmutable: el ETag solo cambia cuando la tasa queda reemplazada (supersededByRateId).
    res.setHeader('etag', stored.supersededById ? '"2"' : '"1"');
    return toFxRateDto(stored, this.threshold);
  }

  @Post('workspaces/:workspaceId/fx-rates/:fxRateId/anomaly-review')
  @HttpCode(200)
  async reviewFxRateAnomaly(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('fxRateId') fxRateId: string,
    @Body() body: Json,
  ) {
    const stored = await this.service.reviewAnomaly({
      workspaceId,
      userId: userIdOf(req),
      rateId: fxRateId,
      decision: body['decision'] as 'CONFIRM' | 'REJECT',
      reason: str(body, 'reason') ?? '',
    });
    return toFxRateDto(stored, this.threshold);
  }

  @Get('workspaces/:workspaceId/fx-providers/status')
  async getFxProviderStatus(@Param('workspaceId') workspaceId: string) {
    const statuses = await this.providers.status(workspaceId);
    return { data: statuses.map((p) => toProviderStatusDto(p, this.threshold)) };
  }

  @Post('workspaces/:workspaceId/fx-rates/:fxRateId/supersede')
  @HttpCode(201)
  async supersedeFxRate(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('fxRateId') fxRateId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const stored = await this.service.supersedeRate({
      workspaceId,
      userId: userIdOf(req),
      rateId: fxRateId,
      value: str(body, 'value') ?? '',
      reason: str(body, 'reason') ?? '',
      ...(str(body, 'sourceLabel') !== undefined ? { sourceLabel: str(body, 'sourceLabel') as string } : {}),
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/fx-rates/${stored.rate.id}`);
    res.setHeader('etag', '"1"');
    return toFxRateDto(stored);
  }

  @Get('workspaces/:workspaceId/fx-rate-preferences')
  async listFxRatePreferences(
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const set = await this.queries.listPreferences(workspaceId);
    res.setHeader('etag', `"${set.version}"`);
    return { data: set.preferences.map((p) => ({ ...p })) };
  }

  @Put('workspaces/:workspaceId/fx-rate-preferences')
  async replaceFxRatePreferences(
    @Param('workspaceId') workspaceId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const set = await this.service.replacePreferences({
      workspaceId,
      expectedVersion: expected,
      preferences: (body['data'] as RatePreference[] | undefined) ?? [],
    });
    res.setHeader('etag', `"${set.version}"`);
    return { data: set.preferences.map((p) => ({ base: p.base, quote: p.quote, rateType: p.rateType })) };
  }
}
