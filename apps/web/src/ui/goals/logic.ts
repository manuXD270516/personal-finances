import { normalizeDecimalInput, parseAmount } from '../common/money';
import type { Account, Transaction } from '../common/types';
import { isNegative, isZero } from '../dashboard/format';
import { compareDecimal, type StatusPresentation } from '../recurring/logic';
import type {
  AccountReservation,
  Goal,
  GoalContributionSuggestion,
  GoalExpectedDate,
  GoalFund,
  GoalMovement,
  GoalPlan,
  GoalStatus,
  GoalTrackingStatus,
  GoalTransactionLinkItem,
  GoalType,
} from './types';
import { GOAL_TYPES } from './types';

/** Lógica pura de Metas de ahorro (openspec add-savings-goals, UI): rutas, estados, formularios y payloads. */

// ───────────────────────────── Rutas ─────────────────────────────

export const goalsPath = (base: string): string => `${base}/goals`;
export const goalPath = (base: string, id: string): string => `${base}/goals/${id}`;
export const reservationsPath = (base: string, accountId?: string): string =>
  accountId
    ? `${base}/goals/reservations?${new URLSearchParams({ accountId }).toString()}`
    : `${base}/goals/reservations`;
export const suggestionsPath = (base: string, status?: string): string =>
  status
    ? `${base}/goals/contribution-suggestions?${new URLSearchParams({ status }).toString()}`
    : `${base}/goals/contribution-suggestions`;
export const voidImpactPath = (base: string, transactionId: string): string =>
  `${base}/goals/void-impact?${new URLSearchParams({ transactionId }).toString()}`;
export const transactionLinksPath = (base: string, transactionIds: readonly string[]): string =>
  `${base}/goals/transaction-links?${new URLSearchParams(transactionIds.map((id) => ['transactionIds', id])).toString()}`;

/** Ruta (sin locale) de la pantalla de metas, del detalle o de una de sus subrutas. */
export const goalsHref = (id?: string, suffix = ''): string => (id ? `/goals/${id}${suffix}` : '/goals');
export const reservationsHref = (accountId?: string): string =>
  accountId ? `/goals/reservas?${new URLSearchParams({ accountId }).toString()}` : '/goals/reservas';

// ───────────────────────────── Estados ─────────────────────────────

/** Estado de ciclo de vida: texto + icono (NFR-USAB-104); el color solo refuerza. */
export const GOAL_STATUS_PRESENTATION: Readonly<Record<GoalStatus, StatusPresentation>> = {
  ACTIVE: { icon: '●', tone: 'neutral' },
  PAUSED: { icon: '⏸', tone: 'warn' },
  ACHIEVED: { icon: '✓', tone: 'ok' },
  CLOSED: { icon: '■', tone: 'neutral' },
  CANCELLED: { icon: '✕', tone: 'neutral' },
};

/** Avance respecto del plan lineal: atrasada, en ritmo o adelantada. */
export const TRACKING_PRESENTATION: Readonly<Record<GoalTrackingStatus, StatusPresentation>> = {
  BEHIND: { icon: '▼', tone: 'warn' },
  ON_TRACK: { icon: '●', tone: 'ok' },
  AHEAD: { icon: '▲', tone: 'ok' },
};

export type StatusView =
  | { readonly kind: 'TRACKING'; readonly value: GoalTrackingStatus }
  | { readonly kind: 'LIFECYCLE'; readonly value: GoalStatus };

/**
 * Estado que se muestra: el de avance (atrasada / en ritmo / adelantada) solo cuando aplica (meta activa con fecha
 * objetivo); si no, el de ciclo de vida (Activa, Pausada, Alcanzada, Cerrada, Cancelada). Una meta pausada nunca
 * muestra avance (TC-GOALS-SAVINGS-034).
 */
export function statusView(tracking: {
  readonly status: GoalTrackingStatus | null;
  readonly lifecycleStatus: GoalStatus;
}): StatusView {
  if (tracking.status !== null && tracking.lifecycleStatus === 'ACTIVE')
    return { kind: 'TRACKING', value: tracking.status };
  return { kind: 'LIFECYCLE', value: tracking.lifecycleStatus };
}

export const isTerminal = (status: GoalStatus): boolean => status === 'CLOSED' || status === 'CANCELLED';

/** ¿Admite aportes, retiros y reasignaciones? (las terminales no: `GOAL_CLOSED`). */
export const acceptsMovements = (goal: Pick<Goal, 'status' | 'archivedAt'>): boolean =>
  !isTerminal(goal.status) && goal.archivedAt === null;

