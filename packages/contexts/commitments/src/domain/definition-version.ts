import {
  CADENCES,
  DomainError,
  LocalDate,
  Money,
  RRuleSubset,
  WEEKEND_ADJUSTMENTS,
  createRecurrenceRule,
  currency as makeCurrency,
  ruleFromCadence,
  type Cadence,
  type RecurrenceRule,
  type WeekendAdjustmentMode,
} from '@pf/shared-kernel';
import { buildAmountSpec, type AmountSpec, type AmountSpecInput } from './amount-spec.js';
import {
  AUTO_CREATE_STATUSES,
  MATERIALIZATION_MODES,
  MAX_LEAD_DAYS,
  PAYMENT_METHODS,
  RECURRING_KINDS,
  RESERVED_RECURRING_KINDS,
  LOAN_PAYMENT_KIND,
  type AutoCreateStatus,
  type ManagedBy,
  type MaterializationMode,
  type PaymentMethod,
  type RecurringKind,
} from './types.js';

/** Cadencia persistida: las 9 predefinidas, `CUSTOM` (RRULE) o `EXPLICIT` (calendario de ítems, solo administradas). */
export type ScheduleCadence = Cadence | 'CUSTOM' | 'EXPLICIT';

/** Máximo de ítems de un calendario explícito (un préstamo a 30 años mensual son 360 cuotas). */
export const MAX_EXPLICIT_ITEMS = 1000;

/**
 * Ítem de un calendario explícito (openspec add-loans, N3): `key` única en la definición (en préstamos, el número de
 * cuota), fecha de vencimiento (única) y monto esperado del ítem.
 */
export interface ExplicitScheduleItem {
  readonly key: string;
  readonly dueDate: string;
  readonly amount: string;
}

export interface ScheduleSpec {
  readonly cadence: ScheduleCadence;
  /** Solo `EXPLICIT`: ítems ordenados por fecha; en ese caso no hay regla (`rrule`, `monthDays`, fin ni máximo). */
  readonly explicit?: readonly ExplicitScheduleItem[] | null;
  readonly interval: number;
  /** Días del mes de la cadencia (semimensual: dos; mensual y derivadas: a lo sumo uno). */
  readonly monthDays: readonly number[];
  /** RRULE normalizada sin `COUNT` ni `UNTIL` (solo `CUSTOM`). */
  readonly rrule: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly maxOccurrences: number | null;
  readonly weekendAdjustment: WeekendAdjustmentMode;
}

export interface ScheduleInput {
  readonly cadence: string;
  readonly interval?: number | undefined;
  readonly monthDays?: readonly number[] | undefined;
  readonly rrule?: string | null | undefined;
  readonly startDate: string;
  readonly endDate?: string | null | undefined;
  readonly maxOccurrences?: number | null | undefined;
  readonly weekendAdjustment?: string | undefined;
  /** Solo con la cadencia `EXPLICIT` (definiciones administradas). */
  readonly explicit?: readonly ExplicitScheduleItem[] | null | undefined;
}

export interface MaterializationSpec {
  readonly mode: MaterializationMode;
  readonly autoCreateStatus: AutoCreateStatus | null;
  readonly leadDays: number;
}

export interface MaterializationInput {
  readonly mode?: string | undefined;
  readonly autoCreateStatus?: string | null | undefined;
  readonly leadDays?: number | undefined;
}

/**
 * Precio indexado (openspec add-subscriptions, N3): el monto de la definición se expresa en OTRA moneda que la de la
 * cuenta (USD cobrado en una tarjeta en BOB). Cada ocurrencia estima `precio × tasa de valoración vigente al
 * generarla`, HALF_EVEN a la escala de la cuenta; sin tasa queda sin monto (`VARIABLE`), nunca 1:1.
 */
export interface IndexedPrice {
  readonly amount: string;
  readonly currency: string;
}

