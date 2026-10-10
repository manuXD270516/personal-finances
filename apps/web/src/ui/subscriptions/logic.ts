/**
 * Lógica pura de la pantalla de suscripciones (openspec add-subscriptions 6.1–6.3): presentación de estados y
 * resultados de cargo, formulario de alta/edición (validación y cuerpos de la API), acciones disponibles según el
 * estado, cancelación inmediata o al fin del ciclo, montos del extracto y consultas. Sin React ni zona horaria del
 * proceso: "hoy" llega calculado en la zona del workspace. Los montos son strings decimales (INV-001) validados
 * contra la escala de la moneda sin redondear.
 */
import { normalizeDecimalInput, parseAmount } from '../common/money';
import type { Money } from '../common/types';
import { formatDecimal } from '../AuditHistory';
import { compareDecimal, type Tone } from '../recurring/logic';
import type { MaterializationMode, RecurringCadence } from '../recurring/types';
import type {
  ChargeOutcome,
  ProposalStatus,
  Subscription,
  SubscriptionPrice,
  SubscriptionStatus,
} from './types';

// ───────────────────────────── Estados (texto + icono, NFR-USAB-104) ─────────────────────────────

export interface Presentation {
  /** Icono decorativo (`aria-hidden`): el texto siempre acompaña. */
  readonly icon: string;
  readonly tone: Tone;
}

export const STATUS_PRESENTATION: Readonly<Record<SubscriptionStatus, Presentation>> = {
  TRIAL: { icon: '◔', tone: 'warn' },
  ACTIVE: { icon: '▶', tone: 'ok' },
  PAUSED: { icon: '⏸', tone: 'warn' },
  CANCELLED: { icon: '✕', tone: 'neutral' },
};

export const OUTCOME_PRESENTATION: Readonly<Record<ChargeOutcome, Presentation>> = {
  WITHIN_TOLERANCE: { icon: '✓', tone: 'ok' },
  PRICE_CHANGE_DETECTED: { icon: '⚠', tone: 'warn' },
  NOT_COMPARABLE: { icon: 'ℹ', tone: 'neutral' },
};

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED',
  'WITHDRAWN',
];

// ───────────────────────────── Rutas, consultas y eventos ─────────────────────────────

export const SUBSCRIPTIONS_PATH = '/recurring/suscripciones';

