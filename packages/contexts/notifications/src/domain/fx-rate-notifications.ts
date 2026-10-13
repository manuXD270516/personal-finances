import { DomainError } from '@pf/shared-kernel';
import { decimalOf, fail, recordOf, uuidOf, type NotificationPlan } from './type-catalog.js';
import type { NotificationType, WorkspaceRoleName } from './types.js';

/**
 * Alertas de tasas (openspec add-rate-feed-alerts; D233, D234, D235, D249): tres tipos que NOTIFY recibe por el puerto
 * síncrono `NotificationIntakePort` desde el job de providers de FX, SIN consumidor de eventos (no hay cola
 * `events.notifications.*` ni conexiones nuevas). Aquí solo se traduce el hecho; la regla de alerta (episodios,
 * muestras retenidas) la decide FX.
 */
export const FX_RATE_FEED_STALE_MESSAGE_KEY = 'notifications.fx_rate_feed_stale.v1';
export const FX_RATE_FEED_RECOVERED_MESSAGE_KEY = 'notifications.fx_rate_feed_recovered.v1';
/** Aviso por muestra (anterior a la agrupación): las notificaciones ya creadas se siguen renderizando con él. */
export const FX_RATE_ANOMALY_RETAINED_MESSAGE_KEY = 'notifications.fx_rate_anomaly_retained.v1';
/** Aviso por grupo de muestras pendientes del par (refine-rate-anomaly-alert-grouping). */
export const FX_RATE_ANOMALY_GROUP_MESSAGE_KEY = 'notifications.fx_rate_anomaly_retained.v2';

/** Tipo de entrega directa: sin `consumer` ni `event` (no es un consumidor de eventos). */
export interface IntakeTypeDefinition {
  readonly type: NotificationType;
  /** Roles con membresía activa que reciben el tipo (D235: OWNER y EDITOR; el VIEWER no actúa sobre las tasas). */
  readonly recipients: readonly WorkspaceRoleName[];
  /** `factKey` = clave de negocio del hecho (episodio o ancla del grupo): la deduplicación por destinatario. */
  plan(payload: unknown, factKey: string): NotificationPlan;
  /**
   * `true` si un hecho posterior con la misma clave ACTUALIZA el aviso existente (cantidad, mayor variación y enlace) en
   * lugar de ignorarse; nunca cambia su estado de lectura ni su fecha de creación y no programa otro email.
   */
  readonly refreshable?: boolean;
}

const CURRENCY = /^[A-Z0-9]{2,16}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_DECIMAL = /^[+-]?\d+(\.\d+)?$/;

function currencyOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && CURRENCY.test(value) ? value : fail(key);
}

function instantOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : fail(key);
}

function nullableInstantOf(source: Record<string, unknown>, key: string): string | null {
  return source[key] === null ? null : instantOf(source, key);
}

function zoneOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') return fail(key);
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    return fail(key);
  }
  return value;
}

function factKeyOf(factKey: string): string {
  return UUID.test(factKey) ? factKey : fail('factKey');
}

function signedDecimalOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && SIGNED_DECIMAL.test(value) ? value : fail(key);
}

function nonEmptyTextOf(source: Record<string, unknown>, key: string, max: number): string {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail(key);
}

/** Mes (`AAAA-MM`) de un instante en una zona IANA: el `periodLabel` del enlace es el mes del hecho del workspace. */
export function monthLabelIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

const FX_RATE_FEED_STALE: IntakeTypeDefinition = {
  type: 'FX_RATE_FEED_STALE',
  recipients: ['OWNER', 'EDITOR'],
  plan(payload, factKey) {
    const episodeId = factKeyOf(factKey);
    const p = recordOf(payload, 'payload');
    const detectedAt = instantOf(p, 'detectedAt');
    const timeZone = zoneOf(p, 'timeZone');
    const staleAfterSeconds = p['staleAfterSeconds'];
    if (!Number.isInteger(staleAfterSeconds) || (staleAfterSeconds as number) <= 0) fail('staleAfterSeconds');
    return {
      type: 'FX_RATE_FEED_STALE',
      dedupeKey: `fx-rate-feed-stale:${episodeId}`,
      severity: 'WARNING',
      messageKey: FX_RATE_FEED_STALE_MESSAGE_KEY,
      params: {
        episodeId,
        base: currencyOf(p, 'base'),
        quote: currencyOf(p, 'quote'),
        lastRateAsOf: nullableInstantOf(p, 'lastRateAsOf'),
        staleAfterSeconds: staleAfterSeconds as number,
        detectedAt,
        timeZone,
      },
      link: { kind: 'FX_FEED_STATUS', periodId: episodeId, periodLabel: monthLabelIn(detectedAt, timeZone) },
    };
  },
};

