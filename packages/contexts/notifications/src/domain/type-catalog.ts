import { DomainError, dec } from '@pf/shared-kernel';
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

/** Datos del sobre del evento que algunas claves de negocio necesitan. */
export interface PlanEnvelope {
  readonly aggregateVersion?: number | undefined;
}

export interface NotificationTypeDefinition {
  readonly type: NotificationType;
  /** Consumidor de eventos (`<contexto>.<propósito>`): clave del inbox y nombre de la cola. */
  readonly consumer: string;
  /** Hecho de origen que NOTIFY solo traduce (nunca decide la regla de alerta). */
  readonly event: { readonly type: string; readonly version: number };
  /** Roles con membresía activa que reciben el tipo (decisión 1; docs/33 D89). */
  readonly recipients: readonly WorkspaceRoleName[];
  /**
   * Traduce el payload del hecho (validado por contrato en el productor; se revalida su forma mínima aquí). El sobre
   * (`envelope`) solo lo necesitan los tipos cuya clave de negocio usa la versión del agregado (`GOAL_REACHED`).
   */
  plan(payload: unknown, envelope?: PlanEnvelope): NotificationPlan;
  /** Otros tipos que este mismo consumidor puede producir (el tipo concreto lo decide `plan`). */
  readonly alsoTypes?: readonly NotificationType[];
  /** `true` si el hecho NO debe generar aviso genérico (p. ej. D119); se evalúa tras validar con `plan`. */
  suppressed?(payload: unknown): boolean;
}

// ──────────────────────────────────────────────────────────────────────────── lectura defensiva del payload

export const fail = (what: string): never => {
  throw new DomainError('VALIDATION_FAILED', `invalid event payload: ${what}`);
};

export function recordOf(value: unknown, what: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(what);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_LABEL = /^\d{4}-(0[1-9]|1[0-2])$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function uuidOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && UUID.test(value) ? value : fail(key);
}

function labelOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && PERIOD_LABEL.test(value) ? value : fail(key);
}

export function decimalOf(source: Record<string, unknown>, key: string): string {
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

// ──────────────────────────────────────────────────────────────────────────── RECURRING_* (add-recurrence-engine)

export const RECURRING_PAYMENT_UPCOMING_MESSAGE_KEY = 'notifications.recurring_payment_upcoming.v1';
export const RECURRING_APPROVAL_REQUIRED_MESSAGE_KEY = 'notifications.recurring_approval_required.v1';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXPECTED_TYPES = ['FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE'];
// `GOAL` (add-savings-goals N6): las metas administran definiciones del motor; su ocurrencia conserva el aviso genérico.
const MANAGED_BY = ['USER', 'SUBSCRIPTION', 'DEBT', 'GOAL'];

function localDateOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && LOCAL_DATE.test(value) ? value : fail(key);
}

function nullableDecimalOf(source: Record<string, unknown>, key: string): string | null {
  return source[key] === null ? null : decimalOf(source, key);
}

/**
 * `commitments.RecurringOccurrenceDue.v1`: la ocurrencia pasó a próxima. Tipo `RECURRING_APPROVAL_REQUIRED` si requiere
 * aprobación, si no `RECURRING_PAYMENT_UPCOMING`. La clave de negocio es la ocurrencia (INV-028 en dos capas).
 */