/** Plantilla inmutable de una versión de la definición (tabla `recurring_definition_version`, append-only). */
export interface DefinitionVersion {
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly currency: string;
  readonly amount: AmountSpec;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly paymentMethod: PaymentMethod | null;
  readonly schedule: ScheduleSpec;
  readonly materialization: MaterializationSpec;
  /** Solo definiciones administradas con el precio en otra moneda; `amount` es entonces `VARIABLE`. */
  readonly indexedPrice?: IndexedPrice | null;
}

export interface TemplateInput {
  readonly accountId: string;
  readonly toAccountId?: string | null | undefined;
  readonly amount: AmountSpecInput;
  readonly categoryId?: string | null | undefined;
  readonly counterpartyId?: string | null | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly paymentMethod?: string | null | undefined;
  readonly schedule: ScheduleInput;
  readonly materialization?: MaterializationInput | undefined;
  /** Precio en otra moneda que la cuenta (ya validado y a la escala de su moneda por el llamador). */
  readonly indexedPrice?: IndexedPrice | null | undefined;
}

const schedule422 = (message: string, pointer?: string) => {
  const err = new DomainError('RECURRING_INVALID_SCHEDULE', message);
  return pointer ? err.at(pointer) : err;
};

/**
 * Valida el tipo de definición: los reservados de Phase 4 se rechazan con 422 (D116). Excepción (openspec add-loans,
 * N2): `LOAN_PAYMENT` se admite SOLO para definiciones administradas por `DEBT`.
 */
export function assertKindAvailable(kind: string, managedBy?: ManagedBy): RecurringKind {
  if (kind === LOAN_PAYMENT_KIND && managedBy === 'DEBT') return kind;
  if ((RESERVED_RECURRING_KINDS as readonly string[]).includes(kind)) {
    throw new DomainError('RECURRING_KIND_NOT_AVAILABLE', `kind ${kind} is reserved for a later phase`).at(
      '/kind',
    );
  }
  if (!(RECURRING_KINDS as readonly string[]).includes(kind)) {
    throw new DomainError('VALIDATION_FAILED', `unknown kind ${kind}`).at('/kind');
  }
  return kind as RecurringKind;
}

function parseDate(value: string, pointer: string): LocalDate {
  try {
    return LocalDate.parse(value);
  } catch {
    throw schedule422('date must be YYYY-MM-DD', pointer);
  }
}

/** Regla de recurrencia de una programación (cadencia predefinida o RRULE + fin/COUNT). */
export function ruleOfSchedule(schedule: ScheduleSpec): RecurrenceRule {
  if (schedule.cadence === 'EXPLICIT') {
    throw new Error('an explicit schedule has no recurrence rule');
  }
  const dtstart = LocalDate.parse(schedule.startDate);
  const until = schedule.endDate ? LocalDate.parse(schedule.endDate) : null;
  if (schedule.cadence === 'CUSTOM') {
    const base = RRuleSubset.parse(schedule.rrule ?? '', dtstart);
    return createRecurrenceRule({ ...base, until, count: schedule.maxOccurrences });
  }
  return ruleFromCadence({
    cadence: schedule.cadence,
    interval: schedule.interval,
    dtstart,
    monthDays: schedule.monthDays,
    until,
    count: schedule.maxOccurrences,
  });
}

/** Ítems de un calendario explícito (vacío si la programación es una regla). */
export const explicitItemsOf = (schedule: ScheduleSpec): readonly ExplicitScheduleItem[] =>
  schedule.cadence === 'EXPLICIT' ? (schedule.explicit ?? []) : [];