const FX_RATE_FEED_RECOVERED: IntakeTypeDefinition = {
  type: 'FX_RATE_FEED_RECOVERED',
  recipients: ['OWNER', 'EDITOR'],
  plan(payload, factKey) {
    const episodeId = factKeyOf(factKey);
    const p = recordOf(payload, 'payload');
    const detectedAt = instantOf(p, 'detectedAt');
    const timeZone = zoneOf(p, 'timeZone');
    return {
      type: 'FX_RATE_FEED_RECOVERED',
      dedupeKey: `fx-rate-feed-recovered:${episodeId}`,
      severity: 'INFO',
      messageKey: FX_RATE_FEED_RECOVERED_MESSAGE_KEY,
      params: {
        episodeId,
        base: currencyOf(p, 'base'),
        quote: currencyOf(p, 'quote'),
        rateId: uuidOf(p, 'rateId'),
        asOf: instantOf(p, 'asOf'),
        openedAt: instantOf(p, 'openedAt'),
        detectedAt,
        timeZone,
      },
      link: { kind: 'FX_FEED_STATUS', periodId: episodeId, periodLabel: monthLabelIn(detectedAt, timeZone) },
    };
  },
};

function countOf(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fail(key);
}

function providersOf(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return fail(key);
  return value.map((v) => (typeof v === 'string' && v.length > 0 && v.length <= 60 ? v : fail(key)));
}

const FX_RATE_ANOMALY_RETAINED: IntakeTypeDefinition = {
  type: 'FX_RATE_ANOMALY_RETAINED',
  recipients: ['OWNER', 'EDITOR'],
  refreshable: true,
  plan(payload, factKey) {
    const anchorRateId = factKeyOf(factKey);
    const p = recordOf(payload, 'payload');
    if (p['anchorRateId'] !== anchorRateId) fail('anchorRateId');
    const detectedAt = instantOf(p, 'detectedAt');
    const timeZone = zoneOf(p, 'timeZone');
    const firstRetainedAt = instantOf(p, 'firstRetainedAt');
    const peak = recordOf(p['peak'], 'peak');
    const pendingCount = countOf(p, 'pendingCount');
    const retainedCount = countOf(p, 'retainedCount');
    if (retainedCount < pendingCount) fail('retainedCount');
    const reviewRateId = uuidOf(p, 'reviewRateId');
    return {
      type: 'FX_RATE_ANOMALY_RETAINED',
      dedupeKey: `fx-rate-anomaly-retained:${anchorRateId}`,
      severity: 'WARNING',
      messageKey: FX_RATE_ANOMALY_GROUP_MESSAGE_KEY,
      params: {
        anchorRateId,
        base: currencyOf(p, 'base'),
        quote: currencyOf(p, 'quote'),
        pendingCount,
        retainedCount,
        providers: providersOf(p, 'providers'),
        reviewRateId,
        peak: {
          rateId: uuidOf(peak, 'rateId'),
          rateType: nonEmptyTextOf(peak, 'rateType', 20),
          provider: nonEmptyTextOf(peak, 'provider', 60),
          value: decimalOf(peak, 'value'),
          baselineRateId: uuidOf(peak, 'baselineRateId'),
          baselineValue: decimalOf(peak, 'baselineValue'),
          variationPct: signedDecimalOf(peak, 'variationPct'),
          thresholdPct: decimalOf(peak, 'thresholdPct'),
        },
        firstRetainedAt,
        lastRetainedAt: instantOf(p, 'lastRetainedAt'),
        detectedAt,
        timeZone,
      },
      // El enlace lleva a la pendiente más antigua del grupo en su última actualización (Tasas → Proveedores).
      link: {
        kind: 'FX_RATE',
        fxRateId: reviewRateId,
        periodId: reviewRateId,
        periodLabel: monthLabelIn(firstRetainedAt, timeZone),
      },
    };
  },
};

/** Tipos de entrega directa (sin consumidor): NO se registran colas `events.notifications.*` por ellos. */
export const NOTIFICATION_INTAKE_CATALOG: readonly IntakeTypeDefinition[] = [
  FX_RATE_FEED_STALE,
  FX_RATE_FEED_RECOVERED,
  FX_RATE_ANOMALY_RETAINED,
];

export function intakeDefinitionOf(type: string): IntakeTypeDefinition {
  const definition = NOTIFICATION_INTAKE_CATALOG.find((d) => d.type === type);
  if (!definition) throw new DomainError('VALIDATION_FAILED', `unknown intake notification type ${type}`);
  return definition;
}
