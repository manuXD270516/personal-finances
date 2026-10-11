/**
 * Lógica pura de la pantalla de pagos recurrentes (openspec add-recurrence-engine 7.1): presentación de estados,
 * formulario de definición (validación, cuerpo de la API, diff de una revisión), vista previa de fechas con el
 * shared-kernel (mismas reglas que la API: `ruleFromCadence`, `RRuleSubset`, `WeekendAdjustment`), formularios de las
 * acciones por ocurrencia y consultas. Sin React ni zona horaria del proceso: "hoy" llega calculado en la zona del
 * workspace. Los montos son strings decimales (INV-001) validados contra la escala de la moneda sin redondear.
 */
import {
  LocalDate,
  RRuleSubset,
  WeekendAdjustment,
  createRecurrenceRule,
  nextRecurrenceDates,
  ruleFromCadence,
  type Cadence,
  type RecurrenceRule,
} from '@pf/shared-kernel';
import { parseAmount } from '../common/money';
import type { Money, PaymentMethod, Transaction } from '../common/types';
import type {
  CommittedItem,
  MaterializationMode,
  OccurrenceStatus,
  OfferedKind,
  RecurringAmount,
  RecurringAmountType,
  RecurringCadence,
  RecurringDefinitionVersion,
  RecurringOccurrence,
  WeekendAdjustmentMode,
} from './types';

// ───────────────────────────── Estados (texto + icono, NFR-USAB-104) ─────────────────────────────

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface StatusPresentation {
  /** Icono decorativo (`aria-hidden`): el texto siempre acompaña. */
  readonly icon: string;
  readonly tone: Tone;
}

export const OCCURRENCE_PRESENTATION: Readonly<Record<OccurrenceStatus, StatusPresentation>> = {
  SCHEDULED: { icon: '◷', tone: 'neutral' },
  DUE: { icon: '●', tone: 'warn' },
  OVERDUE: { icon: '⚠', tone: 'danger' },
  MATERIALIZED: { icon: '✓', tone: 'ok' },
  MATCHED: { icon: '⇄', tone: 'ok' },
  SKIPPED: { icon: '↷', tone: 'neutral' },
  CANCELLED: { icon: '✕', tone: 'neutral' },
};

export const DEFINITION_PRESENTATION: Readonly<Record<'ACTIVE' | 'PAUSED' | 'ENDED', StatusPresentation>> = {
  ACTIVE: { icon: '▶', tone: 'ok' },
  PAUSED: { icon: '⏸', tone: 'warn' },
  ENDED: { icon: '■', tone: 'neutral' },
};

/** Sin resolver: puede aprobarse, vincularse, omitirse y editarse (design decisión 11). */
export const isUnresolved = (status: OccurrenceStatus): boolean =>
  status === 'SCHEDULED' || status === 'DUE' || status === 'OVERDUE';

export type OccurrenceAction = 'approve' | 'link' | 'skip' | 'edit';
export const OCCURRENCE_ACTIONS: readonly OccurrenceAction[] = ['approve', 'link', 'skip', 'edit'];

/** Acciones disponibles de una ocurrencia: solo un EDITOR/OWNER y solo si no está resuelta (D114: también `NOTIFY_ONLY`). */
export function availableOccurrenceActions(
  occurrence: Pick<RecurringOccurrence, 'status'> & Partial<Pick<RecurringOccurrence, 'kind' | 'managedBy'>>,
  canEdit: boolean,
): readonly OccurrenceAction[] {
  // Las cuotas de un préstamo las administra el préstamo (409 RECURRING_MANAGED_EXTERNALLY): solo "Registrar pago".
  if (isLoanInstallment(occurrence)) return [];
  return canEdit && isUnresolved(occurrence.status) ? OCCURRENCE_ACTIONS : [];
}

/** Ocurrencia de una cuota de préstamo (`kind = LOAN_PAYMENT`, definición administrada por Deudas). */
export const isLoanInstallment = (o: Partial<Pick<RecurringOccurrence, 'kind' | 'managedBy'>>): boolean =>
  o.kind === 'LOAN_PAYMENT' || o.managedBy === 'DEBT';

/** ¿Ofrece "Registrar pago"? Solo EDITOR/OWNER y mientras la cuota no esté resuelta. */
export const canRegisterLoanPayment = (
  o: Pick<RecurringOccurrence, 'status'> & Partial<Pick<RecurringOccurrence, 'kind' | 'managedBy'>>,
  canEdit: boolean,
): boolean => canEdit && isLoanInstallment(o) && isUnresolved(o.status);

