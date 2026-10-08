import { DomainError } from '@pf/shared-kernel';
import type {
  BudgetTargetKind,
  JsonValue,
  MoneyParam,
  NotificationLink,
  NotificationParams,
  NotificationSeverity,
  NotificationType,
  WorkspaceRoleName,
} from './types.js';

/** Resultado de traducir un hecho publicado a lo que se guarda por destinatario (sin texto congelado, decisión 3). */
export interface NotificationPlan {
  readonly type: NotificationType;
  /** Clave de deduplicación de negocio, única por (workspace, usuario) — decisión 2. */
  readonly dedupeKey: string;
  readonly severity: NotificationSeverity;
  readonly messageKey: string;
  readonly params: NotificationParams;
  readonly link: NotificationLink;
}

export interface NotificationTypeDefinition {
  readonly type: NotificationType;
  /** Consumidor de eventos (`<contexto>.<propósito>`): clave del inbox y nombre de la cola. */
  readonly consumer: string;
  /** Hecho de origen que NOTIFY solo traduce (nunca decide la regla de alerta). */
  readonly event: { readonly type: string; readonly version: number };
  /** Roles con membresía activa que reciben el tipo (decisión 1; docs/33 D89). */
  readonly recipients: readonly WorkspaceRoleName[];
  /** Traduce el payload del hecho (validado por contrato en el productor; se revalida su forma mínima aquí). */
  plan(payload: unknown): NotificationPlan;
}

// ──────────────────────────────────────────────────────────────────────────── lectura defensiva del payload

const fail = (what: string): never => {
  throw new DomainError('VALIDATION_FAILED', `invalid event payload: ${what}`);
};

function recordOf(value: unknown, what: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(what);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_LABEL = /^\d{4}-(0[1-9]|1[0-2])$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

function uuidOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && UUID.test(value) ? value : fail(key);
}

function labelOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && PERIOD_LABEL.test(value) ? value : fail(key);
}

function decimalOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && DECIMAL.test(value) ? value : fail(key);
}

function moneyOf(source: Record<string, unknown>, key: string): MoneyParam {
  const money = recordOf(source[key], key);
  const currency = money['currency'];
  if (typeof currency !== 'string' || currency.length === 0) fail(`${key}.currency`);
  return { amount: decimalOf(money, 'amount'), currency: currency as string };
}

const TARGET_KINDS: readonly BudgetTargetKind[] = ['CATEGORY', 'GROUP', 'TAG'];

// ──────────────────────────────────────────────────────────────────────────── BUDGET_THRESHOLD

/** Umbral en porcentaje como string decimal canónico; ordena numéricamente sin `number` financiero. */
const compareThresholds = (a: string, b: string): number => {
  const [ai = '', af = ''] = a.split('.');
  const [bi = '', bf = ''] = b.split('.');
  const width = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(width, '0'));
  const right = BigInt(bi + bf.padEnd(width, '0'));
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Umbral >= 100 % ⇒ `WARNING`; por debajo, `INFO` (decisión 3). */
export const severityOfThreshold = (threshold: string): NotificationSeverity =>
  compareThresholds(threshold, '100') >= 0 ? 'WARNING' : 'INFO';

export const BUDGET_THRESHOLD_MESSAGE_KEY = 'notifications.budget_threshold.v1';
export const MONTH_CLOSE_PENDING_MESSAGE_KEY = 'notifications.month_close_pending.v1';

const BUDGET_THRESHOLD: NotificationTypeDefinition = {
  type: 'BUDGET_THRESHOLD',
  consumer: 'notifications.budget-threshold',
  event: { type: 'planning.BudgetThresholdReached', version: 1 },
  // Todos los miembros activos pueden leer presupuestos (docs/33 D89: VIEWER incluido).
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const target = recordOf(p['target'], 'target');
    const kind = target['kind'];
    if (!TARGET_KINDS.includes(kind as BudgetTargetKind)) fail('target.kind');
    const targetKind = kind as BudgetTargetKind;
    const targetId = uuidOf(target, 'id');
    const periodId = uuidOf(p, 'periodId');
    const budgetId = uuidOf(p, 'budgetId');
    const budgetLineId = uuidOf(p, 'budgetLineId');
    const periodLabel = labelOf(p, 'periodLabel');
    const threshold = decimalOf(p, 'threshold');
    const alsoRaw = p['alsoCrossed'];
    if (!Array.isArray(alsoRaw)) fail('alsoCrossed');
    const alsoCrossed = (alsoRaw as unknown[]).map((t) => {
      if (typeof t !== 'string' || !DECIMAL.test(t)) fail('alsoCrossed[]');
      return t as string;
    });
    if (typeof p['actualComplete'] !== 'boolean') fail('actualComplete');
    const params: Record<string, JsonValue> = {
      periodId,
      periodLabel,
      budgetId,
      budgetLineId,
      targetKind,
      targetId,
      threshold,
      alsoCrossed,
      reference: { ...moneyOf(p, 'reference') },
      actual: { ...moneyOf(p, 'actual') },
      utilization: decimalOf(p, 'utilization'),
      actualComplete: p['actualComplete'] as boolean,
    };
    return {
      type: 'BUDGET_THRESHOLD',
      // La misma clave de negocio del productor: (periodo, objetivo, umbral).
      dedupeKey: `budget-threshold:${periodId}:${targetKind}:${targetId}:${threshold}`,
      severity: severityOfThreshold(threshold),
      messageKey: BUDGET_THRESHOLD_MESSAGE_KEY,
      params,
      link: { kind: 'BUDGET_LINE', periodId, periodLabel, budgetId, budgetLineId, targetKind, targetId },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────── MONTH_CLOSE_PENDING

const MONTH_CLOSE_PENDING: NotificationTypeDefinition = {
  type: 'MONTH_CLOSE_PENDING',
  consumer: 'notifications.month-close-pending',
  event: { type: 'planning.MonthClosePending', version: 1 },
  // Solo quienes pueden cerrar el periodo (docs/33 D89).
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const periodId = uuidOf(p, 'periodId');
    const periodLabel = labelOf(p, 'periodLabel');
    const periodEnd = p['periodEnd'];
    const pendingSince = p['pendingSince'];
    if (typeof periodEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) fail('periodEnd');
    if (typeof pendingSince !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pendingSince)) fail('pendingSince');
    return {
      type: 'MONTH_CLOSE_PENDING',
      dedupeKey: `month-close-pending:${periodId}`,
      severity: 'WARNING',
      messageKey: MONTH_CLOSE_PENDING_MESSAGE_KEY,
      params: { periodId, periodLabel, periodEnd: periodEnd as string, pendingSince: pendingSince as string },
      link: { kind: 'PERIOD_CLOSE', periodId, periodLabel },
    };
  },
};

/** Registro de tipos por fase: una tabla en código, no un motor de reglas (RISK-005). */
export const NOTIFICATION_TYPE_CATALOG: readonly NotificationTypeDefinition[] = [
  BUDGET_THRESHOLD,
  MONTH_CLOSE_PENDING,
];

export function definitionOf(type: NotificationType): NotificationTypeDefinition {
  const definition = NOTIFICATION_TYPE_CATALOG.find((d) => d.type === type);
  if (!definition) throw new DomainError('VALIDATION_FAILED', `unknown notification type ${type}`);
  return definition;
}

export function definitionForConsumer(consumer: string): NotificationTypeDefinition | undefined {
  return NOTIFICATION_TYPE_CATALOG.find((d) => d.consumer === consumer);
}
