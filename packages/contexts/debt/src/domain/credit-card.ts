import { DomainError, type LocalDate, dec, currency as makeCurrency } from '@pf/shared-kernel';
import { CardCycleCalendar, validateDay } from './card-cycle-calendar.js';
import {
  CARD_PAYMENT_POLICIES,
  DEFAULT_REMINDER_DAYS,
  DEFAULT_UTILIZATION_THRESHOLDS,
  DUE_WEEKEND_ADJUSTMENTS,
  MATERIALIZATION_MODES,
  MAX_REMINDER_DAYS,
  MAX_UTILIZATION_THRESHOLDS,
  MIN_REMINDER_DAYS,
  MIN_UTILIZATION_THRESHOLDS,
  type CardLimitMode,
  type CardMaterializationMode,
  type CardPaymentPolicy,
  type CardStatus,
  type CardTerms,
  type CardTermsVersion,
  type DueWeekendAdjustment,
  type MinimumPaymentRuleSpec,
} from './card-types.js';
import { normalizeAmount, normalizeMinimumRule, normalizePercent } from './minimum-payment-rule.js';

/**
 * AR `CreditCard` (openspec add-credit-cards, design § Contexto y decisión 1; docs/04 §3.9): el PERFIL de una o más
 * cuentas `credit_card` ya existentes (una por moneda): términos del calendario, límites, regla de pago mínimo por
 * cuenta, umbrales de utilización, recordatorio y plan de pago administrado. No tiene máquina de estados (D178: solo
 * `ACTIVE → ARCHIVED`; la historia está en la auditoría). Registrarla no crea asientos. Cada hecho publicado sube
 * `version` (el outbox exige una versión por hecho).
 */
export interface MaterializationSpec {
  readonly mode: CardMaterializationMode;
  readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
  readonly leadDays: number | null;
}

export interface CardPaymentPlanState {
  readonly sourceAccountId: string;
  readonly policy: CardPaymentPolicy;
  readonly materialization: MaterializationSpec;
  /** Definición `CARD_PAYMENT` administrada en COMMITMENTS. */
  readonly definitionId: string;
  readonly enabledAt: string;
}

export interface CardAccountState {
  /** Id de la fila `credit_card_account` (el de `cardAccountId` en eventos y estados de cuenta). */
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly scale: number;
  /** Solo con límite separado. */
  readonly creditLimit: string | null;
  readonly minimumRule: MinimumPaymentRuleSpec;
  readonly paymentPlan: CardPaymentPlanState | null;
}

export interface CreditCardState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  /** Porcentaje informativo (`24.00`); `null` si no se informó. */
  readonly annualRate: string | null;
  readonly limitMode: CardLimitMode;
  /** Límite compartido (solo `SHARED`). */
  readonly sharedLimit: { readonly amount: string; readonly currency: string; readonly scale: number } | null;
  /** 1..3 porcentajes ascendentes con 2 decimales. */
  readonly utilizationThresholds: readonly string[];
  readonly reminderDays: number;
  readonly status: CardStatus;
  /** Términos del calendario por fecha de vigencia (ascendente; la primera rige desde siempre). */
  readonly terms: readonly CardTermsVersion[];
  readonly accounts: readonly CardAccountState[];
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardAccountInput {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly scale: number;
  readonly creditLimit?: string | null | undefined;
  readonly minimumRule: unknown;
}

export interface RegisterCardInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: unknown;
  readonly accounts: readonly CardAccountInput[];
  readonly limitMode?: unknown;
  readonly sharedLimit?: { readonly amount: unknown; readonly currency: unknown } | null | undefined;
  readonly statementDay: unknown;
  readonly dueDay: unknown;
  readonly dueWeekendAdjustment?: unknown;
  readonly annualRate?: unknown;
  readonly utilizationThresholds?: unknown;
  readonly reminderDays?: unknown;
  /** Escala de cada moneda del límite compartido (la resuelve la aplicación). */
  readonly scaleOf: (code: string) => number | null;
  readonly at: string;
  readonly by: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const fail = (message: string, pointer: string): never => {
  throw new DomainError('VALIDATION_FAILED', message).at(pointer);
};

export function validCardName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 120) fail('name must have between 1 and 120 characters', '/name');
  return name;
}

function validWeekend(value: unknown, pointer: string): DueWeekendAdjustment {
  if (value === undefined || value === null) return 'NONE';
  if (typeof value === 'string' && (DUE_WEEKEND_ADJUSTMENTS as readonly string[]).includes(value)) {
    return value as DueWeekendAdjustment;
  }
  return fail('must be NONE, PREVIOUS or NEXT', pointer);
}