// ───────────────────────────── Montos ─────────────────────────────

/** Compara dos decimales no negativos de cualquier escala sin pasar por `number`. */
export function compareDecimal(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const x = BigInt(`${ai}${af.padEnd(scale, '0')}`);
  const y = BigInt(`${bi}${bf.padEnd(scale, '0')}`);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Moneda de una definición u ocurrencia a partir de su monto esperado (null para `VARIABLE`, que no lo lleva). */
export function currencyOfAmount(amount: RecurringAmount): string | undefined {
  return (amount.amount ?? amount.max ?? amount.min)?.currency;
}

/** Monto que suma en los totales (el máximo de un `MIN_MAX`); null para `VARIABLE`. */
export function projectedOf(amount: RecurringAmount): Money | null {
  return amount.type === 'MIN_MAX' ? (amount.max ?? null) : (amount.amount ?? null);
}

// ───────────────────────────── Fechas ─────────────────────────────

const parseDate = (value: string): LocalDate | null => {
  try {
    return LocalDate.parse(value);
  } catch {
    return null;
  }
};

/** `YYYY-MM-DD` ± `days` días (aritmética civil, sin zona). */
export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  return d ? d.plusDays(days).toString() : date;
}

const maxDate = (a: string, b: string): string => (a >= b ? a : b);
const minDate = (a: string, b: string): string => (a <= b ? a : b);

// ───────────────────────────── Formulario de definición ─────────────────────────────

export type EndMode = 'NONE' | 'DATE' | 'COUNT';

export interface DefinitionForm {
  readonly name: string;
  readonly description: string;
  readonly notes: string;
  readonly kind: OfferedKind;
  readonly accountId: string;
  readonly toAccountId: string;
  readonly categoryId: string;
  readonly counterpartyId: string;
  readonly tagIds: readonly string[];
  readonly paymentMethod: PaymentMethod | '';
  readonly amountType: RecurringAmountType;
  readonly amount: string;
  readonly min: string;
  readonly max: string;
  readonly cadence: RecurringCadence;
  readonly interval: string;
  /** Día del mes ('' = el de la fecha de inicio; '-1' = último día). */
  readonly monthDay: string;
  /** Segundo día (solo `SEMIMONTHLY`). */
  readonly monthDay2: string;
  readonly rrule: string;
  readonly weekendAdjustment: WeekendAdjustmentMode;
  readonly startDate: string;
  readonly endMode: EndMode;
  readonly endDate: string;
  readonly maxOccurrences: string;
  readonly mode: MaterializationMode;
  readonly autoCreateStatus: 'PENDING' | 'POSTED';
  readonly leadDays: string;
}

export function emptyForm(today: string): DefinitionForm {
  return {
    name: '',
    description: '',
    notes: '',
    kind: 'EXPENSE',
    accountId: '',
    toAccountId: '',
    categoryId: '',
    counterpartyId: '',
    tagIds: [],
    paymentMethod: '',
    amountType: 'FIXED',
    amount: '',
    min: '',
    max: '',
    cadence: 'MONTHLY',
    interval: '1',
    monthDay: '',
    monthDay2: '',
    rrule: '',
    weekendAdjustment: 'NONE',
    startDate: today,
    endMode: 'NONE',
    endDate: '',
    maxOccurrences: '',
    mode: 'PENDING_APPROVAL',
    autoCreateStatus: 'PENDING',
    leadDays: '3',
  };
}

/** Cadencias con un único día del mes opcional (familia mensual y anual). */
export const CADENCES_WITH_MONTH_DAY: readonly RecurringCadence[] = [
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
];

/** `AUTO_CREATE` necesita un monto conocido (`FIXED`/`ESTIMATED`). */
export const allowsAutoCreate = (type: RecurringAmountType): boolean =>
  type === 'FIXED' || type === 'ESTIMATED';