const OCCURRENCE_DUE: NotificationTypeDefinition = {
  type: 'RECURRING_PAYMENT_UPCOMING',
  alsoTypes: ['RECURRING_APPROVAL_REQUIRED'],
  consumer: 'notifications.occurrence-due',
  event: { type: 'commitments.RecurringOccurrenceDue', version: 1 },
  // Solo quienes pueden aprobar/registrar (docs/33 D126): VIEWER no recibe.
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const occurrenceId = uuidOf(p, 'occurrenceId');
    const definitionId = uuidOf(p, 'definitionId');
    const name = p['name'];
    if (typeof name !== 'string' || name.length === 0) fail('name');
    const expected = recordOf(p['expected'], 'expected');
    const expectedType = expected['type'];
    if (typeof expectedType !== 'string' || !EXPECTED_TYPES.includes(expectedType)) fail('expected.type');
    const currency = p['currency'];
    if (typeof currency !== 'string' || currency.length === 0) fail('currency');
    if (typeof p['requiresApproval'] !== 'boolean') fail('requiresApproval');
    const requiresApproval = p['requiresApproval'] as boolean;
    const mode = p['mode'];
    if (typeof mode !== 'string' || mode.length === 0) fail('mode');
    const kind = p['kind'];
    if (typeof kind !== 'string' || kind.length === 0) fail('kind');
    if (!MANAGED_BY.includes(p['managedBy'] as string)) fail('managedBy');
    return {
      type: requiresApproval ? 'RECURRING_APPROVAL_REQUIRED' : 'RECURRING_PAYMENT_UPCOMING',
      dedupeKey: `occurrence-due:${occurrenceId}`,
      severity: requiresApproval ? 'WARNING' : 'INFO',
      messageKey: requiresApproval
        ? RECURRING_APPROVAL_REQUIRED_MESSAGE_KEY
        : RECURRING_PAYMENT_UPCOMING_MESSAGE_KEY,
      params: {
        occurrenceId,
        definitionId,
        name: name as string,
        kind: kind as string,
        occurrenceDate: localDateOf(p, 'occurrenceDate'),
        dueDate: localDateOf(p, 'dueDate'),
        expected: {
          type: expectedType as string,
          amount: nullableDecimalOf(expected, 'amount'),
          min: nullableDecimalOf(expected, 'min'),
          max: nullableDecimalOf(expected, 'max'),
        },
        currency: currency as string,
        requiresApproval,
        mode: mode as string,
        managedBy: p['managedBy'] as string,
      },
      link: {
        kind: 'RECURRING_OCCURRENCE',
        occurrenceId,
        periodId: typeof p['periodId'] === 'string' ? uuidOf(p, 'periodId') : occurrenceId,
        periodLabel: localDateOf(p, 'dueDate').slice(0, 7),
      },
    };
  },
  // D119: una ocurrencia que ya gestiona una suscripción y no requiere aprobación la avisa `add-subscriptions`.
  // D119 (suscripciones) y su aplicación a tarjetas (add-credit-cards decisión 9, TC-DEBT-CARD-036): el vencimiento del
  // pago de tarjeta sin aprobación lo avisa `CARD_PAYMENT_DUE`; "ocurrencia por aprobar" se mantiene.
  suppressed(payload) {
    const p = recordOf(payload, 'payload');
    if (p['requiresApproval'] !== false) return false;
    return p['managedBy'] === 'SUBSCRIPTION' || (p['managedBy'] === 'DEBT' && p['kind'] === 'CARD_PAYMENT');
  },
};

// ──────────────────────────────────────────────────────────────────────────── SUBSCRIPTION_* (add-subscriptions)

export const SUBSCRIPTION_RENEWAL_MESSAGE_KEY = 'notifications.subscription_renewal.v1';
export const SUBSCRIPTION_TRIAL_ENDING_MESSAGE_KEY = 'notifications.subscription_trial_ending.v1';
export const SUBSCRIPTION_PRICE_CHANGE_MESSAGE_KEY = 'notifications.subscription_price_change.v1';

const SIGNED_PERCENT = /^[+-]\d+\.\d{2}$/;

function textOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : fail(key);
}

function nullableTextOf(source: Record<string, unknown>, key: string): string | null {
  return source[key] === null ? null : textOf(source, key);
}

function nullableMoneyOf(source: Record<string, unknown>, key: string): MoneyParam | null {
  return source[key] === null ? null : moneyOf(source, key);
}

function daysOf(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30
    ? value
    : fail(key);
}