export interface GoalActions {
  readonly edit: boolean;
  readonly contribute: boolean;
  readonly withdraw: boolean;
  readonly reassign: boolean;
  readonly link: boolean;
  readonly plan: boolean;
  readonly pause: boolean;
  readonly resume: boolean;
  readonly close: boolean;
  readonly cancel: boolean;
  readonly archive: boolean;
}

/** Acciones disponibles según el ciclo de vida (la API valida igual: `INVALID_STATUS_TRANSITION`, `GOAL_CLOSED`). */
export function availableGoalActions(goal: Pick<Goal, 'status' | 'archivedAt'>): GoalActions {
  const open = acceptsMovements(goal);
  const live = goal.status === 'ACTIVE' || goal.status === 'ACHIEVED' || goal.status === 'PAUSED';
  return {
    edit: open,
    contribute: open,
    withdraw: open,
    reassign: open,
    link: open,
    plan: open,
    pause: goal.status === 'ACTIVE' && goal.archivedAt === null,
    resume: goal.status === 'PAUSED' && goal.archivedAt === null,
    close: live && goal.archivedAt === null,
    cancel: live && goal.archivedAt === null,
    archive: isTerminal(goal.status) && goal.archivedAt === null,
  };
}

// ───────────────────────────── Progreso ─────────────────────────────

/**
 * Ancho de la barra de progreso (0–100, entero) a partir del porcentaje decimal de la API, sin `number` para el
 * dinero: 99.99 → 99 (nunca parece completa antes de tiempo) y 104.17 → 100.
 */
export function barWidth(percent: string): number {
  if (!/^\d+(\.\d+)?$/.test(percent)) return 0;
  const integer = percent.split('.')[0] ?? '0';
  if (integer.length > 3) return 100;
  const whole = parseInt(integer, 10);
  return whole >= 100 ? 100 : whole;
}

/** Más del 100 % del objetivo (por ejemplo 104.17 %). */
export const exceedsTarget = (percent: string): boolean =>
  /^\d+(\.\d+)?$/.test(percent) && compareDecimal(percent, '100') > 0;

export type ExpectedView =
  | { readonly kind: 'ACHIEVED'; readonly date: string }
  | { readonly kind: 'DATE'; readonly date: string }
  | { readonly kind: 'NO_PACE' }
  | { readonly kind: 'BEYOND_HORIZON' }
  | { readonly kind: 'NONE' };

/**
 * Fecha esperada: la fecha en que se alcanzó, la estimada al ritmo actual, "sin ritmo suficiente" (`NO_PACE`),
 * "más allá del horizonte" o nada (metas terminales).
 */
export function expectedView(goal: {
  readonly status: GoalStatus;
  readonly achievedOn?: string | null | undefined;
  readonly expectedDate: GoalExpectedDate;
}): ExpectedView {
  if (goal.status === 'ACHIEVED' && goal.achievedOn) return { kind: 'ACHIEVED', date: goal.achievedOn };
  if (goal.expectedDate.date) return { kind: 'DATE', date: goal.expectedDate.date };
  if (goal.expectedDate.reason === 'NO_PACE') return { kind: 'NO_PACE' };
  if (goal.expectedDate.reason === 'BEYOND_HORIZON') return { kind: 'BEYOND_HORIZON' };
  return { kind: 'NONE' };
}

/** Fecha esperada del bloque Q9 del Home (`expectedDate` plano): sin fecha en una meta activa ⇒ sin ritmo. */
export function homeExpectedView(item: {
  readonly lifecycleStatus: GoalStatus;
  readonly expectedDate: string | null;
}): ExpectedView {
  if (item.expectedDate) return { kind: 'DATE', date: item.expectedDate };
  return item.lifecycleStatus === 'ACTIVE' || item.lifecycleStatus === 'PAUSED'
    ? { kind: 'NO_PACE' }
    : { kind: 'NONE' };
}

/** Orden de la lista: prioridad (1 primero), fecha objetivo (sin fecha al final) y nombre. */
export function compareGoals(
  a: Pick<Goal, 'priority' | 'targetDate' | 'name'>,
  b: Pick<Goal, 'priority' | 'targetDate' | 'name'>,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.targetDate !== b.targetDate) {
    if (a.targetDate === null) return 1;
    if (b.targetDate === null) return -1;
    return a.targetDate < b.targetDate ? -1 : 1;
  }
  return a.name.localeCompare(b.name, 'es');
}