/** Estado del formulario a partir de una versión de la definición (edición / "esta y las siguientes"). */
export function formFromVersion(
  v: RecurringDefinitionVersion,
  meta: { name: string; description: string | null; notes: string | null; kind: OfferedKind },
): DefinitionForm {
  const s = v.schedule;
  const monthDays = s.monthDays.map(String);
  return {
    name: meta.name,
    description: meta.description ?? '',
    notes: meta.notes ?? '',
    kind: meta.kind,
    accountId: v.accountId,
    toAccountId: v.toAccountId ?? '',
    categoryId: v.categoryId ?? '',
    counterpartyId: v.counterpartyId ?? '',
    tagIds: [...v.tagIds],
    paymentMethod: v.paymentMethod ?? '',
    amountType: v.amount.type,
    amount: v.amount.amount?.amount ?? '',
    min: v.amount.min?.amount ?? '',
    max: v.amount.max?.amount ?? '',
    cadence: s.cadence,
    interval: String(s.interval),
    monthDay: monthDays[0] ?? '',
    monthDay2: monthDays[1] ?? '',
    rrule: s.rrule ?? '',
    weekendAdjustment: s.weekendAdjustment,
    startDate: s.startDate,
    endMode: s.endDate ? 'DATE' : s.maxOccurrences ? 'COUNT' : 'NONE',
    endDate: s.endDate ?? '',
    maxOccurrences: s.maxOccurrences ? String(s.maxOccurrences) : '',
    mode: v.materialization.mode,
    autoCreateStatus: v.materialization.autoCreateStatus ?? 'PENDING',
    leadDays: String(v.materialization.leadDays),
  };
}

// ── Regla y vista previa ──

const toRule = (form: DefinitionForm, dtstart: LocalDate): RecurrenceRule => {
  const until = form.endMode === 'DATE' && form.endDate ? LocalDate.parse(form.endDate) : null;
  const count = form.endMode === 'COUNT' ? Number(form.maxOccurrences) : null;
  if (form.cadence === 'CUSTOM') {
    const parsed = RRuleSubset.parse(form.rrule, dtstart);
    // La regla ya trae su propio fin (COUNT/UNTIL) o, si no, el del formulario.
    if (parsed.until !== null || parsed.count !== null || (until === null && count === null)) return parsed;
    return createRecurrenceRule({
      freq: parsed.freq,
      interval: parsed.interval,
      byMonthDay: parsed.byMonthDay,
      byWeekday: parsed.byWeekday,
      bySetPos: parsed.bySetPos,
      dtstart,
      until,
      count,
    });
  }
  const days =
    form.cadence === 'SEMIMONTHLY'
      ? [Number(form.monthDay), Number(form.monthDay2)]
      : CADENCES_WITH_MONTH_DAY.includes(form.cadence) && form.monthDay !== ''
        ? [Number(form.monthDay)]
        : [];
  return ruleFromCadence({
    cadence: form.cadence as Cadence,
    interval: Number(form.interval),
    dtstart,
    monthDays: days,
    until,
    count,
  });
};

export type ScheduleErrorCode = 'DATE' | 'RRULE' | 'SCHEDULE';

/** Regla del formulario con `dtstart` dado, o el código de error de calendario/RRULE (nunca lanza). */
export function ruleOfForm(
  form: DefinitionForm,
  dtstart: string,
): { ok: true; rule: RecurrenceRule } | { ok: false; code: ScheduleErrorCode } {
  const start = parseDate(dtstart);
  if (!start) return { ok: false, code: 'DATE' };
  try {
    return { ok: true, rule: toRule(form, start) };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { ok: false, code: code === 'INVALID_RRULE' ? 'RRULE' : 'SCHEDULE' };
  }
}

/**
 * Día de ancla 29–31 cuyo mes corto cae en su último día (FR-COMMITMENTS-005), o `null` si no aplica. Mensual: los días
 * 29–31 del ancla; anual: un día que no existe en el mes del ancla en un año común (29 de febrero…).
 */
export function endOfMonthDay(rule: RecurrenceRule): number | null {
  if (rule.freq === 'MONTHLY' && rule.byWeekday.length === 0) {
    const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [rule.dtstart.day];
    const long = days.filter((d) => d >= 29);
    return long.length > 0 ? Math.max(...long) : null;
  }
  if (rule.freq === 'YEARLY') {
    const day = rule.byMonthDay[0] ?? rule.dtstart.day;
    return day > LocalDate.daysInMonth(2025, rule.dtstart.month) ? day : null;
  }
  return null;
}

export interface PreviewDate {
  /** Fecha nominal (clave de la ocurrencia). */
  readonly nominal: string;
  /** Vencimiento con el ajuste de fin de semana aplicado. */
  readonly due: string;
  readonly adjusted: boolean;
  /** `true` si el mes no tiene el día de la ancla y cae en su último día. */
  readonly monthEnd: boolean;
}