/** Tasa nominal anual informativa (0.00 a 999.99 %), `null` si no se informó. */
function validAnnualRate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return normalizePercent(value, '/annualRate', '0.00', '999.99');
}

/** 1 a 3 umbrales distintos entre 0.01 y 100.00, ascendentes. */
export function validThresholds(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [...DEFAULT_UTILIZATION_THRESHOLDS];
  if (!Array.isArray(value)) return fail('must be an array', '/utilizationThresholds');
  if (value.length < MIN_UTILIZATION_THRESHOLDS || value.length > MAX_UTILIZATION_THRESHOLDS) {
    return fail(
      `must have between ${MIN_UTILIZATION_THRESHOLDS} and ${MAX_UTILIZATION_THRESHOLDS} thresholds`,
      '/utilizationThresholds',
    );
  }
  const normalized = value.map((v, i) => normalizePercent(v, `/utilizationThresholds/${i}`));
  if (new Set(normalized).size !== normalized.length) {
    return fail('thresholds must be distinct', '/utilizationThresholds');
  }
  return normalized.sort((a, b) => dec(a).comparedTo(dec(b)));
}

function validReminderDays(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_REMINDER_DAYS;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_REMINDER_DAYS ||
    value > MAX_REMINDER_DAYS
  ) {
    return fail(`must be an integer between ${MIN_REMINDER_DAYS} and ${MAX_REMINDER_DAYS}`, '/reminderDays');
  }
  return value;
}

function validLimit(value: unknown, code: string, scale: number, pointer: string): string {
  if (value === undefined || value === null) return fail('the limit is required', pointer);
  return normalizeAmount(value, makeCurrency(code, scale), pointer, true);
}

export function validMaterialization(
  value:
    | { readonly mode?: unknown; readonly autoCreateStatus?: unknown; readonly leadDays?: unknown }
    | null
    | undefined,
): MaterializationSpec {
  // Por defecto, aprobación pendiente (D168).
  if (value === undefined || value === null)
    return { mode: 'PENDING_APPROVAL', autoCreateStatus: null, leadDays: null };
  const mode = value.mode ?? 'PENDING_APPROVAL';
  if (typeof mode !== 'string' || !(MATERIALIZATION_MODES as readonly string[]).includes(mode)) {
    return fail('must be AUTO_CREATE, PENDING_APPROVAL or NOTIFY_ONLY', '/materialization/mode');
  }
  const status = value.autoCreateStatus ?? null;
  if (status !== null && status !== 'PENDING' && status !== 'POSTED') {
    return fail('must be PENDING or POSTED', '/materialization/autoCreateStatus');
  }
  const lead = value.leadDays ?? null;
  if (lead !== null && (typeof lead !== 'number' || !Number.isInteger(lead) || lead < 0 || lead > 60)) {
    return fail('must be an integer between 0 and 60', '/materialization/leadDays');
  }
  return {
    mode: mode as CardMaterializationMode,
    autoCreateStatus: status as 'PENDING' | 'POSTED' | null,
    leadDays: lead as number | null,
  };
}

export function validPolicy(value: unknown): CardPaymentPolicy {
  if (value === undefined || value === null) return 'NO_INTEREST';
  if (typeof value === 'string' && (CARD_PAYMENT_POLICIES as readonly string[]).includes(value)) {
    return value as CardPaymentPolicy;
  }
  return fail('must be NO_INTEREST or MINIMUM', '/policy');
}

/** Campos del agregado para la auditoría (orden estable). */
export const CARD_AUDIT_FIELDS = [
  'name',
  'status',
  'statementDay',
  'dueDay',
  'dueWeekendAdjustment',
  'annualRate',
  'limitMode',
  'utilizationThresholds',
  'reminderDays',
] as const;

export interface CardEdit {
  readonly name?: unknown;
  readonly annualRate?: unknown;
  readonly limitMode?: unknown;
  readonly sharedLimit?: { readonly amount: unknown; readonly currency: unknown } | null | undefined;
  /** Límite y regla de mínimo por cuenta de la tarjeta (`accountId` de la cuenta de ledger). */
  readonly accounts?: readonly {
    readonly accountId: string;
    readonly creditLimit?: unknown;
    readonly minimumRule?: unknown;
  }[];
  readonly utilizationThresholds?: unknown;
  readonly reminderDays?: unknown;
  readonly statementDay?: unknown;
  readonly dueDay?: unknown;
  readonly dueWeekendAdjustment?: unknown;
}