export const sortGoals = <T extends Pick<Goal, 'priority' | 'targetDate' | 'name'>>(
  goals: readonly T[],
): T[] => [...goals].sort(compareGoals);

// ───────────────────────────── Filtros ─────────────────────────────

export const GOAL_FILTERS = ['OPEN', 'ACTIVE', 'PAUSED', 'ACHIEVED', 'CLOSED', 'CANCELLED', 'ALL'] as const;
export type GoalFilter = (typeof GOAL_FILTERS)[number];

/**
 * Consulta de `listGoals`: "En curso" no envía `status` (la API devuelve Activas, Pausadas y Alcanzadas); los
 * estados terminales incluyen las archivadas, que es donde terminan.
 */
export function goalsQuery(filter: GoalFilter, includeArchived: boolean): URLSearchParams {
  const q = new URLSearchParams();
  if (filter === 'ALL') q.set('status', 'ACTIVE,PAUSED,ACHIEVED,CLOSED,CANCELLED');
  else if (filter !== 'OPEN') q.set('status', filter);
  if (includeArchived || filter === 'ALL' || filter === 'CLOSED' || filter === 'CANCELLED')
    q.set('includeArchived', 'true');
  return q;
}

// ───────────────────────────── Cuentas ─────────────────────────────

/** Cuentas que pueden vincularse a una meta: activas y de naturaleza activo (`GOAL_ACCOUNT_NOT_ELIGIBLE`). */
export const linkableAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => a.status === 'ACTIVE' && a.classification === 'ASSET');

/** Cuentas donde se puede reservar: las mismas que se vinculan (la cuenta no necesita estar vinculada). */
export const reservableAccounts = linkableAccounts;

// ───────────────────────────── Formulario de alta y edición ─────────────────────────────

export type FormErrorCode =
  'REQUIRED' | 'INVALID' | 'SCALE' | 'NOT_POSITIVE' | 'RANGE' | 'DATE_ORDER' | 'NO_CHANGES' | 'SAME_GOAL';
export type GoalFormErrors = Partial<Record<string, FormErrorCode>>;

export interface GoalForm {
  readonly name: string;
  readonly type: GoalType;
  readonly target: string;
  readonly currency: string;
  readonly startDate: string;
  readonly targetDate: string;
  readonly linkedAccountIds: readonly string[];
  readonly priority: string;
  readonly tolerancePercent: string;
  readonly pacePeriods: string;
  readonly notes: string;
}

export function emptyGoalForm(currency: string, today: string): GoalForm {
  return {
    name: '',
    type: 'CUSTOM',
    target: '',
    currency,
    startDate: today,
    targetDate: '',
    linkedAccountIds: [],
    priority: '3',
    tolerancePercent: '5.00',
    pacePeriods: '3',
    notes: '',
  };
}

export function formFromGoal(goal: Goal): GoalForm {
  return {
    name: goal.name,
    type: goal.type,
    target: goal.target.amount,
    currency: goal.target.currency,
    startDate: goal.startDate,
    targetDate: goal.targetDate ?? '',
    linkedAccountIds: goal.linkedAccountIds,
    priority: String(goal.priority),
    tolerancePercent: goal.tolerancePercent,
    pacePeriods: String(goal.pacePeriods),
    notes: goal.notes ?? '',
  };
}

interface Opts {
  readonly locale: string;
  readonly scale: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: string): boolean => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function amountField(
  raw: string,
  field: string,
  o: Opts & { currency: string },
  errors: Record<string, FormErrorCode>,
): string | undefined {
  const r = parseAmount(raw, { locale: o.locale, currency: o.currency, scale: o.scale });
  if (r.ok) return r.value;
  errors[field] = r.error === 'EMPTY' ? 'REQUIRED' : r.error;
  return undefined;
}

/** Entero dentro de un rango (`"3"` → 3); registra el error por campo si no lo es. */
function intField(
  raw: string,
  field: string,
  min: number,
  max: number,
  errors: Record<string, FormErrorCode>,
): number | undefined {
  const v = raw.trim();
  if (v === '') {
    errors[field] = 'REQUIRED';
    return undefined;
  }
  if (!/^\d+$/.test(v)) {
    errors[field] = 'INVALID';
    return undefined;
  }
  const n = parseInt(v, 10);
  if (n < min || n > max) {
    errors[field] = 'RANGE';
    return undefined;
  }
  return n;
}