export type Preview =
  | { readonly ok: true; readonly dates: readonly PreviewDate[]; readonly endOfMonthDay: number | null }
  | { readonly ok: false; readonly code: ScheduleErrorCode };

export const PREVIEW_COUNT = 6;

/**
 * Próximas 6 fechas con el ajuste de fin de semana (vista previa del formulario, calculada en el cliente con las mismas
 * reglas que la API). Parte de `from` o, por omisión, de la fecha de inicio o de hoy si esta es posterior.
 */
export function previewOf(
  form: DefinitionForm,
  opts: { today: string; dtstart?: string; from?: string },
): Preview {
  const dtstart = opts.dtstart ?? form.startDate;
  const built = ruleOfForm(form, dtstart);
  if (!built.ok) return built;
  const from = opts.from ?? maxDate(dtstart, opts.today);
  const fromDate = parseDate(from);
  if (!fromDate) return { ok: false, code: 'DATE' };
  const dates = nextRecurrenceDates(built.rule, fromDate, PREVIEW_COUNT);
  const anchor = endOfMonthDay(built.rule);
  const items = dates.map((d) => {
    const due = WeekendAdjustment.apply(d, form.weekendAdjustment);
    const monthEnd =
      anchor !== null &&
      built.rule.freq === 'MONTHLY' &&
      d.day < anchor &&
      d.day === LocalDate.daysInMonth(d.year, d.month);
    return { nominal: d.toString(), due: due.toString(), adjusted: !due.equals(d), monthEnd };
  });
  return { ok: true, dates: items, endOfMonthDay: anchor };
}

// ── Validación y cuerpo de la API ──

export type FormErrorCode =
  | 'REQUIRED'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_SCALE'
  | 'AMOUNT_NOT_POSITIVE'
  | 'RANGE'
  | 'INTERVAL'
  | 'DAYS'
  | 'RRULE'
  | 'SCHEDULE'
  | 'DATE'
  | 'END_BEFORE_START'
  | 'COUNT'
  | 'LEAD_DAYS'
  | 'AUTO_AMOUNT'
  | 'SAME_ACCOUNT'
  | 'CURRENCY'
  | 'NO_CHANGES';

export type FormErrors = Partial<Record<string, FormErrorCode>>;

export interface FormEnv {
  /** Locale de formato del workspace (separadores decimales). */
  readonly locale: string;
  /** Moneda y escala de la cuenta origen (undefined mientras no hay cuenta). */
  readonly currency: string | undefined;
  readonly scale: number;
  /** Moneda de la cuenta destino de una transferencia. */
  readonly toCurrency?: string | undefined;
}

const AMOUNT_ERRORS = {
  EMPTY: 'REQUIRED',
  INVALID: 'AMOUNT_INVALID',
  SCALE: 'AMOUNT_SCALE',
  NOT_POSITIVE: 'AMOUNT_NOT_POSITIVE',
} as const;

function parseMoney(
  raw: string,
  env: Pick<FormEnv, 'locale' | 'currency' | 'scale'>,
): { ok: true; money: Money } | { ok: false; error: FormErrorCode } {
  if (!env.currency) return { ok: false, error: raw.trim() === '' ? 'REQUIRED' : 'AMOUNT_INVALID' };
  const r = parseAmount(raw, { locale: env.locale, currency: env.currency, scale: env.scale });
  return r.ok
    ? { ok: true, money: { amount: r.value, currency: env.currency } }
    : { ok: false, error: AMOUNT_ERRORS[r.error] };
}

/** Monto esperado de la definición según el tipo, o los errores de sus campos. */
export function amountOfForm(
  form: DefinitionForm,
  env: FormEnv,
): { ok: true; amount: RecurringAmount } | { ok: false; errors: FormErrors } {
  switch (form.amountType) {
    case 'VARIABLE':
      return { ok: true, amount: { type: 'VARIABLE' } };
    case 'MIN_MAX': {
      const min = parseMoney(form.min, env);
      const max = parseMoney(form.max, env);
      const errors: FormErrors = {};
      if (!min.ok) errors['min'] = min.error;
      if (!max.ok) errors['max'] = max.error;
      if (min.ok && max.ok && compareDecimal(min.money.amount, max.money.amount) > 0) errors['max'] = 'RANGE';
      return min.ok && max.ok && !errors['max']
        ? { ok: true, amount: { type: 'MIN_MAX', min: min.money, max: max.money } }
        : { ok: false, errors };
    }
    default: {
      const one = parseMoney(form.amount, env);
      return one.ok
        ? { ok: true, amount: { type: form.amountType, amount: one.money } }
        : { ok: false, errors: { amount: one.error } };
    }
  }
}