/** Calendario explícito: claves y fechas únicas, ordenado por fecha; sin regla ni fin (`RECURRING_INVALID_SCHEDULE`). */
function buildExplicitSchedule(input: ScheduleInput): ScheduleSpec {
  const items = input.explicit ?? [];
  if (items.length < 1 || items.length > MAX_EXPLICIT_ITEMS) {
    throw schedule422(`an explicit schedule needs 1..${MAX_EXPLICIT_ITEMS} items`, '/schedule/explicit');
  }
  if (input.rrule || input.endDate || input.maxOccurrences || (input.monthDays?.length ?? 0) > 0) {
    throw schedule422('an explicit schedule takes no recurrence rule or end', '/schedule');
  }
  const keys = new Set<string>();
  const dates = new Set<string>();
  const out: ExplicitScheduleItem[] = [];
  items.forEach((item, i) => {
    const pointer = `/schedule/explicit/${i}`;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (key.length < 1 || key.length > 40) {
      throw schedule422('key must have between 1 and 40 characters', `${pointer}/key`);
    }
    if (keys.has(key)) throw schedule422(`duplicated key ${key}`, `${pointer}/key`);
    keys.add(key);
    const dueDate = parseDate(item.dueDate, `${pointer}/dueDate`).toString();
    if (dates.has(dueDate)) throw schedule422(`duplicated due date ${dueDate}`, `${pointer}/dueDate`);
    dates.add(dueDate);
    out.push({ key, dueDate, amount: item.amount });
  });
  out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return {
    cadence: 'EXPLICIT',
    explicit: out,
    interval: 1,
    monthDays: [],
    rrule: null,
    startDate: (out[0] as ExplicitScheduleItem).dueDate,
    endDate: null,
    maxOccurrences: null,
    weekendAdjustment: 'NONE',
  };
}

/**
 * Valida y normaliza la programación (`RECURRING_INVALID_SCHEDULE`, `INVALID_RRULE`). La cadencia `EXPLICIT` solo se
 * admite con `allowExplicit` (definiciones administradas por otro contexto, openspec add-loans N3).
 */
export function buildSchedule(input: ScheduleInput, allowExplicit = false): ScheduleSpec {
  if (input.cadence === 'EXPLICIT') {
    if (!allowExplicit) {
      throw schedule422('the EXPLICIT cadence is reserved for managed definitions', '/schedule/cadence');
    }
    return buildExplicitSchedule(input);
  }
  if (input.explicit) throw schedule422('explicit items need the EXPLICIT cadence', '/schedule/explicit');
  const startDate = parseDate(input.startDate, '/schedule/startDate').toString();
  let endDate = input.endDate ? parseDate(input.endDate, '/schedule/endDate').toString() : null;
  let maxOccurrences = input.maxOccurrences ?? null;
  const weekendAdjustment = input.weekendAdjustment ?? 'NONE';
  if (!(WEEKEND_ADJUSTMENTS as readonly string[]).includes(weekendAdjustment)) {
    throw schedule422(`unknown weekend adjustment ${weekendAdjustment}`, '/schedule/weekendAdjustment');
  }
  if (endDate !== null && maxOccurrences !== null) {
    throw schedule422('endDate and maxOccurrences are mutually exclusive', '/schedule/maxOccurrences');
  }
  const cadence = input.cadence;
  if (cadence === 'CUSTOM') {
    if (!input.rrule)
      throw new DomainError('INVALID_RRULE', 'CUSTOM cadence needs an rrule').at('/schedule/rrule');
    const parsed = RRuleSubset.parse(input.rrule, LocalDate.parse(startDate));
    if ((parsed.until !== null || parsed.count !== null) && (endDate !== null || maxOccurrences !== null)) {
      throw schedule422('the RRULE already bounds the series', '/schedule/endDate');
    }
    endDate ??= parsed.until ? parsed.until.toString() : null;
    maxOccurrences ??= parsed.count;
    const bare = createRecurrenceRule({ ...parsed, until: null, count: null }, 'INVALID_RRULE');
    const schedule: ScheduleSpec = {
      cadence: 'CUSTOM',
      interval: parsed.interval,
      monthDays: [],
      rrule: RRuleSubset.format(bare),
      startDate,
      endDate,
      maxOccurrences,
      weekendAdjustment: weekendAdjustment as WeekendAdjustmentMode,
    };
    ruleOfSchedule(schedule);
    return schedule;
  }
  if (!(CADENCES as readonly string[]).includes(cadence)) {
    throw schedule422(`unknown cadence ${cadence}`, '/schedule/cadence');
  }
  if (input.rrule) throw schedule422('rrule is only valid with the CUSTOM cadence', '/schedule/rrule');
  const schedule: ScheduleSpec = {
    cadence: cadence as Cadence,
    interval: input.interval ?? 1,
    monthDays: [...(input.monthDays ?? [])],
    rrule: null,
    startDate,
    endDate,
    maxOccurrences,
    weekendAdjustment: weekendAdjustment as WeekendAdjustmentMode,
  };
  try {
    ruleOfSchedule(schedule);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'RECURRING_INVALID_SCHEDULE') throw err.at('/schedule');
    throw err;
  }
  return schedule;
}