/** Tolerancia en % (0 a 50, hasta 2 decimales) tolerante al locale → decimal canónico con 2 decimales. */
export function parseTolerance(
  raw: string,
  locale: string,
): { ok: true; value: string } | { ok: false; error: FormErrorCode } {
  if (raw.trim() === '') return { ok: false, error: 'REQUIRED' };
  if (raw.trim().startsWith('-')) return { ok: false, error: 'RANGE' };
  const n = normalizeDecimalInput(raw, locale);
  if (n === null) return { ok: false, error: 'INVALID' };
  const [int = '0', frac = ''] = n.split('.');
  if (frac.replace(/0+$/, '').length > 2) return { ok: false, error: 'SCALE' };
  const canonical = `${int}.${frac.padEnd(2, '0').slice(0, 2)}`;
  if (compareDecimal(canonical, '50.00') > 0) return { ok: false, error: 'RANGE' };
  return { ok: true, value: canonical };
}

function validateCommon(form: GoalForm, o: Opts, errors: Record<string, FormErrorCode>) {
  const name = form.name.trim();
  if (name === '') errors['name'] = 'REQUIRED';
  else if (name.length > 120) errors['name'] = 'RANGE';
  const target = amountField(form.target, 'target', { ...o, currency: form.currency }, errors);
  if (form.targetDate !== '' && !isDate(form.targetDate)) errors['targetDate'] = 'INVALID';
  if (form.startDate !== '' && !isDate(form.startDate)) errors['startDate'] = 'INVALID';
  if (
    errors['targetDate'] === undefined &&
    errors['startDate'] === undefined &&
    form.targetDate !== '' &&
    form.startDate !== '' &&
    form.targetDate < form.startDate
  )
    errors['targetDate'] = 'DATE_ORDER';
  const priority = intField(form.priority, 'priority', 1, 5, errors);
  const pacePeriods = intField(form.pacePeriods, 'pacePeriods', 1, 12, errors);
  const tol = parseTolerance(form.tolerancePercent, o.locale);
  if (!tol.ok) errors['tolerancePercent'] = tol.error;
  if (form.notes.length > 2000) errors['notes'] = 'RANGE';
  return { name, target, priority, pacePeriods, tolerance: tol.ok ? tol.value : undefined };
}

export type BuildResult<T> =
  { readonly ok: true; readonly input: T } | { readonly ok: false; readonly errors: GoalFormErrors };

/** Cuerpo de `POST …/goals`. Monto como string en la escala de la moneda; los opcionales vacíos se omiten. */
export function buildCreateInput(form: GoalForm, o: Opts): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const c = validateCommon(form, o, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name: c.name,
      type: form.type,
      target: { amount: c.target!, currency: form.currency },
      ...(form.startDate !== '' ? { startDate: form.startDate } : {}),
      ...(form.targetDate !== '' ? { targetDate: form.targetDate } : {}),
      linkedAccountIds: [...form.linkedAccountIds],
      priority: c.priority!,
      ...(form.notes.trim() !== '' ? { notes: form.notes.trim() } : {}),
      tolerancePercent: c.tolerance!,
      pacePeriods: c.pacePeriods!,
    },
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Parche (merge-patch) de `PATCH …/goals/{id}` con SOLO lo que cambió respecto de la meta; sin cambios ⇒ error
 * `NO_CHANGES` en `form`. Quitar la fecha objetivo envía `targetDate: null`.
 */
export function buildUpdateInput(form: GoalForm, goal: Goal, o: Opts): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const c = validateCommon(form, o, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const patch: Record<string, unknown> = {};
  if (c.name !== goal.name) patch['name'] = c.name;
  if (form.type !== goal.type) patch['type'] = form.type;
  if (c.target !== goal.target.amount || form.currency !== goal.target.currency)
    patch['target'] = { amount: c.target!, currency: form.currency };
  const targetDate = form.targetDate === '' ? null : form.targetDate;
  if (targetDate !== goal.targetDate) patch['targetDate'] = targetDate;
  if (!sameSet(form.linkedAccountIds, goal.linkedAccountIds))
    patch['linkedAccountIds'] = [...form.linkedAccountIds];
  if (c.priority !== goal.priority) patch['priority'] = c.priority;
  const notes = form.notes.trim() === '' ? null : form.notes.trim();
  if (notes !== goal.notes) patch['notes'] = notes;
  if (c.tolerance !== goal.tolerancePercent) patch['tolerancePercent'] = c.tolerance;
  if (c.pacePeriods !== goal.pacePeriods) patch['pacePeriods'] = c.pacePeriods;
  if (Object.keys(patch).length === 0) return { ok: false, errors: { form: 'NO_CHANGES' } };
  return { ok: true, input: patch };
}