function validate(form: DefinitionForm, env: FormEnv, creating: boolean): FormErrors {
  const errors: FormErrors = {};
  if (creating) {
    if (form.name.trim() === '') errors['name'] = 'REQUIRED';
    if (!form.accountId) errors['accountId'] = 'REQUIRED';
    if (form.kind === 'TRANSFER') {
      if (!form.toAccountId) errors['toAccountId'] = 'REQUIRED';
      else if (form.toAccountId === form.accountId) errors['toAccountId'] = 'SAME_ACCOUNT';
      else if (env.currency && env.toCurrency && env.currency !== env.toCurrency)
        errors['toAccountId'] = 'CURRENCY';
    }
  }
  const amount = amountOfForm(form, env);
  if (!amount.ok) Object.assign(errors, amount.errors);

  const interval = Number(form.interval);
  if (form.cadence !== 'CUSTOM' && !(Number.isInteger(interval) && interval >= 1 && interval <= 120))
    errors['interval'] = 'INTERVAL';
  if (form.cadence === 'SEMIMONTHLY') {
    const a = Number(form.monthDay);
    const b = Number(form.monthDay2);
    if (form.monthDay === '' || form.monthDay2 === '' || a === b) errors['monthDay'] = 'DAYS';
  }
  if (!parseDate(form.startDate)) errors['startDate'] = 'DATE';
  if (form.endMode === 'DATE') {
    if (!parseDate(form.endDate)) errors['endDate'] = 'DATE';
    else if (form.endDate < form.startDate) errors['endDate'] = 'END_BEFORE_START';
  }
  if (form.endMode === 'COUNT') {
    const n = Number(form.maxOccurrences);
    if (!(Number.isInteger(n) && n >= 1 && n <= 1000)) errors['maxOccurrences'] = 'COUNT';
  }
  const lead = Number(form.leadDays);
  if (!(Number.isInteger(lead) && lead >= 0 && lead <= 60)) errors['leadDays'] = 'LEAD_DAYS';
  if (form.mode === 'AUTO_CREATE' && !allowsAutoCreate(form.amountType)) errors['mode'] = 'AUTO_AMOUNT';

  if (
    !errors['startDate'] &&
    !errors['interval'] &&
    !errors['monthDay'] &&
    !errors['endDate'] &&
    !errors['maxOccurrences']
  ) {
    if (form.cadence === 'CUSTOM' && form.rrule.trim() === '') errors['rrule'] = 'REQUIRED';
    else {
      const rule = ruleOfForm(form, form.startDate);
      if (!rule.ok)
        errors[rule.code === 'RRULE' ? 'rrule' : 'schedule'] = rule.code === 'DATE' ? 'DATE' : rule.code;
    }
  }
  return errors;
}

const monthDaysOf = (form: DefinitionForm): number[] =>
  form.cadence === 'SEMIMONTHLY'
    ? [Number(form.monthDay), Number(form.monthDay2)]
    : CADENCES_WITH_MONTH_DAY.includes(form.cadence) && form.monthDay !== ''
      ? [Number(form.monthDay)]
      : [];

const templateMaterialization = (form: DefinitionForm) => ({
  mode: form.mode,
  ...(form.mode === 'AUTO_CREATE' ? { autoCreateStatus: form.autoCreateStatus } : {}),
  leadDays: Number(form.leadDays),
});

export type BuildResult<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly errors: FormErrors };