/** Modo de materialización: `AUTO_CREATE` solo con montos `FIXED`/`ESTIMATED` (`RECURRING_MODE_NOT_ALLOWED`). */
export function buildMaterialization(
  input: MaterializationInput | undefined,
  amount: AmountSpec,
  indexed = false,
): MaterializationSpec {
  const mode = input?.mode ?? 'PENDING_APPROVAL';
  if (!(MATERIALIZATION_MODES as readonly string[]).includes(mode)) {
    throw new DomainError('VALIDATION_FAILED', `unknown materialization mode ${mode}`).at(
      '/materialization/mode',
    );
  }
  const leadDays = input?.leadDays ?? 3;
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_LEAD_DAYS) {
    throw new DomainError('VALIDATION_FAILED', `leadDays must be 0..${MAX_LEAD_DAYS}`).at(
      '/materialization/leadDays',
    );
  }
  if (mode === 'AUTO_CREATE') {
    // Un precio indexado se estima al generar cada ocurrencia: sin tasa queda sin monto y el intento reintenta.
    if ((amount.type === 'VARIABLE' && !indexed) || amount.type === 'MIN_MAX') {
      throw new DomainError(
        'RECURRING_MODE_NOT_ALLOWED',
        `AUTO_CREATE needs a FIXED or ESTIMATED amount, got ${amount.type}`,
      ).at('/materialization/mode');
    }
    const status = input?.autoCreateStatus ?? 'PENDING';
    if (!(AUTO_CREATE_STATUSES as readonly string[]).includes(status)) {
      throw new DomainError('VALIDATION_FAILED', `unknown autoCreateStatus ${status}`).at(
        '/materialization/autoCreateStatus',
      );
    }
    return { mode, autoCreateStatus: status as AutoCreateStatus, leadDays };
  }
  if (input?.autoCreateStatus) {
    throw new DomainError('VALIDATION_FAILED', 'autoCreateStatus only applies to AUTO_CREATE').at(
      '/materialization/autoCreateStatus',
    );
  }
  return { mode: mode as MaterializationMode, autoCreateStatus: null, leadDays };
}

/**
 * Construye una versión completa y consistente. `currency` es la de la cuenta origen (resuelta por la aplicación con el
 * catálogo de ACCOUNTS/FX, que da su escala canónica).
 */