// ───────────────────────────── Aporte / reserva ─────────────────────────────

export interface ContributionForm {
  readonly fund: GoalFund;
  readonly amount: string;
  readonly businessDate: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly note: string;
}

export function emptyContributionForm(
  today: string,
  defaults: Partial<ContributionForm> = {},
): ContributionForm {
  return {
    fund: 'REAL',
    amount: '',
    businessDate: today,
    sourceAccountId: '',
    destinationAccountId: '',
    note: '',
    ...defaults,
  };
}

/**
 * Cuerpo de `POST …/goals/{id}/contributions`. Aporte real: cuenta origen y destino (en la misma moneda); reserva:
 * solo la cuenta donde se reserva (`sourceAccountId`; el destino se ignora). El monto va en la moneda de la cuenta.
 */
export function buildContributionInput(
  form: ContributionForm,
  o: { readonly locale: string; readonly scaleOf: (currency: string) => number },
  accounts: ReadonlyMap<string, Pick<Account, 'currency'>>,
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const source = accounts.get(form.sourceAccountId);
  if (!source) errors['sourceAccountId'] = 'REQUIRED';
  if (form.fund === 'REAL') {
    if (form.destinationAccountId === '') errors['destinationAccountId'] = 'REQUIRED';
    else if (form.destinationAccountId === form.sourceAccountId) errors['destinationAccountId'] = 'SAME_GOAL';
  }
  if (form.businessDate !== '' && !isDate(form.businessDate)) errors['businessDate'] = 'INVALID';
  let amount: string | undefined;
  if (source) {
    amount = amountField(
      form.amount,
      'amount',
      { locale: o.locale, currency: source.currency, scale: o.scaleOf(source.currency) },
      errors,
    );
  } else if (form.amount.trim() === '') errors['amount'] = 'REQUIRED';
  if (form.note.length > 500) errors['note'] = 'RANGE';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      fund: form.fund,
      amount: { amount: amount!, currency: source!.currency },
      ...(form.businessDate !== '' ? { businessDate: form.businessDate } : {}),
      sourceAccountId: form.sourceAccountId,
      ...(form.fund === 'REAL' ? { destinationAccountId: form.destinationAccountId } : {}),
      ...(form.note.trim() !== '' ? { note: form.note.trim() } : {}),
    },
  };
}

// ───────────────────────────── Retiro ─────────────────────────────

export type WithdrawMode = 'TRANSFER' | 'LINK' | 'RELEASE';

export interface WithdrawForm {
  readonly fund: GoalFund;
  readonly accountId: string;
  readonly amount: string;
  readonly mode: WithdrawMode;
  readonly toAccountId: string;
  readonly businessDate: string;
  readonly transactionId: string;
  readonly reason: string;
}

export function emptyWithdrawForm(today: string): WithdrawForm {
  return {
    fund: 'REAL',
    accountId: '',
    amount: '',
    mode: 'TRANSFER',
    toAccountId: '',
    businessDate: today,
    transactionId: '',
    reason: '',
  };
}

/** Modos de retiro por fondo: liberar (`RELEASE`) solo aplica a reservas; un retiro real es transferencia o vínculo. */
export const withdrawModes = (fund: GoalFund): readonly WithdrawMode[] =>
  fund === 'EARMARK' ? ['RELEASE', 'TRANSFER', 'LINK'] : ['TRANSFER', 'LINK'];