export class CreditCard {
  private fieldsChanged: string[] = [];
  /** `true` si el último `update` cambió el calendario (el llamador revisa el plan de pago). */
  private termsChangedFlag = false;

  private constructor(
    private state: CreditCardState,
    private persisted: number,
  ) {}

  static register(input: RegisterCardInput): CreditCard {
    const name = validCardName(input.name);
    if (input.accounts.length < 1) fail('at least one account is required', '/accounts');
    const currencies = new Set(input.accounts.map((a) => a.currency));
    if (currencies.size !== input.accounts.length) {
      throw new DomainError('CREDIT_CARD_ACCOUNT_INVALID', 'only one account per currency is allowed').at(
        '/accounts',
      );
    }
    if (new Set(input.accounts.map((a) => a.accountId)).size !== input.accounts.length) {
      throw new DomainError('CREDIT_CARD_ACCOUNT_INVALID', 'an account can appear only once').at('/accounts');
    }
    const requestedMode = input.limitMode ?? (input.sharedLimit ? 'SHARED' : 'SEPARATE');
    if (requestedMode !== 'SEPARATE' && requestedMode !== 'SHARED')
      fail('must be SEPARATE or SHARED', '/limitMode');
    const limitMode = requestedMode as CardLimitMode;
    if (limitMode === 'SHARED' && input.accounts.length < 2) {
      fail('a card with a single account must use a separate limit', '/limitMode');
    }
    const statementDay = validateDay(input.statementDay, '/statementDay');
    const dueDay = validateDay(input.dueDay, '/dueDay');
    const accounts: CardAccountState[] = input.accounts.map((a, i) => {
      const currency = makeCurrency(a.currency, a.scale);
      if (limitMode === 'SHARED' && a.creditLimit !== undefined && a.creditLimit !== null) {
        fail('per-account limits are not allowed with a shared limit', `/accounts/${i}/creditLimit`);
      }
      return {
        id: a.id,
        accountId: a.accountId,
        currency: a.currency,
        scale: a.scale,
        creditLimit:
          limitMode === 'SEPARATE'
            ? validLimit(a.creditLimit, a.currency, a.scale, `/accounts/${i}/creditLimit`)
            : null,
        minimumRule: normalizeMinimumRule(a.minimumRule, currency, `/accounts/${i}/minimumRule`),
        paymentPlan: null,
      };
    });
    const sharedLimit =
      limitMode === 'SHARED' ? CreditCard.validSharedLimit(input.sharedLimit, accounts, input.scaleOf) : null;
    return new CreditCard(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name,
        annualRate: validAnnualRate(input.annualRate),
        limitMode,
        sharedLimit,
        utilizationThresholds: validThresholds(input.utilizationThresholds),
        reminderDays: validReminderDays(input.reminderDays),
        status: 'ACTIVE',
        terms: [
          {
            statementDay,
            dueDay,
            dueWeekendAdjustment: validWeekend(input.dueWeekendAdjustment, '/dueWeekendAdjustment'),
            effectiveFrom: '0001-01-01',
          },
        ],
        accounts,
        archivedAt: null,
        version: 1,
        createdBy: input.by,
        createdAt: input.at,
        updatedAt: input.at,
      },
      0,
    );
  }

  private static validSharedLimit(
    raw: RegisterCardInput['sharedLimit'],
    accounts: readonly CardAccountState[],
    scaleOf: (code: string) => number | null,
  ): NonNullable<CreditCardState['sharedLimit']> {
    if (!raw) return fail('the shared limit is required', '/sharedLimit');
    const code = raw.currency;
    if (typeof code !== 'string') return fail('currency is required', '/sharedLimit/currency');
    if (!accounts.some((a) => a.currency === code)) {
      return fail(
        'the shared limit must be in the currency of one of the card accounts',
        '/sharedLimit/currency',
      );
    }
    const scale = scaleOf(code);
    if (scale === null) return fail(`currency ${code} is not available`, '/sharedLimit/currency');
    return {
      amount: normalizeAmount(raw.amount, makeCurrency(code, scale), '/sharedLimit/amount', true),
      currency: code,
      scale,
    };
  }

  static restore(state: CreditCardState): CreditCard {
    return new CreditCard({ ...state }, state.version);
  }

  // ───────────────────────────────────────────────────────────── lectura

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): CardStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): CreditCardState {
    return { ...this.state };
  }
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }
  get termsChanged(): boolean {
    return this.termsChangedFlag;
  }
  get persistedVersion(): number {
    return this.persisted;
  }
  markPersisted(): void {
    this.persisted = this.state.version;
    this.termsChangedFlag = false;
  }

  /** Términos vigentes (la última versión). */
  get currentTerms(): CardTerms {
    const last = this.state.terms.at(-1) as CardTermsVersion;
    return {
      statementDay: last.statementDay,
      dueDay: last.dueDay,
      dueWeekendAdjustment: last.dueWeekendAdjustment,
    };
  }

  get calendar(): CardCycleCalendar {
    return CardCycleCalendar.fromVersions(this.state.terms);
  }

  account(accountId: string): CardAccountState {
    const found = this.state.accounts.find((a) => a.accountId === accountId || a.id === accountId);
    if (!found) throw new DomainError('RESOURCE_NOT_FOUND', `the card has no account ${accountId}`);
    return found;
  }

  assertActive(): void {
    if (this.state.status !== 'ACTIVE') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'CreditCard: the card is archived');
    }
  }

  // ───────────────────────────────────────────────────────────── comandos

  /** Cambia nombre, tasa, límites, regla de mínimo, umbrales, recordatorio y términos del calendario. */
  update(
    edit: CardEdit,
    ctx: { readonly at: string; readonly today: LocalDate; readonly lastIssuedClosing: LocalDate | null },
  ): void {
    this.assertActive();
    const patch: Partial<Mutable<CreditCardState>> = {};
    const fields: string[] = [];
    if (edit.name !== undefined) {
      const name = validCardName(edit.name);
      if (name !== this.state.name) {
        patch.name = name;
        fields.push('name');
      }
    }
    if (edit.annualRate !== undefined) {
      const rate = validAnnualRate(edit.annualRate);
      if (rate !== this.state.annualRate) {
        patch.annualRate = rate;
        fields.push('annualRate');
      }
    }
    if (edit.utilizationThresholds !== undefined) {
      const thresholds = validThresholds(edit.utilizationThresholds);
      if (JSON.stringify(thresholds) !== JSON.stringify(this.state.utilizationThresholds)) {
        patch.utilizationThresholds = thresholds;
        fields.push('utilizationThresholds');
      }
    }
    if (edit.reminderDays !== undefined) {
      const days = validReminderDays(edit.reminderDays);
      if (days !== this.state.reminderDays) {
        patch.reminderDays = days;
        fields.push('reminderDays');
      }
    }
    // Límite: modo, compartido y por cuenta.
    let limitMode = this.state.limitMode;
    if (edit.limitMode !== undefined) {
      if (edit.limitMode !== 'SEPARATE' && edit.limitMode !== 'SHARED')
        fail('must be SEPARATE or SHARED', '/limitMode');
      limitMode = edit.limitMode as CardLimitMode;
      if (limitMode === 'SHARED' && this.state.accounts.length < 2) {
        fail('a card with a single account must use a separate limit', '/limitMode');
      }
    }
    let accounts = [...this.state.accounts];
    for (const [i, change] of (edit.accounts ?? []).entries()) {
      const idx = accounts.findIndex((a) => a.accountId === change.accountId);
      if (idx < 0)
        throw new DomainError('RESOURCE_NOT_FOUND', 'the card has no such account').at(`/accounts/${i}`);
      const current = accounts[idx] as CardAccountState;
      const next: Mutable<CardAccountState> = { ...current };
      if (change.creditLimit !== undefined) {
        if (limitMode === 'SHARED')
          fail('per-account limits are not allowed with a shared limit', `/accounts/${i}/creditLimit`);
        next.creditLimit = validLimit(
          change.creditLimit,
          current.currency,
          current.scale,
          `/accounts/${i}/creditLimit`,
        );
      }
      if (change.minimumRule !== undefined) {
        next.minimumRule = normalizeMinimumRule(
          change.minimumRule,
          makeCurrency(current.currency, current.scale),
          `/accounts/${i}/minimumRule`,
        );
      }
      accounts[idx] = next;
    }
    if (limitMode !== this.state.limitMode) {
      patch.limitMode = limitMode;
      fields.push('limitMode');
      accounts = accounts.map((a) => ({ ...a, creditLimit: limitMode === 'SHARED' ? null : a.creditLimit }));
      if (limitMode === 'SEPARATE') {
        accounts.forEach((a, i) => {
          if (a.creditLimit === null) fail('the limit is required', `/accounts/${i}/creditLimit`);
        });
        patch.sharedLimit = null;
      }
    }
    if (limitMode === 'SHARED' && (edit.sharedLimit !== undefined || this.state.sharedLimit === null)) {
      const shared = CreditCard.validSharedLimit(
        edit.sharedLimit ?? null,
        accounts,
        (code) => accounts.find((a) => a.currency === code)?.scale ?? null,
      );
      if (JSON.stringify(shared) !== JSON.stringify(this.state.sharedLimit)) {
        patch.sharedLimit = shared;
        fields.push('sharedLimit');
      }
    } else if (edit.sharedLimit !== undefined && limitMode === 'SEPARATE') {
      fail('a shared limit requires limitMode SHARED', '/sharedLimit');
    }
    if (JSON.stringify(accounts) !== JSON.stringify(this.state.accounts)) {
      patch.accounts = accounts;
      for (const a of accounts) {
        const before = this.state.accounts.find((x) => x.id === a.id);
        if (before?.creditLimit !== a.creditLimit) fields.push('creditLimit');
        if (JSON.stringify(before?.minimumRule) !== JSON.stringify(a.minimumRule)) fields.push('minimumRule');
      }
    }
    // Términos del calendario: nueva versión desde el ciclo abierto (decisión 2).
    const cur = this.currentTerms;
    const nextTerms: CardTerms = {
      statementDay:
        edit.statementDay === undefined ? cur.statementDay : validateDay(edit.statementDay, '/statementDay'),
      dueDay: edit.dueDay === undefined ? cur.dueDay : validateDay(edit.dueDay, '/dueDay'),
      dueWeekendAdjustment:
        edit.dueWeekendAdjustment === undefined
          ? cur.dueWeekendAdjustment
          : validWeekend(edit.dueWeekendAdjustment, '/dueWeekendAdjustment'),
    };
    let termsChanged = false;
    if (
      nextTerms.statementDay !== cur.statementDay ||
      nextTerms.dueDay !== cur.dueDay ||
      nextTerms.dueWeekendAdjustment !== cur.dueWeekendAdjustment
    ) {
      patch.terms = this.calendar.withTerms(nextTerms, {
        lastIssuedClosing: ctx.lastIssuedClosing,
        today: ctx.today,
      }).versions;
      if (nextTerms.statementDay !== cur.statementDay) fields.push('statementDay');
      if (nextTerms.dueDay !== cur.dueDay) fields.push('dueDay');
      if (nextTerms.dueWeekendAdjustment !== cur.dueWeekendAdjustment) fields.push('dueWeekendAdjustment');
      termsChanged = true;
    }
    if (fields.length === 0 && Object.keys(patch).length === 0) {
      this.fieldsChanged = [];
      this.termsChangedFlag = false;
      return;
    }
    this.apply({ ...patch, accounts }, ctx.at);
    this.fieldsChanged = [...new Set(fields)];
    this.termsChangedFlag = termsChanged;
  }

  archive(at: string): void {
    this.assertActive();
    this.apply(
      {
        status: 'ARCHIVED',
        archivedAt: at,
        accounts: this.state.accounts.map((a) => ({ ...a, paymentPlan: null })),
      },
      at,
    );
    this.fieldsChanged = ['status'];
    this.termsChangedFlag = false;
  }

  /** Activa o reemplaza el plan de pago de una cuenta (la definición ya existe en COMMITMENTS). */
  setPaymentPlan(accountId: string, plan: CardPaymentPlanState | null, at: string): void {
    this.assertActive();
    const target = this.account(accountId);
    this.apply(
      { accounts: this.state.accounts.map((a) => (a.id === target.id ? { ...a, paymentPlan: plan } : a)) },
      at,
    );
    this.fieldsChanged = ['paymentPlan'];
    this.termsChangedFlag = false;
  }

  /** Anotación sin cambio de datos (cada hecho publicado necesita una versión nueva). */
  touch(fields: readonly string[], at: string): void {
    this.apply({}, at);
    this.fieldsChanged = [...fields];
    this.termsChangedFlag = false;
  }

  // ───────────────────────────────────────────────────────────── internos

  private apply(patch: Partial<Mutable<CreditCardState>>, at: string): void {
    this.state = {
      ...this.state,
      ...patch,
      version: this.state.version + 1,
      updatedAt: at,
    } as CreditCardState;
  }
}