export function buildDefinitionVersion(input: {
  readonly kind: RecurringKind;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly currency: { readonly code: string; readonly scale: number };
  readonly template: TemplateInput;
  /** Definición administrada por otro contexto: admite el calendario explícito. */
  readonly allowExplicit?: boolean;
}): DefinitionVersion {
  const { kind, template } = input;
  const currency = makeCurrency(input.currency.code, input.currency.scale);
  if (kind === 'TRANSFER') {
    if (!template.toAccountId) {
      throw new DomainError('VALIDATION_FAILED', 'a TRANSFER needs a destination account').at('/toAccountId');
    }
    if (template.toAccountId === template.accountId) {
      throw new DomainError('TRANSFER_SAME_ACCOUNT', 'source and destination accounts must differ').at(
        '/toAccountId',
      );
    }
    if (template.categoryId) {
      throw new DomainError('VALIDATION_FAILED', 'a TRANSFER has no category').at('/categoryId');
    }
  } else if (template.toAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'only a TRANSFER has a destination account').at(
      '/toAccountId',
    );
  }
  const paymentMethod = template.paymentMethod ?? null;
  if (paymentMethod !== null && !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw new DomainError('VALIDATION_FAILED', `unknown payment method ${paymentMethod}`).at(
      '/paymentMethod',
    );
  }
  const indexedPrice = template.indexedPrice ?? null;
  if (indexedPrice !== null) {
    if (indexedPrice.currency === currency.code) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'an indexed price must be in another currency than the account',
      ).at('/amount/indexedTo/currency');
    }
    if (kind !== 'EXPENSE') {
      throw new DomainError('VALIDATION_FAILED', 'only an EXPENSE can have an indexed price').at('/amount');
    }
  }
  const amount = buildAmountSpec(template.amount, currency);
  if (indexedPrice !== null && amount.type !== 'VARIABLE') {
    throw new DomainError('VALIDATION_FAILED', 'an indexed definition has no fixed amount').at('/amount');
  }
  const schedule = buildSchedule(template.schedule, input.allowExplicit ?? false);
  const explicit = schedule.cadence === 'EXPLICIT';
  if (kind === LOAN_PAYMENT_KIND && !explicit) {
    throw schedule422('a LOAN_PAYMENT needs an explicit schedule', '/schedule/cadence');
  }
  if (explicit) {
    if (amount.type !== 'VARIABLE' || indexedPrice !== null) {
      throw new DomainError(
        'RECURRING_INVALID_AMOUNT',
        'an explicit schedule carries its amounts per item; the template amount is VARIABLE',
      ).at('/amount');
    }
    const items = (schedule.explicit ?? []).map((item, i) => {
      try {
        const parsed = Money.parse(item.amount, currency);
        if (!parsed.isPositive()) throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be positive');
        return { ...item, amount: parsed.toFixed() };
      } catch (err) {
        if (err instanceof DomainError) {
          throw new DomainError('RECURRING_INVALID_AMOUNT', `${err.code}: ${err.message}`).at(
            `/schedule/explicit/${i}/amount`,
          );
        }
        throw err;
      }
    });
    (schedule as { explicit: readonly ExplicitScheduleItem[] }).explicit = items;
  }
  const materialization = buildMaterialization(template.materialization, amount, indexedPrice !== null);
  if (explicit && materialization.mode !== 'NOTIFY_ONLY') {
    throw new DomainError(
      'RECURRING_MODE_NOT_ALLOWED',
      'an explicit schedule only supports the NOTIFY_ONLY mode',
    ).at('/materialization/mode');
  }
  return {
    versionNo: input.versionNo,
    effectiveFrom: input.effectiveFrom,
    accountId: template.accountId,
    toAccountId: template.toAccountId ?? null,
    currency: currency.code,
    amount,
    categoryId: template.categoryId ?? null,
    counterpartyId: template.counterpartyId ?? null,
    tagIds: [...new Set(template.tagIds ?? [])].sort(),
    paymentMethod: paymentMethod as PaymentMethod | null,
    schedule,
    materialization,
    ...(indexedPrice !== null ? { indexedPrice } : {}),
  };
}

/** La versión como entrada de plantilla (base para aplicar los cambios de una revisión). */
export function templateOf(version: DefinitionVersion): TemplateInput {
  return {
    accountId: version.accountId,
    toAccountId: version.toAccountId,
    amount: version.amount,
    categoryId: version.categoryId,
    counterpartyId: version.counterpartyId,
    tagIds: version.tagIds,
    paymentMethod: version.paymentMethod,
    schedule: {
      cadence: version.schedule.cadence,
      interval: version.schedule.interval,
      monthDays: version.schedule.monthDays,
      rrule: version.schedule.rrule,
      startDate: version.schedule.startDate,
      endDate: version.schedule.endDate,
      maxOccurrences: version.schedule.maxOccurrences,
      weekendAdjustment: version.schedule.weekendAdjustment,
      ...(version.schedule.cadence === 'EXPLICIT' ? { explicit: version.schedule.explicit ?? [] } : {}),
    },
    materialization: {
      mode: version.materialization.mode,
      autoCreateStatus: version.materialization.autoCreateStatus,
      leadDays: version.materialization.leadDays,
    },
    ...(version.indexedPrice ? { indexedPrice: version.indexedPrice } : {}),
  };
}