/** Cuerpo de `POST …/goals/{id}/withdrawals`. */
export function buildWithdrawInput(
  form: WithdrawForm,
  o: { readonly locale: string; readonly scaleOf: (currency: string) => number },
  accounts: ReadonlyMap<string, Pick<Account, 'currency'>>,
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const account = accounts.get(form.accountId);
  if (!account) errors['accountId'] = 'REQUIRED';
  if (!withdrawModes(form.fund).includes(form.mode)) errors['mode'] = 'INVALID';
  if (form.mode === 'TRANSFER') {
    if (form.toAccountId === '') errors['toAccountId'] = 'REQUIRED';
    else if (form.toAccountId === form.accountId) errors['toAccountId'] = 'SAME_GOAL';
    if (form.businessDate !== '' && !isDate(form.businessDate)) errors['businessDate'] = 'INVALID';
  }
  if (form.mode === 'LINK' && form.transactionId === '') errors['transactionId'] = 'REQUIRED';
  let amount: string | undefined;
  if (account) {
    amount = amountField(
      form.amount,
      'amount',
      { locale: o.locale, currency: account.currency, scale: o.scaleOf(account.currency) },
      errors,
    );
  } else if (form.amount.trim() === '') errors['amount'] = 'REQUIRED';
  if (form.reason.length > 500) errors['reason'] = 'RANGE';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const mode =
    form.mode === 'TRANSFER'
      ? {
          type: 'TRANSFER',
          toAccountId: form.toAccountId,
          ...(form.businessDate !== '' ? { businessDate: form.businessDate } : {}),
        }
      : form.mode === 'LINK'
        ? { type: 'LINK', transactionId: form.transactionId }
        : { type: 'RELEASE' };
  return {
    ok: true,
    input: {
      fund: form.fund,
      accountId: form.accountId,
      amount: { amount: amount!, currency: account!.currency },
      mode,
      ...(form.reason.trim() !== '' ? { reason: form.reason.trim() } : {}),
    },
  };
}

// ───────────────────────────── Reasignación ─────────────────────────────

export interface ReassignForm {
  readonly targetGoalId: string;
  readonly fund: GoalFund;
  readonly accountId: string;
  readonly amount: string;
  readonly reason: string;
}

export const emptyReassignForm = (): ReassignForm => ({
  targetGoalId: '',
  fund: 'EARMARK',
  accountId: '',
  amount: '',
  reason: '',
});

/** Cuerpo de `POST …/goals/{id}/reassignments`. */
export function buildReassignInput(
  form: ReassignForm,
  sourceGoalId: string,
  o: { readonly locale: string; readonly scaleOf: (currency: string) => number },
  accounts: ReadonlyMap<string, Pick<Account, 'currency'>>,
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  if (form.targetGoalId === '') errors['targetGoalId'] = 'REQUIRED';
  else if (form.targetGoalId === sourceGoalId) errors['targetGoalId'] = 'SAME_GOAL';
  const account = accounts.get(form.accountId);
  if (!account) errors['accountId'] = 'REQUIRED';
  let amount: string | undefined;
  if (account) {
    amount = amountField(
      form.amount,
      'amount',
      { locale: o.locale, currency: account.currency, scale: o.scaleOf(account.currency) },
      errors,
    );
  } else if (form.amount.trim() === '') errors['amount'] = 'REQUIRED';
  if (form.reason.length > 500) errors['reason'] = 'RANGE';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      targetGoalId: form.targetGoalId,
      fund: form.fund,
      accountId: form.accountId,
      amount: { amount: amount!, currency: account!.currency },
      ...(form.reason.trim() !== '' ? { reason: form.reason.trim() } : {}),
    },
  };
}

// ───────────────────────────── Plan mensual y programación recurrente ─────────────────────────────

export interface PlanForm {
  readonly monthlyAmount: string;
  readonly fund: GoalFund;
  readonly automation: 'NONE' | 'RECURRING';
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly dayOfMonth: string;
  readonly mode: 'PENDING_APPROVAL' | 'AUTO_CREATE';
  readonly autoCreateStatus: 'PENDING' | 'POSTED';
}

export function planFormFrom(plan: GoalPlan | null, currencyAmount?: string): PlanForm {
  return {
    monthlyAmount: plan?.monthlyAmount.amount ?? currencyAmount ?? '',
    fund: plan?.fund ?? 'REAL',
    automation: plan?.automation ?? 'NONE',
    sourceAccountId: plan?.sourceAccountId ?? '',
    destinationAccountId: plan?.destinationAccountId ?? '',
    dayOfMonth: plan?.dayOfMonth === null || plan?.dayOfMonth === undefined ? '' : String(plan.dayOfMonth),
    mode: plan?.materialization?.mode ?? 'PENDING_APPROVAL',
    autoCreateStatus: plan?.materialization?.autoCreateStatus ?? 'POSTED',
  };
}

/**
 * Cuerpo de `PUT …/goals/{id}/plan`. La programación recurrente exige aporte real, cuenta de origen y de destino
 * (en la moneda del objetivo) y día del mes; la materialización indica cómo se crean los aportes.
 */