/** Detalle de una suscripción; `historial` marca el acceso desde el listado (una cancelada sí se consulta). */
export function subscriptionPath(
  id: string,
  opts: { cancelled?: boolean; proposalId?: string } = {},
): string {
  const query = new URLSearchParams();
  if (opts.cancelled) query.set('historial', '1');
  if (opts.proposalId) query.set('propuesta', opts.proposalId);
  const q = query.toString();
  return `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}

export const SUBSCRIPTIONS_LIMIT = 200;

/** Sin `status` la API excluye las canceladas; "Mostrar canceladas" pide todos los estados. */
export function listQuery(showCancelled: boolean): string {
  const query = new URLSearchParams({ limit: String(SUBSCRIPTIONS_LIMIT) });
  if (showCancelled) query.set('status', 'TRIAL,ACTIVE,PAUSED,CANCELLED');
  return query.toString();
}

export const CHARGES_LIMIT = 100;

// ───────────────────────────── Formato ─────────────────────────────

/** `+20.02` → `+20,02 %` (el signo viaja en el string; sin pasar por `number`). */
export function formatPercent(value: string, locale: string): string {
  const sign = value.startsWith('-') ? '-' : value.startsWith('+') ? '+' : '';
  const digits = sign ? value.slice(1) : value;
  return `${sign}${formatDecimal(digits, locale)} %`;
}

/** Tasa implícita con sus 4 decimales (`9.8726` → `9,8726`). */
export const formatImpliedRate = (rate: string, locale: string): string => formatDecimal(rate, locale);

/** ¿El precio de la suscripción está en una moneda distinta de la de la cuenta de pago? (aviso del formulario) */
export const currencyMismatch = (priceCurrency: string, accountCurrency: string | undefined): boolean =>
  Boolean(accountCurrency) && Boolean(priceCurrency) && accountCurrency !== priceCurrency;

/** Precio vigente hoy y su moneda, en el orden del historial (la más reciente vigencia no futura sin reemplazo). */
export function priceInForce(
  history: readonly SubscriptionPrice[],
  today: string,
): SubscriptionPrice | undefined {
  return [...history]
    .filter((p) => p.supersededBy === null && p.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))[0];
}

/** Historial para mostrar: la vigencia más reciente primero; a igual vigencia, la entrada reemplazante antes. */
export function historyRows(history: readonly SubscriptionPrice[]): SubscriptionPrice[] {
  return [...history].sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    if (a.supersededBy === null && b.supersededBy !== null) return -1;
    if (a.supersededBy !== null && b.supersededBy === null) return 1;
    return 0;
  });
}

/** Última vigencia no reemplazada: el piso para registrar un precio nuevo. */
export function lastEffectiveFrom(history: readonly SubscriptionPrice[]): string | undefined {
  return history
    .filter((p) => p.supersededBy === null)
    .map((p) => p.effectiveFrom)
    .sort()
    .at(-1);
}

// ───────────────────────────── Acciones disponibles ─────────────────────────────

export interface SubscriptionActions {
  readonly edit: boolean;
  readonly addPrice: boolean;
  readonly supersede: boolean;
  readonly pause: boolean;
  readonly resume: boolean;
  readonly cancel: boolean;
  readonly cancelAtCycleEnd: boolean;
  readonly undoCancellation: boolean;
  readonly decideProposal: boolean;
  readonly recordStatement: boolean;
}

/**
 * Acciones según rol y estado (`INVALID_STATUS_TRANSITION` en el servidor es la última palabra): solo un EDITOR/OWNER
 * escribe; una cancelada es de solo lectura; solo `ACTIVE` se pausa y solo `PAUSED` se reanuda; la cancelación al fin
 * del ciclo necesita una próxima renovación.
 */
export function availableActions(
  sub: Pick<Subscription, 'status' | 'scheduledCancellationOn' | 'nextRenewalOn'>,
  canEdit: boolean,
): SubscriptionActions {
  const live = canEdit && sub.status !== 'CANCELLED';
  return {
    edit: live,
    addPrice: live,
    supersede: live,
    pause: live && sub.status === 'ACTIVE',
    resume: live && sub.status === 'PAUSED',
    cancel: live,
    cancelAtCycleEnd: live && sub.nextRenewalOn !== null,
    undoCancellation: live && sub.scheduledCancellationOn !== null,
    decideProposal: live,
    recordStatement: live,
  };
}

// ───────────────────────────── Formulario de alta / edición ─────────────────────────────

export interface SubscriptionForm {
  readonly counterpartyId: string;
  readonly name: string;
  readonly planName: string;
  readonly price: string;
  readonly currency: string;
  readonly cadence: RecurringCadence;
  readonly interval: string;
  readonly firstRenewalOn: string;
  readonly trialEndsOn: string;
  readonly paymentAccountId: string;
  readonly mode: MaterializationMode;
  readonly autoCreateStatus: 'PENDING' | 'POSTED';
  readonly categoryId: string;
  readonly reminderEnabled: boolean;
  readonly reminderDays: string;
  readonly tolerance: string;
  readonly cancellationUrl: string;
}

export const DEFAULT_REMINDER_DAYS = '3';
export const DEFAULT_TOLERANCE = '1.00';

export function emptyForm(today: string): SubscriptionForm {
  return {
    counterpartyId: '',
    name: '',
    planName: '',
    price: '',
    currency: 'BOB',
    cadence: 'MONTHLY',
    interval: '1',
    firstRenewalOn: today,
    trialEndsOn: '',
    paymentAccountId: '',
    mode: 'PENDING_APPROVAL',
    autoCreateStatus: 'PENDING',
    categoryId: '',
    reminderEnabled: true,
    reminderDays: DEFAULT_REMINDER_DAYS,
    tolerance: DEFAULT_TOLERANCE,
    cancellationUrl: '',
  };
}

/** Estado del formulario de edición a partir del detalle (el precio y el primer cobro no se editan aquí). */
export function formFromSubscription(sub: Subscription): SubscriptionForm {
  const mat = sub.definition?.materialization;
  return {
    counterpartyId: sub.counterpartyId,
    name: sub.name,
    planName: sub.planName ?? '',
    price: sub.currentPrice.amount,
    currency: sub.currentPrice.currency,
    cadence: sub.billingCycle.cadence,
    interval: String(sub.billingCycle.interval),
    firstRenewalOn: sub.nextRenewalOn ?? '',
    trialEndsOn: sub.trialEndsOn ?? '',
    paymentAccountId: sub.paymentAccountId,
    mode: mat?.mode ?? 'PENDING_APPROVAL',
    autoCreateStatus: mat?.autoCreateStatus === 'POSTED' ? 'POSTED' : 'PENDING',
    categoryId: sub.definition?.categoryId ?? '',
    reminderEnabled: sub.reminder.enabled,
    reminderDays: String(sub.reminder.daysBefore),
    tolerance: sub.priceTolerancePercent,
    cancellationUrl: sub.cancellationUrl ?? '',
  };
}

export type FormErrorCode =
  | 'REQUIRED'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_SCALE'
  | 'AMOUNT_NOT_POSITIVE'
  | 'INTERVAL'
  | 'DATE'
  | 'TRIAL_AFTER_RENEWAL'
  | 'REMINDER_DAYS'
  | 'TOLERANCE'
  | 'URL'
  | 'NOT_CHRONOLOGICAL'
  | 'NO_CHANGES';

export type FormErrors = Partial<Record<string, FormErrorCode>>;

export type BuildResult<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly errors: FormErrors };

export interface FormEnv {
  readonly locale: string;
  readonly scale: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string): boolean =>
  DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const AMOUNT_ERROR: Record<string, FormErrorCode> = {
  EMPTY: 'REQUIRED',
  INVALID: 'AMOUNT_INVALID',
  SCALE: 'AMOUNT_SCALE',
  NOT_POSITIVE: 'AMOUNT_NOT_POSITIVE',
};

/** Monto positivo del formulario en la moneda y escala dadas, o el código de error. */
export function moneyOf(
  raw: string,
  currency: string,
  env: FormEnv,
): { readonly ok: true; readonly money: Money } | { readonly ok: false; readonly error: FormErrorCode } {
  const parsed = parseAmount(raw, { locale: env.locale, currency, scale: env.scale });
  return parsed.ok
    ? { ok: true, money: { amount: parsed.value, currency } }
    : { ok: false, error: AMOUNT_ERROR[parsed.error] ?? 'AMOUNT_INVALID' };
}

/** Tolerancia 0–50 con hasta 2 decimales (`^[0-9]{1,2}(\.[0-9]{1,2})?$`), tolerante al locale; `null` si no es válida. */
export function normalizeTolerance(raw: string, locale: string): string | null {
  if (raw.trim() === '' || raw.trim().startsWith('-')) return null;
  const n = normalizeDecimalInput(raw, locale);
  if (n === null) return null;
  const [int = '0', frac = ''] = n.split('.');
  const trimmedInt = int.replace(/^0+(?=\d)/, '');
  if (trimmedInt.length > 2 || frac.length > 2) return null;
  const value = frac ? `${trimmedInt}.${frac}` : trimmedInt;
  return compareDecimal(value, '50') > 0 ? null : value;
}

/** Días de anticipación del recordatorio: entero de 1 a 30. */
export function parseReminderDays(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= 1 && n <= 30 ? n : null;
}

function parseInterval(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= 1 && n <= 120 ? n : null;
}

const validUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

function materializationOf(s: SubscriptionForm): Record<string, unknown> {
  return { mode: s.mode, ...(s.mode === 'AUTO_CREATE' ? { autoCreateStatus: s.autoCreateStatus } : {}) };
}

/**
 * Cuerpo de `POST /subscriptions` (`SubscriptionInput`). Valida en el cliente lo que la API valida (la API es la última
 * palabra): obligatorios, precio positivo con la escala de su moneda, ciclo, fechas (la primera renovación no precede al
 * fin del trial), recordatorio 1–30 y tolerancia 0–50.
 */
export function buildCreateBody(s: SubscriptionForm, env: FormEnv): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  if (!s.counterpartyId) errors['counterpartyId'] = 'REQUIRED';
  if (s.name.trim() === '') errors['name'] = 'REQUIRED';
  if (!s.paymentAccountId) errors['paymentAccountId'] = 'REQUIRED';
  const price = moneyOf(s.price, s.currency, env);
  if (!price.ok) errors['price'] = price.error;
  const interval = parseInterval(s.interval);
  if (interval === null) errors['interval'] = 'INTERVAL';
  if (!isDate(s.firstRenewalOn)) errors['firstRenewalOn'] = 'DATE';
  if (s.trialEndsOn !== '') {
    if (!isDate(s.trialEndsOn)) errors['trialEndsOn'] = 'DATE';
    else if (isDate(s.firstRenewalOn) && s.firstRenewalOn < s.trialEndsOn)
      errors['firstRenewalOn'] = 'TRIAL_AFTER_RENEWAL';
  }
  const days = parseReminderDays(s.reminderDays);
  if (days === null) errors['reminderDays'] = 'REMINDER_DAYS';
  const tolerance = normalizeTolerance(s.tolerance, env.locale);
  if (tolerance === null) errors['tolerance'] = 'TOLERANCE';
  const url = s.cancellationUrl.trim();
  if (url !== '' && !validUrl(url)) errors['cancellationUrl'] = 'URL';
  if (Object.keys(errors).length > 0 || !price.ok || interval === null || days === null || tolerance === null)
    return { ok: false, errors };

  return {
    ok: true,
    body: {
      counterpartyId: s.counterpartyId,
      name: s.name.trim(),
      ...(s.planName.trim() ? { planName: s.planName.trim() } : {}),
      price: price.money,
      billingCycle: { cadence: s.cadence, interval },
      firstRenewalOn: s.firstRenewalOn,
      paymentAccountId: s.paymentAccountId,
      materialization: materializationOf(s),
      ...(s.categoryId ? { categoryId: s.categoryId } : {}),
      ...(s.trialEndsOn ? { trialEndsOn: s.trialEndsOn } : {}),
      reminder: { enabled: s.reminderEnabled, daysBefore: days },
      priceTolerancePercent: tolerance,
      ...(url ? { cancellationUrl: url } : {}),
    },
  };
}

/**
 * Cuerpo de `PATCH /subscriptions/{id}` (merge-patch con `SubscriptionUpdate`): solo lo que cambió. Cambiar la cuenta
 * de pago o el ciclo exige una fecha de efecto (`effectiveFrom`), que solo alcanza a los cargos desde esa fecha.
 */
export function buildUpdateBody(
  initial: SubscriptionForm,
  s: SubscriptionForm,
  effectiveFrom: string,
  env: FormEnv,
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const body: Record<string, unknown> = {};
  if (s.name.trim() === '') errors['name'] = 'REQUIRED';
  else if (s.name.trim() !== initial.name) body['name'] = s.name.trim();
  if (s.planName.trim() !== initial.planName.trim()) body['planName'] = s.planName.trim() || null;
  if (s.categoryId !== initial.categoryId) body['categoryId'] = s.categoryId || null;
  if (
    s.mode !== initial.mode ||
    (s.mode === 'AUTO_CREATE' && s.autoCreateStatus !== initial.autoCreateStatus)
  )
    body['materialization'] = materializationOf(s);

  const reminder: Record<string, unknown> = {};
  if (s.reminderEnabled !== initial.reminderEnabled) reminder['enabled'] = s.reminderEnabled;
  const days = parseReminderDays(s.reminderDays);
  if (days === null) errors['reminderDays'] = 'REMINDER_DAYS';
  else if (days !== Number(initial.reminderDays)) reminder['daysBefore'] = days;
  if (Object.keys(reminder).length > 0) body['reminder'] = reminder;

  const tolerance = normalizeTolerance(s.tolerance, env.locale);
  if (tolerance === null) errors['tolerance'] = 'TOLERANCE';
  else if (compareDecimal(tolerance, initial.tolerance) !== 0) body['priceTolerancePercent'] = tolerance;

  const url = s.cancellationUrl.trim();
  if (url !== '' && !validUrl(url)) errors['cancellationUrl'] = 'URL';
  else if (url !== initial.cancellationUrl.trim()) body['cancellationUrl'] = url || null;

  let needsDate = false;
  if (s.paymentAccountId !== initial.paymentAccountId) {
    if (!s.paymentAccountId) errors['paymentAccountId'] = 'REQUIRED';
    else {
      body['paymentAccountId'] = s.paymentAccountId;
      needsDate = true;
    }
  }
  if (s.cadence !== initial.cadence || s.interval !== initial.interval) {
    const interval = parseInterval(s.interval);
    if (interval === null) errors['interval'] = 'INTERVAL';
    else {
      body['billingCycle'] = { cadence: s.cadence, interval };
      needsDate = true;
    }
  }
  if (needsDate) {
    if (!isDate(effectiveFrom)) errors['effectiveFrom'] = 'DATE';
    else body['effectiveFrom'] = effectiveFrom;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(body).length === 0) return { ok: false, errors: { form: 'NO_CHANGES' } };
  return { ok: true, body };
}

// ───────────────────────────── Precios, cargos y cancelación ─────────────────────────────

/** Cuerpo de `POST …/prices`: precio positivo en la moneda de la suscripción y su vigencia. */
export function buildPriceBody(
  raw: string,
  effectiveFrom: string,
  currency: string,
  env: FormEnv,
): BuildResult<{ price: Money; effectiveFrom: string }> {
  const errors: Record<string, FormErrorCode> = {};
  const price = moneyOf(raw, currency, env);
  if (!price.ok) errors['price'] = price.error;
  if (!isDate(effectiveFrom)) errors['effectiveFrom'] = 'DATE';
  if (!price.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { price: price.money, effectiveFrom } };
}

/** Cuerpo de `POST …/prices/{id}/supersede`: el monto corregido y un motivo opcional. */
export function buildSupersedeBody(
  raw: string,
  reason: string,
  currency: string,
  env: FormEnv,
): BuildResult<Record<string, unknown>> {
  const price = moneyOf(raw, currency, env);
  if (!price.ok) return { ok: false, errors: { price: price.error } };
  return { ok: true, body: { price: price.money, ...(reason.trim() ? { reason: reason.trim() } : {}) } };
}

/** Cuerpo de `PATCH …/charges/{id}`: el monto del extracto en la moneda del precio. */
export function buildChargeBody(
  raw: string,
  priceCurrency: string,
  env: FormEnv,
): BuildResult<{ priceCurrencyAmount: Money }> {
  const amount = moneyOf(raw, priceCurrency, env);
  return amount.ok
    ? { ok: true, body: { priceCurrencyAmount: amount.money } }
    : { ok: false, errors: { amount: amount.error } };
}

/** Un cargo en otra moneda sin el monto del extracto no se compara con el precio. */
export const isNotComparable = (outcome: ChargeOutcome): boolean => outcome === 'NOT_COMPARABLE';

export type CancelMode = 'NOW' | 'CYCLE_END';

/**
 * Cuerpo de `POST …/cancel`: ahora (sin fecha, la API usa hoy) o al fin del ciclo pagado (la fecha de la próxima
 * renovación, que ya no se cobrará). El motivo es opcional.
 */
export function buildCancelBody(
  mode: CancelMode,
  nextRenewalOn: string | null,
  reason: string,
): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = {};
  if (mode === 'CYCLE_END' && nextRenewalOn) body['effectiveOn'] = nextRenewalOn;
  if (reason.trim()) body['reason'] = reason.trim();
  return Object.keys(body).length > 0 ? body : undefined;
}

/** ¿Dos fechas ISO en orden estricto? (la fecha de una aceptación debe ser posterior a la última vigencia) */
export const isAfter = (date: string, other: string | undefined): boolean =>
  other === undefined || date > other;

/** Cuenta de pago con su moneda para el aviso del formulario. */
export function accountCurrencyOf(
  accounts: readonly { readonly id: string; readonly currency: string }[],
  id: string,
): string | undefined {
  return accounts.find((a) => a.id === id)?.currency;
}