/**
 * `commitments.SubscriptionRenewalUpcoming.v1`: faltan N días para la renovación. La clave de negocio es la
 * suscripción y la fecha de renovación (INV-028 en dos capas: el job ya emite una vez por fecha, la clave cubre el
 * hecho reentregado con otro identificador de evento). Los nombres viajan en el hecho (PII `B`): NOTIFY no consulta
 * otros contextos para renderizar.
 */
const SUBSCRIPTION_RENEWAL: NotificationTypeDefinition = {
  type: 'SUBSCRIPTION_RENEWAL',
  consumer: 'notifications.subscription-renewal',
  event: { type: 'commitments.SubscriptionRenewalUpcoming', version: 1 },
  // Todos los miembros activos pueden leer suscripciones (docs/35 D143: VIEWER incluido).
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const subscriptionId = uuidOf(p, 'subscriptionId');
    const renewalDate = localDateOf(p, 'renewalDate');
    if (typeof p['requiresApproval'] !== 'boolean') fail('requiresApproval');
    const expectedCharge = nullableMoneyOf(p, 'expectedCharge');
    return {
      type: 'SUBSCRIPTION_RENEWAL',
      dedupeKey: `subscription-renewal:${subscriptionId}:${renewalDate}`,
      severity: 'INFO',
      messageKey: SUBSCRIPTION_RENEWAL_MESSAGE_KEY,
      params: {
        subscriptionId,
        providerName: textOf(p, 'providerName'),
        planName: nullableTextOf(p, 'planName'),
        renewalDate,
        daysBefore: daysOf(p, 'daysBefore'),
        expectedPrice: { ...moneyOf(p, 'expectedPrice') },
        expectedCharge: expectedCharge === null ? null : { ...expectedCharge },
        paymentAccountName:
          typeof p['paymentAccountName'] === 'string' ? (p['paymentAccountName'] as string) : '',
        requiresApproval: p['requiresApproval'] as boolean,
      },
      link: {
        kind: 'SUBSCRIPTION',
        subscriptionId,
        periodId: subscriptionId,
        periodLabel: renewalDate.slice(0, 7),
      },
    };
  },
};

/** `commitments.SubscriptionTrialEnding.v1`: faltan N días para el fin del trial; avisa el primer cobro. */
const SUBSCRIPTION_TRIAL_ENDING: NotificationTypeDefinition = {
  type: 'SUBSCRIPTION_TRIAL_ENDING',
  consumer: 'notifications.subscription-trial-ending',
  event: { type: 'commitments.SubscriptionTrialEnding', version: 1 },
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const subscriptionId = uuidOf(p, 'subscriptionId');
    const trialEndsOn = localDateOf(p, 'trialEndsOn');
    return {
      type: 'SUBSCRIPTION_TRIAL_ENDING',
      dedupeKey: `subscription-trial:${subscriptionId}:${trialEndsOn}`,
      severity: 'WARNING',
      messageKey: SUBSCRIPTION_TRIAL_ENDING_MESSAGE_KEY,
      params: {
        subscriptionId,
        providerName: textOf(p, 'providerName'),
        trialEndsOn,
        daysBefore: daysOf(p, 'daysBefore'),
        firstChargePrice: { ...moneyOf(p, 'firstChargePrice') },
        paymentAccountName:
          typeof p['paymentAccountName'] === 'string' ? (p['paymentAccountName'] as string) : '',
      },
      link: {
        kind: 'SUBSCRIPTION',
        subscriptionId,
        periodId: subscriptionId,
        periodLabel: trialEndsOn.slice(0, 7),
      },
    };
  },
};

/**
 * `commitments.SubscriptionPriceChanged.v1`: SOLO `origin = DETECTED` avisa (hay una propuesta por decidir); los
 * orígenes `MANUAL` y `CORRECTION` los hizo el propio usuario y se consumen sin notificar (docs/35 D118, D143). La
 * deduplicación es por suscripción y fecha de vigencia.
 */