/** Cuerpo de `POST /recurring` (`RecurringDefinitionInput`). */
export function buildCreateBody(form: DefinitionForm, env: FormEnv): BuildResult<Record<string, unknown>> {
  const errors = validate(form, env, true);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const amount = amountOfForm(form, env);
  if (!amount.ok) return { ok: false, errors: amount.errors };
  const transfer = form.kind === 'TRANSFER';
  const schedule = {
    cadence: form.cadence,
    ...(form.cadence === 'CUSTOM' ? { rrule: form.rrule.trim() } : { interval: Number(form.interval) }),
    ...(monthDaysOf(form).length > 0 ? { monthDays: monthDaysOf(form) } : {}),
    startDate: form.startDate,
    ...(form.endMode === 'DATE' ? { endDate: form.endDate } : {}),
    ...(form.endMode === 'COUNT' ? { maxOccurrences: Number(form.maxOccurrences) } : {}),
    weekendAdjustment: form.weekendAdjustment,
  };
  const template = {
    accountId: form.accountId,
    ...(transfer ? { toAccountId: form.toAccountId } : {}),
    amount: amount.amount,
    ...(!transfer && form.categoryId ? { categoryId: form.categoryId } : {}),
    ...(!transfer && form.counterpartyId ? { counterpartyId: form.counterpartyId } : {}),
    tagIds: [...form.tagIds],
    ...(form.paymentMethod ? { paymentMethod: form.paymentMethod } : {}),
    schedule,
    materialization: templateMaterialization(form),
  };
  return {
    ok: true,
    body: {
      name: form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      kind: form.kind,
      template,
    },
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Cuerpo de `POST /recurring/{id}/revisions` ("Cambiar esta y las siguientes"): solo lo que cambió respecto de la versión
 * vigente (los campos omitidos conservan su valor). Sin cambios ⇒ `NO_CHANGES`.
 */
export function buildRevisionBody(
  base: DefinitionForm,
  form: DefinitionForm,
  effectiveFrom: string,
  env: FormEnv,
): BuildResult<Record<string, unknown>> {
  const errors = validate(form, env, false);
  if (!parseDate(effectiveFrom)) errors['effectiveFrom'] = 'DATE';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const changes: Record<string, unknown> = {};
  if (form.accountId !== base.accountId) changes['accountId'] = form.accountId;
  if (form.kind === 'TRANSFER' && form.toAccountId !== base.toAccountId)
    changes['toAccountId'] = form.toAccountId;
  if (
    form.amountType !== base.amountType ||
    form.amount !== base.amount ||
    form.min !== base.min ||
    form.max !== base.max ||
    form.accountId !== base.accountId
  ) {
    const amount = amountOfForm(form, env);
    if (amount.ok) changes['amount'] = amount.amount;
  }
  if (form.kind !== 'TRANSFER') {
    if (form.categoryId !== base.categoryId) changes['categoryId'] = form.categoryId || null;
    if (form.counterpartyId !== base.counterpartyId) changes['counterpartyId'] = form.counterpartyId || null;
  }
  if (!sameSet(form.tagIds, base.tagIds)) changes['tagIds'] = [...form.tagIds];
  if (form.paymentMethod !== base.paymentMethod) changes['paymentMethod'] = form.paymentMethod || null;

  const schedule: Record<string, unknown> = {};
  if (
    form.cadence !== base.cadence ||
    form.interval !== base.interval ||
    form.monthDay !== base.monthDay ||
    form.monthDay2 !== base.monthDay2 ||
    form.rrule !== base.rrule
  ) {
    schedule['cadence'] = form.cadence;
    schedule['monthDays'] = monthDaysOf(form);
    if (form.cadence === 'CUSTOM') schedule['rrule'] = form.rrule.trim();
    else {
      schedule['rrule'] = null;
      schedule['interval'] = Number(form.interval);
    }
  }
  if (form.weekendAdjustment !== base.weekendAdjustment)
    schedule['weekendAdjustment'] = form.weekendAdjustment;
  if (
    form.endMode !== base.endMode ||
    form.endDate !== base.endDate ||
    form.maxOccurrences !== base.maxOccurrences
  ) {
    schedule['endDate'] = form.endMode === 'DATE' ? form.endDate : null;
    schedule['maxOccurrences'] = form.endMode === 'COUNT' ? Number(form.maxOccurrences) : null;
  }
  if (Object.keys(schedule).length > 0) changes['schedule'] = schedule;

  if (
    form.mode !== base.mode ||
    form.autoCreateStatus !== base.autoCreateStatus ||
    form.leadDays !== base.leadDays
  )
    changes['materialization'] = {
      mode: form.mode,
      autoCreateStatus: form.mode === 'AUTO_CREATE' ? form.autoCreateStatus : null,
      leadDays: Number(form.leadDays),
    };

  if (Object.keys(changes).length === 0) return { ok: false, errors: { form: 'NO_CHANGES' } };
  return { ok: true, body: { effectiveFrom, changes } };
}

// ───────────────────────────── Acciones por ocurrencia ─────────────────────────────

export interface MaterializeForm {
  readonly amount: string;
  readonly date: string;
  readonly status: 'POSTED' | 'PENDING';
}

/** Valores iniciales de "Aprobar": sin monto (se usa el esperado), fecha = min(vencimiento, hoy), estado Posteada. */
export const materializeDefaults = (
  occurrence: Pick<RecurringOccurrence, 'dueDate'>,
  today: string,
): MaterializeForm => ({
  amount: '',
  date: minDate(occurrence.dueDate, today),
  status: 'POSTED',
});

/**
 * Cuerpo de `POST …/materialize`. `VARIABLE` exige el monto; `MIN_MAX` lo acota al rango; `FIXED`/`ESTIMATED` lo aceptan
 * opcional (el usuario confirma lo que pagó, design decisión 11). Sin monto el servidor usa el esperado.
 */
export function buildMaterializeBody(
  occurrence: Pick<RecurringOccurrence, 'expected'>,
  form: MaterializeForm,
  env: Pick<FormEnv, 'locale' | 'scale'> & { readonly currency?: string | undefined },
): BuildResult<Record<string, unknown>> {
  const errors: FormErrors = {};
  const currency = env.currency ?? currencyOfAmount(occurrence.expected);
  const body: Record<string, unknown> = { status: form.status };
  if (form.amount.trim() === '') {
    if (occurrence.expected.type === 'VARIABLE') errors['amount'] = 'REQUIRED';
  } else {
    const parsed = parseMoney(form.amount, {
      locale: env.locale,
      currency: currency ?? 'BOB',
      scale: env.scale,
    });
    if (!parsed.ok) errors['amount'] = parsed.error;
    else {
      const { min, max } = occurrence.expected;
      if (
        occurrence.expected.type === 'MIN_MAX' &&
        min &&
        max &&
        (compareDecimal(parsed.money.amount, min.amount) < 0 ||
          compareDecimal(parsed.money.amount, max.amount) > 0)
      )
        errors['amount'] = 'RANGE';
      else body['amount'] = parsed.money;
    }
  }
  if (!parseDate(form.date)) errors['date'] = 'DATE';
  else body['businessDate'] = form.date;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, body };
}

export interface EditOccurrenceForm {
  readonly amount: string;
  readonly min: string;
  readonly max: string;
  readonly dueDate: string;
}

export function editDefaults(
  occurrence: Pick<RecurringOccurrence, 'expected' | 'dueDate'>,
): EditOccurrenceForm {
  const e = occurrence.expected;
  return {
    amount: e.amount?.amount ?? '',
    min: e.min?.amount ?? '',
    max: e.max?.amount ?? '',
    dueDate: occurrence.dueDate,
  };
}

/** Cuerpo (merge-patch) de `PATCH …/occurrences/{id}`: solo lo que cambió. Sin cambios ⇒ `NO_CHANGES`. */
export function buildEditBody(
  occurrence: Pick<RecurringOccurrence, 'expected' | 'dueDate'>,
  form: EditOccurrenceForm,
  env: Pick<FormEnv, 'locale' | 'scale'> & { readonly currency?: string | undefined },
): BuildResult<Record<string, unknown>> {
  const errors: FormErrors = {};
  const body: Record<string, unknown> = {};
  const base = editDefaults(occurrence);
  const currency = env.currency ?? currencyOfAmount(occurrence.expected) ?? 'BOB';
  const money = (raw: string, field: string): string | undefined => {
    const r = parseMoney(raw, { locale: env.locale, currency, scale: env.scale });
    if (!r.ok) {
      errors[field] = r.error;
      return undefined;
    }
    return r.money.amount;
  };
  if (occurrence.expected.type === 'MIN_MAX') {
    const min = money(form.min, 'min');
    const max = money(form.max, 'max');
    if (min && max && compareDecimal(min, max) > 0) errors['max'] = 'RANGE';
    if (!errors['min'] && !errors['max']) {
      if (min !== undefined && compareDecimal(min, base.min || '0') !== 0)
        body['expectedMin'] = { amount: min, currency };
      if (max !== undefined && compareDecimal(max, base.max || '0') !== 0)
        body['expectedMax'] = { amount: max, currency };
    }
  } else if (form.amount.trim() !== '' || occurrence.expected.type !== 'VARIABLE') {
    const amount = money(form.amount, 'amount');
    if (amount !== undefined && (base.amount === '' || compareDecimal(amount, base.amount) !== 0))
      body['expectedAmount'] = { amount, currency };
  }
  if (!parseDate(form.dueDate)) errors['dueDate'] = 'DATE';
  else if (form.dueDate !== base.dueDate) body['dueDate'] = form.dueDate;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return Object.keys(body).length === 0 ? { ok: false, errors: { form: 'NO_CHANGES' } } : { ok: true, body };
}

/** Margen (días) de la búsqueda de transacciones al vincular. */
export const LINK_WINDOW_DAYS = 15;

/** Consulta de `GET /transactions` para vincular: la cuenta, el tipo y ±15 días del vencimiento. */
export function linkSearchQuery(
  occurrence: Pick<RecurringOccurrence, 'accountId' | 'kind' | 'dueDate'>,
  text = '',
): URLSearchParams {
  const q = new URLSearchParams();
  q.append('accountId', occurrence.accountId);
  q.append('kind', occurrence.kind);
  q.set('dateFrom', addDays(occurrence.dueDate, -LINK_WINDOW_DAYS));
  q.set('dateTo', addDays(occurrence.dueDate, LINK_WINDOW_DAYS));
  if (text.trim()) q.set('q', text.trim());
  q.set('limit', '50');
  return q;
}

/**
 * Candidatas a vincular: mismo tipo, no anuladas y, en una transferencia, con la misma cuenta destino
 * (la API aplica la misma regla estricta y responde `OCCURRENCE_LINK_MISMATCH` con los motivos).
 */
export function linkCandidates(
  occurrence: Pick<RecurringOccurrence, 'kind' | 'toAccountId'>,
  transactions: readonly Transaction[],
): Transaction[] {
  return transactions.filter(
    (tx) =>
      tx.kind === occurrence.kind &&
      tx.status !== 'VOIDED' &&
      (occurrence.kind !== 'TRANSFER' ||
        occurrence.toAccountId === null ||
        tx.legs.some((l) => l.accountId === occurrence.toAccountId)),
  );
}

/** Motivos (`ACCOUNT`, `KIND`, `CURRENCY`, `VOIDED`) de un `OCCURRENCE_LINK_MISMATCH` (`details.reasons`). */
export function linkMismatchReasons(problem: { readonly [key: string]: unknown } | undefined): string[] {
  const details = problem?.['details'];
  const reasons =
    details && typeof details === 'object' ? (details as { reasons?: unknown }).reasons : undefined;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === 'string') : [];
}