export function buildPlanInput(
  form: PlanForm,
  o: Opts & { currency: string },
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const monthly = amountField(form.monthlyAmount, 'monthlyAmount', o, errors);
  const recurring = form.automation === 'RECURRING';
  if (recurring && form.fund !== 'REAL') errors['fund'] = 'INVALID';
  if (recurring && form.sourceAccountId === '') errors['sourceAccountId'] = 'REQUIRED';
  if (recurring && form.destinationAccountId === '') errors['destinationAccountId'] = 'REQUIRED';
  if (recurring && form.sourceAccountId !== '' && form.sourceAccountId === form.destinationAccountId)
    errors['destinationAccountId'] = 'SAME_GOAL';
  let day: number | undefined;
  if (recurring || form.dayOfMonth.trim() !== '')
    day = intField(form.dayOfMonth, 'dayOfMonth', 1, 31, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      monthlyAmount: { amount: monthly!, currency: o.currency },
      fund: form.fund,
      automation: form.automation,
      ...(form.sourceAccountId !== '' ? { sourceAccountId: form.sourceAccountId } : {}),
      ...(form.destinationAccountId !== '' ? { destinationAccountId: form.destinationAccountId } : {}),
      ...(day !== undefined ? { dayOfMonth: day } : {}),
      ...(recurring
        ? {
            materialization: {
              mode: form.mode,
              ...(form.mode === 'AUTO_CREATE' ? { autoCreateStatus: form.autoCreateStatus } : {}),
            },
          }
        : {}),
    },
  };
}

// ───────────────────────────── Simulación what-if ─────────────────────────────

export interface SimulationForm {
  readonly monthlyContribution: string;
  readonly targetAmount: string;
  readonly targetDate: string;
}

export const EMPTY_SIMULATION: SimulationForm = { monthlyContribution: '', targetAmount: '', targetDate: '' };

/** Cuerpo de `POST …/simulations`: al menos un valor; los omitidos conservan el de la meta. */
export function buildSimulationInput(
  form: SimulationForm,
  o: Opts & { currency: string },
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const input: Record<string, unknown> = {};
  if (form.monthlyContribution.trim() !== '') {
    const v = amountField(form.monthlyContribution, 'monthlyContribution', o, errors);
    if (v !== undefined) input['monthlyContribution'] = { amount: v, currency: o.currency };
  }
  if (form.targetAmount.trim() !== '') {
    const v = amountField(form.targetAmount, 'targetAmount', o, errors);
    if (v !== undefined) input['targetAmount'] = { amount: v, currency: o.currency };
  }
  if (form.targetDate !== '') {
    if (!isDate(form.targetDate)) errors['targetDate'] = 'INVALID';
    else input['targetDate'] = form.targetDate;
  }
  if (Object.keys(errors).length === 0 && Object.keys(input).length === 0)
    errors['monthlyContribution'] = 'REQUIRED';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input };
}

// ───────────────────────────── Movimientos ─────────────────────────────

/** Ids de movimientos ya cancelados por un inverso (`reversesId`). */
export const reversedIds = (movements: readonly GoalMovement[]): ReadonlySet<string> =>
  new Set(movements.flatMap((m) => (m.reversesId ? [m.reversesId] : [])));

export const isInverse = (m: Pick<GoalMovement, 'movement' | 'reversesId'>): boolean =>
  m.movement === 'REVERSAL' || m.reversesId !== null;

export const isReassignment = (m: Pick<GoalMovement, 'movement'>): boolean =>
  m.movement === 'REASSIGN_IN' || m.movement === 'REASSIGN_OUT';

/** Añade una página de movimientos sin duplicar. */
export function appendMovements(
  items: readonly GoalMovement[],
  more: readonly GoalMovement[],
): GoalMovement[] {
  const seen = new Set(items.map((i) => i.id));
  return [...items, ...more.filter((m) => !seen.has(m.id))];
}

export function movementsQuery(cursor?: string | null): URLSearchParams {
  const q = new URLSearchParams({ limit: '50' });
  if (cursor) q.set('cursor', cursor);
  return q;
}

// ───────────────────────────── Transacciones elegibles ─────────────────────────────

const POSTED_STATUSES = new Set(['POSTED', 'CLEARED', 'RECONCILED']);

/** Transferencias posteadas cuyo destino es una cuenta vinculada: candidatas a vincularse como aporte. */
export function linkableContributions(
  txs: readonly Transaction[],
  linkedAccountIds: readonly string[],
): Transaction[] {
  return txs.filter(
    (tx) =>
      tx.kind === 'TRANSFER' &&
      POSTED_STATUSES.has(tx.status) &&
      tx.legs.some((l) => l.role === 'TARGET' && linkedAccountIds.includes(l.accountId)),
  );
}