const SUBSCRIPTION_PRICE_CHANGE: NotificationTypeDefinition = {
  type: 'SUBSCRIPTION_PRICE_CHANGE',
  consumer: 'notifications.subscription-price-change',
  event: { type: 'commitments.SubscriptionPriceChanged', version: 1 },
  // Requiere acción de quien puede decidir la propuesta (docs/35 D143): VIEWER no recibe.
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const subscriptionId = uuidOf(p, 'subscriptionId');
    const effectiveFrom = localDateOf(p, 'effectiveFrom');
    const origin = p['origin'];
    if (origin !== 'DETECTED' && origin !== 'MANUAL' && origin !== 'CORRECTION') fail('origin');
    const changePercentage = p['changePercentage'];
    if (typeof changePercentage !== 'string' || !SIGNED_PERCENT.test(changePercentage))
      fail('changePercentage');
    const proposalId = p['proposalId'] === null ? null : uuidOf(p, 'proposalId');
    return {
      type: 'SUBSCRIPTION_PRICE_CHANGE',
      dedupeKey: `subscription-price:${subscriptionId}:${effectiveFrom}`,
      severity: 'WARNING',
      messageKey: SUBSCRIPTION_PRICE_CHANGE_MESSAGE_KEY,
      params: {
        subscriptionId,
        providerName: textOf(p, 'providerName'),
        previousPrice: { ...moneyOf(p, 'previousPrice') },
        newPrice: { ...moneyOf(p, 'newPrice') },
        effectiveFrom,
        changePercentage: changePercentage as string,
        origin: origin as string,
        proposalId,
      },
      link: {
        kind: 'SUBSCRIPTION',
        subscriptionId,
        ...(proposalId !== null ? { proposalId } : {}),
        periodId: subscriptionId,
        periodLabel: effectiveFrom.slice(0, 7),
      },
    };
  },
  suppressed(payload) {
    return recordOf(payload, 'payload')['origin'] !== 'DETECTED';
  },
};

// ──────────────────────────────────────────────────────────────────────────── CARD_* (add-credit-cards)

export const CARD_PAYMENT_DUE_MESSAGE_KEY = 'notifications.card_payment_due.v1';
export const CARD_UTILIZATION_MESSAGE_KEY = 'notifications.card_utilization.v1';

/** Con 1 día o menos para el vencimiento el aviso es `WARNING`; antes, `INFO` (add-credit-cards decisión 9). */
export const CARD_DUE_WARNING_DAYS = 1;

/**
 * `debt.CardPaymentDue.v1`: recordatorio del vencimiento de un estado de cuenta al que le falta algo para no generar
 * intereses. Solo quienes pueden registrar el pago (OWNER y EDITOR). La clave de negocio es (cuenta de la tarjeta, fecha
 * de cierre), igual que la del productor: un recordatorio entregado dos veces con otro `eventId` no duplica. Nombre y
 * montos viajan en el hecho (PII `B`): NOTIFY no consulta otros contextos.
 */
const CARD_PAYMENT_DUE: NotificationTypeDefinition = {
  type: 'CARD_PAYMENT_DUE',
  consumer: 'notifications.card-payment-due',
  event: { type: 'debt.CardPaymentDue', version: 1 },
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const cardId = uuidOf(p, 'cardId');
    const cardAccountId = uuidOf(p, 'cardAccountId');
    const statementId = uuidOf(p, 'statementId');
    const closingDate = localDateOf(p, 'closingDate');
    const dueDate = localDateOf(p, 'dueDate');
    const daysBefore = p['daysBefore'];
    if (
      typeof daysBefore !== 'number' ||
      !Number.isInteger(daysBefore) ||
      daysBefore < 0 ||
      daysBefore > 30
    ) {
      fail('daysBefore');
    }
    const days = daysBefore as number;
    const currency = p['currency'];
    if (typeof currency !== 'string' || currency.length === 0) fail('currency');
    return {
      type: 'CARD_PAYMENT_DUE',
      dedupeKey: `card-due:${cardAccountId}:${closingDate}`,
      severity: days <= CARD_DUE_WARNING_DAYS ? 'WARNING' : 'INFO',
      messageKey: CARD_PAYMENT_DUE_MESSAGE_KEY,
      params: {
        cardId,
        cardName: textOf(p, 'cardName'),
        cardAccountId,
        statementId,
        currency: currency as string,
        closingDate,
        dueDate,
        daysBefore: days,
        remainingNoInterest: { ...moneyOf(p, 'remainingNoInterest') },
        remainingMinimum: { ...moneyOf(p, 'remainingMinimum') },
      },
      link: { kind: 'CREDIT_CARD', cardId, statementId, periodId: cardId, periodLabel: dueDate.slice(0, 7) },
    };
  },
};