// ───────────────────────────── Consultas y contador ─────────────────────────────

export const UPCOMING_DAYS = [7, 30, 60, 90] as const;
export type UpcomingDays = (typeof UPCOMING_DAYS)[number];
export const DEFAULT_UPCOMING_DAYS: UpcomingDays = 30;
export const LIST_LIMIT = 100;

export const upcomingQuery = (days: UpcomingDays): string => `days=${days}&limit=${LIST_LIMIT}`;
export const trayQuery = (): string => `requiresApproval=true&limit=${LIST_LIMIT}`;

export function definitionsQuery(filters: { status: string; kind: string }): string {
  const q = new URLSearchParams({ limit: '200' });
  if (filters.status) q.set('status', filters.status);
  if (filters.kind) q.set('kind', filters.kind);
  return q.toString();
}

/** Evento de ventana: una acción cambió ocurrencias o definiciones (el contador de la sidebar se vuelve a consultar). */
export const RECURRING_CHANGED = 'pfos:recurring-changed';

export function notifyRecurringChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECURRING_CHANGED));
}

/** Tope visual del contador de la sidebar. */
export function approvalBadge(count: number, hasMore: boolean): string {
  return count > 99 || hasMore ? '99+' : String(count);
}

/** Ruta (sin locale) de un renglón del desglose del comprometido: ocurrencia o gasto pendiente. */
export function committedItemPath(item: Pick<CommittedItem, 'source' | 'id'>): string {
  return item.source === 'OCCURRENCE'
    ? `/recurring/occurrences/${encodeURIComponent(item.id)}`
    : `/transacciones/${encodeURIComponent(item.id)}`;
}

export const definitionPath = (id: string): string => `/recurring/${encodeURIComponent(id)}`;
export const occurrencePath = (id: string): string => `/recurring/occurrences/${encodeURIComponent(id)}`;

/** Cantidad de ocurrencias de la bandeja para el contador a partir de una página de la API. */
export function trayCountOf(page: { data: readonly unknown[]; page: { hasMore: boolean } }): {
  count: number;
  hasMore: boolean;
} {
  return { count: page.data.length, hasMore: page.page.hasMore };
}