/** Gastos y transferencias posteadas que salen de la cuenta: candidatos a respaldar un retiro. */
export function linkableWithdrawals(txs: readonly Transaction[], accountId: string): Transaction[] {
  return txs.filter(
    (tx) =>
      (tx.kind === 'EXPENSE' || tx.kind === 'TRANSFER') &&
      POSTED_STATUSES.has(tx.status) &&
      tx.legs.some(
        (l) =>
          l.accountId === accountId &&
          (l.role === 'SOURCE' || l.role === 'MAIN') &&
          isNegative(l.amount.amount),
      ),
  );
}

/** Vínculos de una transacción con metas: primero los vigentes. */
export const orderLinks = (links: readonly GoalTransactionLinkItem[]): GoalTransactionLinkItem[] =>
  [...links].sort((a, b) => Number(b.active) - Number(a.active));

// ───────────────────────────── Sugerencias de aporte ─────────────────────────────

export const pendingSuggestions = (
  items: readonly GoalContributionSuggestion[],
): GoalContributionSuggestion[] =>
  items
    .filter((s) => s.status === 'PENDING')
    .sort((a, b) =>
      a.businessDate === b.businessDate
        ? a.createdAt < b.createdAt
          ? 1
          : -1
        : a.businessDate < b.businessDate
          ? 1
          : -1,
    );

/** Una sugerencia sin meta propuesta exige elegirla para confirmarse. */
export const suggestionNeedsGoal = (s: Pick<GoalContributionSuggestion, 'goalId'>): boolean =>
  s.goalId === null;

/** Cuerpo de `confirm`: solo lleva `goalId` cuando la sugerencia no trae meta. */
export function confirmBody(
  s: Pick<GoalContributionSuggestion, 'goalId'>,
  chosen: string,
): Record<string, unknown> | null {
  if (!suggestionNeedsGoal(s)) return {};
  return chosen === '' ? null : { goalId: chosen };
}

// ───────────────────────────── Reservas por cuenta ─────────────────────────────

/** Cuentas sobre-asignadas primero; luego por nombre. */
export function sortReservations(items: readonly AccountReservation[]): AccountReservation[] {
  return [...items].sort((a, b) =>
    a.overAllocated === b.overAllocated
      ? a.accountName.localeCompare(b.accountName, 'es')
      : a.overAllocated
        ? -1
        : 1,
  );
}

/** Faltante a mostrar de una cuenta sobre-asignada (nunca negativo ni vacío si el dato falta). */
export function shortfallOf(
  r: Pick<AccountReservation, 'overAllocated' | 'shortfall' | 'available'>,
): string | null {
  if (!r.overAllocated) return null;
  if (r.shortfall && !isZero(r.shortfall)) return r.shortfall.replace(/^-/, '');
  return isNegative(r.available) ? r.available.slice(1) : null;
}

// ───────────────────────────── Errores ─────────────────────────────

export interface ProblemWithDetails {
  readonly code?: unknown;
  readonly details?: unknown;
  readonly [k: string]: unknown;
}

/** Motivos (`KIND`, `STATUS`, `ACCOUNT`, `AMOUNT`) de `GOAL_TRANSACTION_NOT_ELIGIBLE`. */
export function eligibilityReasons(problem: ProblemWithDetails): string[] {
  const details = problem.details as { reasons?: unknown } | undefined;
  const reasons = details?.reasons ?? (problem['reasons'] as unknown);
  return Array.isArray(reasons)
    ? reasons.filter((r): r is string => typeof r === 'string' && /^[A-Z_]+$/.test(r))
    : [];
}

/** Saldo, reservado y disponible de `EARMARK_EXCEEDS_BALANCE` (strings decimales) para explicar el rechazo. */
export function earmarkDetails(
  problem: ProblemWithDetails,
): { balance: string; reserved: string; available: string } | null {
  const d = (problem.details ?? problem) as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const v = d[k];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof (v as { amount?: unknown }).amount === 'string')
      return (v as { amount: string }).amount;
    return null;
  };
  const balance = pick('balance');
  const reserved = pick('reserved');
  const available = pick('available');
  return balance !== null && reserved !== null && available !== null
    ? { balance, reserved, available }
    : null;
}

export { GOAL_TYPES };