/**
 * `debt.CreditUtilizationThresholdReached.v1`: la utilización pasó a ser >= un umbral (el más alto cruzado; los demás
 * viajan en `alsoCrossed` y NO generan avisos aparte). Clave de negocio `(tarjeta, ámbito, umbral, nº de cruce)`; en el
 * ámbito `ACCOUNT` el ámbito incluye la cuenta, porque las cuentas de una tarjeta bimoneda cruzan por separado.
 */
const CARD_UTILIZATION: NotificationTypeDefinition = {
  type: 'CARD_UTILIZATION',
  consumer: 'notifications.card-utilization',
  event: { type: 'debt.CreditUtilizationThresholdReached', version: 1 },
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const cardId = uuidOf(p, 'cardId');
    const scope = p['scope'];
    if (scope !== 'SHARED' && scope !== 'ACCOUNT') fail('scope');
    const accountId = p['accountId'] === null ? null : uuidOf(p, 'accountId');
    if (scope === 'ACCOUNT' && accountId === null) fail('accountId');
    const threshold = decimalOf(p, 'threshold');
    const alsoRaw = p['alsoCrossed'];
    if (!Array.isArray(alsoRaw)) fail('alsoCrossed');
    const alsoCrossed = (alsoRaw as unknown[]).map((t) => {
      if (typeof t !== 'string' || !DECIMAL.test(t)) fail('alsoCrossed[]');
      return t as string;
    });
    const crossingNo = p['crossingNo'];
    if (typeof crossingNo !== 'number' || !Number.isInteger(crossingNo) || crossingNo < 1) fail('crossingNo');
    const crossedAt = textOf(p, 'crossedAt');
    if (Number.isNaN(Date.parse(crossedAt))) fail('crossedAt');
    const scopeKey = scope === 'SHARED' ? 'SHARED' : `ACCOUNT:${accountId}`;
    return {
      type: 'CARD_UTILIZATION',
      dedupeKey: `card-utilization:${cardId}:${scopeKey}:${threshold}:${crossingNo as number}`,
      severity: 'WARNING',
      messageKey: CARD_UTILIZATION_MESSAGE_KEY,
      params: {
        cardId,
        cardName: textOf(p, 'cardName'),
        scope: scope as string,
        accountId,
        limit: { ...moneyOf(p, 'limit') },
        used: { ...moneyOf(p, 'used') },
        utilization: decimalOf(p, 'utilization'),
        threshold,
        alsoCrossed,
        crossingNo: crossingNo as number,
        crossedAt,
      },
      link: { kind: 'CREDIT_CARD', cardId, periodId: cardId, periodLabel: crossedAt.slice(0, 7) },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────── GOAL_* (add-savings-goals)

export const GOAL_OVER_ALLOCATED_MESSAGE_KEY = 'notifications.goal_over_allocated.v1';
export const GOAL_REACHED_MESSAGE_KEY = 'notifications.goal_reached.v1';
export const GOAL_MILESTONE_MESSAGE_KEY = 'notifications.goal_milestone.v1';

/** Hitos de avance que NOTIFY deriva del movimiento (el 100 % lo notifica `GoalReached`). */
export const GOAL_MILESTONES = ['25', '50', '75'] as const;

/**
 * Hitos cruzados por un movimiento: `m` se cruza si `percentBefore < m <= percentAfter` (comparación con Decimal,
 * nunca `number`). Devuelve el mayor y los demás en orden ascendente; `null` si no cruzó ninguno.
 */
export function crossedMilestones(
  percentBefore: string,
  percentAfter: string,
): { readonly milestone: string; readonly alsoCrossed: readonly string[] } | null {
  const before = dec(percentBefore);
  const after = dec(percentAfter);
  const crossed = GOAL_MILESTONES.filter((m) => before.lt(m) && after.gte(m));
  const highest = crossed.at(-1);
  return highest === undefined ? null : { milestone: highest, alsoCrossed: crossed.slice(0, -1) };
}

/**
 * `goals.EarmarkExceedsBalance.v1`: las reservas de metas de una cuenta superan su saldo. Requiere acción de quien puede
 * reasignar o ajustar metas (OWNER y EDITOR, docs/37 D187). Clave de negocio (cuenta, episodio): el hecho reentregado
 * con otro `eventId` no duplica. Nombres y montos viajan en el hecho (PII `B`).
 */
const GOAL_OVER_ALLOCATED: NotificationTypeDefinition = {
  type: 'GOAL_OVER_ALLOCATED',
  consumer: 'notifications.goal-over-allocated',
  event: { type: 'goals.EarmarkExceedsBalance', version: 1 },
  recipients: ['OWNER', 'EDITOR'],
  plan(payload) {
    const p = recordOf(payload, 'payload');
    const accountId = uuidOf(p, 'accountId');
    const episodeId = uuidOf(p, 'episodeId');
    const detectedOn = localDateOf(p, 'detectedOn');
    const goalsRaw = p['goals'];
    if (!Array.isArray(goalsRaw)) fail('goals');
    const goals = (goalsRaw as unknown[]).map((g) => {
      const item = recordOf(g, 'goals[]');
      return {
        goalId: uuidOf(item, 'goalId'),
        goalName: textOf(item, 'goalName'),
        reserved: { ...moneyOf(item, 'reserved') },
      };
    });
    return {
      type: 'GOAL_OVER_ALLOCATED',
      dedupeKey: `goal-over-allocated:${accountId}:${episodeId}`,
      severity: 'WARNING',
      messageKey: GOAL_OVER_ALLOCATED_MESSAGE_KEY,
      params: {
        accountId,
        accountName: textOf(p, 'accountName'),
        episodeId,
        balance: { ...moneyOf(p, 'balance') },
        reserved: { ...moneyOf(p, 'reserved') },
        shortfall: { ...moneyOf(p, 'shortfall') },
        detectedOn,
        goals,
      },
      link: {
        kind: 'GOAL_RESERVATIONS',
        accountId,
        periodId: accountId,
        periodLabel: detectedOn.slice(0, 7),
      },
    };
  },
};

/**
 * `goals.GoalReached.v1`: la meta alcanzó su objetivo. Todos los miembros activos reciben el aviso. La clave de negocio
 * es la meta y la versión del agregado del evento: cada vez que la meta vuelve a alcanzarse es otro hecho, y la
 * reentrega del mismo no duplica. Sin versión de agregado (solo pruebas de contrato) cae a la fecha de alcance.
 */
const GOAL_REACHED: NotificationTypeDefinition = {
  type: 'GOAL_REACHED',
  consumer: 'notifications.goal-reached',
  event: { type: 'goals.GoalReached', version: 1 },
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan(payload, envelope) {
    const p = recordOf(payload, 'payload');
    const goalId = uuidOf(p, 'goalId');
    const reachedOn = localDateOf(p, 'reachedOn');
    const version = envelope?.aggregateVersion;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) fail('aggregateVersion');
    return {
      type: 'GOAL_REACHED',
      dedupeKey: `goal-reached:${goalId}:${version ?? reachedOn}`,
      severity: 'INFO',
      messageKey: GOAL_REACHED_MESSAGE_KEY,
      params: {
        goalId,
        goalName: textOf(p, 'goalName'),
        target: { ...moneyOf(p, 'target') },
        progress: { ...moneyOf(p, 'progress') },
        reachedOn,
      },
      link: { kind: 'GOAL', goalId, periodId: goalId, periodLabel: reachedOn.slice(0, 7) },
    };
  },
};

function planGoalMilestone(payload: unknown): NotificationPlan {
  const p = recordOf(payload, 'payload');
  const goalId = uuidOf(p, 'goalId');
  const percentBefore = decimalOf(p, 'percentBefore');
  const percentAfter = decimalOf(p, 'percentAfter');
  if (typeof p['progressComplete'] !== 'boolean') fail('progressComplete');
  const occurredOn = localDateOf(p, 'occurredOn');
  const crossing = p['progressComplete'] === true ? crossedMilestones(percentBefore, percentAfter) : null;
  return {
    type: 'GOAL_MILESTONE',
    dedupeKey: `goal-milestone:${goalId}:${crossing?.milestone ?? 'none'}`,
    severity: 'INFO',
    messageKey: GOAL_MILESTONE_MESSAGE_KEY,
    params: {
      goalId,
      goalName: textOf(p, 'goalName'),
      milestone: crossing?.milestone ?? null,
      alsoCrossed: [...(crossing?.alsoCrossed ?? [])],
      percentBefore,
      percentAfter,
      target: { ...moneyOf(p, 'target') },
      progress: { ...moneyOf(p, 'progressAfter') },
      occurredOn,
    },
    link: { kind: 'GOAL', goalId, periodId: goalId, periodLabel: occurredOn.slice(0, 7) },
  };
}

/**
 * `goals.SavingsContributionRecorded.v1`: de cada movimiento NOTIFY deriva los hitos 25/50/75 % (el mayor cruzado, los
 * demás en `alsoCrossed`). Clave de negocio `(meta, hito)` para siempre por destinatario: aunque el porcentaje baje y
 * vuelva a cruzar, no hay un segundo aviso. Un movimiento sin hito cruzado o con progreso incompleto (falta de tasa) se
 * consume sin notificar (`suppressed`); `plan` devuelve entonces un plan inerte (`milestone: null`) que nunca se guarda.
 */
const GOAL_MILESTONE: NotificationTypeDefinition = {
  type: 'GOAL_MILESTONE',
  consumer: 'notifications.goal-milestone',
  event: { type: 'goals.SavingsContributionRecorded', version: 1 },
  recipients: ['OWNER', 'EDITOR', 'VIEWER'],
  plan: planGoalMilestone,
  suppressed: (payload) => planGoalMilestone(payload).params['milestone'] === null,
};

/** Registro de tipos por fase: una tabla en código, no un motor de reglas (RISK-005). */
export const NOTIFICATION_TYPE_CATALOG: readonly NotificationTypeDefinition[] = [
  BUDGET_THRESHOLD,
  MONTH_CLOSE_PENDING,
  OCCURRENCE_DUE,
  SUBSCRIPTION_RENEWAL,
  SUBSCRIPTION_TRIAL_ENDING,
  SUBSCRIPTION_PRICE_CHANGE,
  CARD_PAYMENT_DUE,
  CARD_UTILIZATION,
  GOAL_OVER_ALLOCATED,
  GOAL_REACHED,
  GOAL_MILESTONE,
];

export function definitionOf(type: NotificationType): NotificationTypeDefinition {
  const definition = NOTIFICATION_TYPE_CATALOG.find((d) => d.type === type || d.alsoTypes?.includes(type));
  if (!definition) throw new DomainError('VALIDATION_FAILED', `unknown notification type ${type}`);
  return definition;
}

export function definitionForConsumer(consumer: string): NotificationTypeDefinition | undefined {
  return NOTIFICATION_TYPE_CATALOG.find((d) => d.consumer === consumer);
}
