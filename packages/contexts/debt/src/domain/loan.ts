import { DomainError, LocalDate, Money, dec, currency as makeCurrency } from '@pf/shared-kernel';
import {
  CHARGE_MODES,
  DAY_COUNTS,
  LOAN_FREQUENCIES,
  MAX_LOAN_INSTALLMENTS,
  MIN_LOAN_INSTALLMENTS,
  MONTHS_PER_PERIOD,
  type ChargeSpec,
  type DayCount,
  type LoanCharges,
  type LoanFrequency,
} from './loan-types.js';
import {
  LOAN_LIFECYCLE,
  type LoanStatus,
  type LoanTransition,
  type LoanTransitionRecord,
} from './loan-lifecycle.js';

export const LOAN_RATE_TYPES = ['FIXED', 'VARIABLE'] as const;
export type LoanRateType = (typeof LOAN_RATE_TYPES)[number];
export const LOAN_METHODS = ['FRENCH', 'GERMAN', 'FIXED_PRINCIPAL', 'CUSTOM'] as const;
export type LoanMethod = (typeof LOAN_METHODS)[number];
export const LOAN_ORIGINS = ['NEW', 'EXISTING'] as const;
export type LoanOrigin = (typeof LOAN_ORIGINS)[number];

/** Tasa anual máxima aceptada (fracción): 100 %. */
export const MAX_ANNUAL_RATE = '1';

export interface ExistingLoanTerms {
  /** Fecha del saldo pendiente (`YYYY-MM-DD`). */
  readonly asOf: string;
  /** Principal pendiente a `asOf`. */
  readonly outstanding: string;
  /** Número de la próxima cuota (la numeración original continúa). */
  readonly nextInstallmentNo: number;
}

export interface LoanState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly accountId: string;
  readonly disbursementAccountId: string;
  readonly paymentAccountId: string;
  readonly lenderCounterpartyId: string | null;
  /** NEW: principal desembolsado; EXISTING: saldo de principal pendiente a `existing.asOf`. */
  readonly principal: string;
  readonly currency: string;
  /** Fracción decimal (`0.115` = 11.50 %). */
  readonly annualRate: string;
  readonly rateType: LoanRateType;
  readonly dayCount: DayCount;
  readonly frequency: LoanFrequency;
  /** NEW: plazo total; EXISTING: cuotas restantes. */
  readonly termInstallments: number;
  readonly method: LoanMethod;
  /** EXISTING: igual a `existing.asOf`. */
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges: LoanCharges;
  readonly retainedFee: string;
  readonly origin: LoanOrigin;
  readonly existing: ExistingLoanTerms | null;
  readonly status: LoanStatus;
  readonly currentScheduleVersion: number | null;
  readonly recurringDefinitionId: string | null;
  readonly disbursementTransactionId: string | null;
  readonly cancelledReason: string | null;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const fail = (message: string, pointer: string): never => {
  throw new DomainError('VALIDATION_FAILED', message).at(pointer);
};

export function validLoanName(value: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 120) fail('name must have between 1 and 120 characters', '/name');
  return name;
}

function parseDate(value: unknown, pointer: string): string {
  try {
    return LocalDate.parse(value as string).toString();
  } catch {
    return fail('date must be YYYY-MM-DD', pointer);
  }
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parseFraction(value: unknown, pointer: string, max: string): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail('must be a decimal string', pointer);
  const d = dec(value);
  if (d.decimalPlaces() > 18) return fail('must have at most 18 decimals', pointer);
  if (d.gt(dec(max))) return fail(`must not exceed ${max}`, pointer);
  return d.toFixed();
}

/** Monto >= 0 a la escala de la moneda (cargo fijo); `AMOUNT_SCALE_EXCEEDED` si tiene más decimales. */
function parseAmount(
  value: unknown,
  code: string,
  scale: number,
  pointer: string,
  positive: boolean,
): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail('must be a decimal string', pointer);
  let money: Money;
  try {
    money = Money.parse(value, makeCurrency(code, scale));
  } catch (err) {
    if (err instanceof DomainError) throw err.at(pointer);
    throw err;
  }
  if (positive && !money.amount.gt(0)) return fail('must be greater than zero', pointer);
  return money.toFixed();
}

export function normalizeCharges(
  raw: unknown,
  code: string,
  scale: number,
  pointer = '/charges',
): LoanCharges {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('charges must be an object', pointer);
  const input = raw as Record<string, unknown>;
  const out: { fees?: ChargeSpec; insurance?: ChargeSpec; taxes?: ChargeSpec } = {};
  for (const key of Object.keys(input)) {
    if (key !== 'fees' && key !== 'insurance' && key !== 'taxes') {
      return fail('unknown charge', `${pointer}/${key}`);
    }
  }
  for (const key of ['fees', 'insurance', 'taxes'] as const) {
    const spec = input[key];
    if (spec === undefined || spec === null) continue;
    const at = `${pointer}/${key}`;
    if (typeof spec !== 'object' || Array.isArray(spec)) return fail('must be an object', at);
    const { mode, value } = spec as Record<string, unknown>;
    if (typeof mode !== 'string' || !(CHARGE_MODES as readonly string[]).includes(mode)) {
      return fail('mode must be FIXED or RATE_ON_BALANCE', `${at}/mode`);
    }
    const normalized =
      mode === 'FIXED'
        ? parseAmount(value, code, scale, `${at}/value`, false)
        : parseFraction(value, `${at}/value`, '1');
    // Un cargo en cero equivale a no tenerlo.
    if (dec(normalized).isZero()) continue;
    out[key] = { mode: mode as ChargeSpec['mode'], value: normalized };
  }
  return out;
}

export interface LoanTermsInput {
  readonly name: string;
  readonly accountId: string;
  readonly disbursementAccountId: string;
  readonly paymentAccountId: string;
  readonly lenderCounterpartyId?: string | null | undefined;
  readonly principal: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly annualRate: string;
  readonly rateType?: string | undefined;
  readonly dayCount?: string | undefined;
  readonly frequency?: string | undefined;
  readonly termInstallments: number;
  readonly method?: string | undefined;
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges?: unknown;
}

interface ValidatedTerms {
  readonly principal: string;
  readonly annualRate: string;
  readonly rateType: LoanRateType;
  readonly dayCount: DayCount;
  readonly frequency: LoanFrequency;
  readonly termInstallments: number;
  readonly method: LoanMethod;
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges: LoanCharges;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, pointer: string): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fail(`must be one of ${allowed.join(', ')}`, pointer);
  }
  return value as T;
}

/** Valida y normaliza las condiciones financieras (alta y edición del borrador). */
export function validateTerms(input: LoanTermsInput, origin: LoanOrigin): ValidatedTerms {
  const method = oneOf(input.method, LOAN_METHODS, 'FRENCH', '/method');
  if (method !== 'FRENCH') {
    throw new DomainError(
      'LOAN_METHOD_NOT_AVAILABLE',
      `the ${method} amortization method is not available`,
    ).at('/method');
  }
  const principal = parseAmount(input.principal, input.currency, input.currencyScale, '/principal', true);
  const annualRate = parseFraction(input.annualRate, '/annualRate', MAX_ANNUAL_RATE);
  const term = input.termInstallments;
  if (!Number.isInteger(term) || term < MIN_LOAN_INSTALLMENTS || term > MAX_LOAN_INSTALLMENTS) {
    fail(
      `termInstallments must be an integer between ${MIN_LOAN_INSTALLMENTS} and ${MAX_LOAN_INSTALLMENTS}`,
      '/termInstallments',
    );
  }
  const disbursementDate = parseDate(input.disbursementDate, '/disbursementDate');
  const firstDueDate = parseDate(input.firstDueDate, '/firstDueDate');
  if (origin === 'NEW' ? firstDueDate <= disbursementDate : firstDueDate < disbursementDate) {
    fail('the first due date must be after the disbursement date', '/firstDueDate');
  }
  return {
    principal,
    annualRate,
    rateType: oneOf(input.rateType, LOAN_RATE_TYPES, 'FIXED', '/rateType'),
    dayCount: oneOf(input.dayCount, DAY_COUNTS, 'D30_360', '/dayCount'),
    frequency: oneOf(input.frequency, LOAN_FREQUENCIES, 'MONTHLY', '/frequency'),
    termInstallments: term,
    method,
    disbursementDate,
    firstDueDate,
    charges: normalizeCharges(input.charges, input.currency, input.currencyScale),
  };
}

export interface LoanEdit {
  readonly name?: string | undefined;
  readonly lenderCounterpartyId?: string | null | undefined;
  readonly paymentAccountId?: string | undefined;
  /** Solo en borrador. */
  readonly terms?: Partial<Omit<LoanTermsInput, 'currency' | 'currencyScale'>> | undefined;
}

const TERM_FIELDS = [
  'accountId',
  'disbursementAccountId',
  'principal',
  'annualRate',
  'rateType',
  'dayCount',
  'frequency',
  'termInstallments',
  'method',
  'disbursementDate',
  'firstDueDate',
  'charges',
] as const;

/**
 * AR `Loan` (DEBT, docs/04 §3.9; openspec add-loans decisión 2). Condiciones, estado y referencias a la cuenta del
 * préstamo, el desembolso y el compromiso de cuotas. El cronograma (versiones inmutables), los pagos y las referencias
 * del banco viven en tablas propias (alto volumen). Toda transición se valida contra `LOAN_LIFECYCLE`; cada cambio
 * publicado sube `version`.
 */
export class Loan {
  private transition: LoanTransitionRecord | null = null;
  private fieldsChanged: string[] = [];

  private constructor(
    private state: LoanState,
    private persisted: number,
  ) {}

  /** Alta de un préstamo NUEVO (∅ → DRAFT): sin asientos hasta el desembolso. */
  static register(
    input: LoanTermsInput & {
      readonly id: string;
      readonly workspaceId: string;
      readonly at: string;
      readonly by: string;
    },
  ): Loan {
    const terms = validateTerms(input, 'NEW');
    const loan = new Loan(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: validLoanName(input.name),
        accountId: input.accountId,
        disbursementAccountId: input.disbursementAccountId,
        paymentAccountId: input.paymentAccountId,
        lenderCounterpartyId: input.lenderCounterpartyId ?? null,
        currency: input.currency,
        ...terms,
        retainedFee: dec('0').toFixed(input.currencyScale),
        origin: 'NEW',
        existing: null,
        status: 'DRAFT',
        currentScheduleVersion: null,
        recurringDefinitionId: null,
        disbursementTransactionId: null,
        cancelledReason: null,
        version: 1,
        createdBy: input.by,
        createdAt: input.at,
        updatedAt: input.at,
      },
      0,
    );
    loan.mark('REGISTER', null, 'DRAFT');
    return loan;
  }

  /**
   * Alta de un préstamo EN CURSO (∅ → ACTIVE): sin transacción de desembolso; el cronograma v1 y el compromiso se
   * crean en el mismo comando. `terms.disbursementDate` es la fecha del saldo pendiente; `termInstallments`, las
   * cuotas restantes.
   */
  static registerExisting(
    input: LoanTermsInput & {
      readonly id: string;
      readonly workspaceId: string;
      readonly nextInstallmentNo: number;
      readonly recurringDefinitionId?: string | null;
      readonly at: string;
      readonly by: string;
    },
  ): Loan {
    const nextNo = input.nextInstallmentNo;
    if (!Number.isInteger(nextNo) || nextNo < 1) {
      fail('nextInstallmentNo must be a positive integer', '/nextInstallmentNo');
    }
    const terms = validateTerms(input, 'EXISTING');
    const loan = new Loan(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: validLoanName(input.name),
        accountId: input.accountId,
        disbursementAccountId: input.disbursementAccountId,
        paymentAccountId: input.paymentAccountId,
        lenderCounterpartyId: input.lenderCounterpartyId ?? null,
        currency: input.currency,
        ...terms,
        retainedFee: dec('0').toFixed(input.currencyScale),
        origin: 'EXISTING',
        existing: { asOf: terms.disbursementDate, outstanding: terms.principal, nextInstallmentNo: nextNo },
        status: 'ACTIVE',
        currentScheduleVersion: 1,
        recurringDefinitionId: input.recurringDefinitionId ?? null,
        disbursementTransactionId: null,
        cancelledReason: null,
        version: 1,
        createdBy: input.by,
        createdAt: input.at,
        updatedAt: input.at,
      },
      0,
    );
    loan.mark('REGISTER_EXISTING', null, 'ACTIVE');
    return loan;
  }

  static restore(state: LoanState): Loan {
    return new Loan({ ...state }, state.version);
  }

  // ───────────────────────────────────────────────────────────── lectura

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): LoanStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): LoanState {
    return { ...this.state };
  }
  get lastTransition(): LoanTransitionRecord | null {
    return this.transition;
  }
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }
  get persistedVersion(): number {
    return this.persisted;
  }
  markPersisted(): void {
    this.persisted = this.state.version;
  }

  /** Cuotas por año de la periodicidad. */
  get installmentsPerYear(): number {
    return 12 / MONTHS_PER_PERIOD[this.state.frequency];
  }

  // ───────────────────────────────────────────────────────────── guardas

  assertDraft(): void {
    if (this.state.status !== 'DRAFT') {
      throw new DomainError('LOAN_NOT_DRAFT', `the loan is ${this.state.status}, not DRAFT`);
    }
  }

  assertActive(): void {
    if (this.state.status !== 'ACTIVE') {
      throw new DomainError('LOAN_NOT_ACTIVE', `the loan is ${this.state.status}, not ACTIVE`);
    }
  }

  // ───────────────────────────────────────────────────────────── comandos

  /** Edita nombre, prestamista y cuenta de pago (siempre) y las condiciones (solo en borrador). */
  edit(changes: LoanEdit, scale: number, at: string): void {
    if (this.state.status === 'CANCELLED') {
      throw new DomainError('LOAN_NOT_ACTIVE', 'a cancelled loan cannot be edited');
    }
    this.transition = null;
    this.fieldsChanged = [];
    const patch: Partial<Mutable<LoanState>> = {};
    const fields: string[] = [];
    if (changes.terms !== undefined) {
      const attempted = TERM_FIELDS.filter(
        (f) => (changes.terms as Record<string, unknown>)[f] !== undefined,
      );
      if (attempted.length > 0 && this.state.status !== 'DRAFT') {
        throw new DomainError(
          'LOAN_TERMS_LOCKED',
          `the financial terms of a ${this.state.status} loan cannot be edited`,
          { details: { fields: attempted } },
        );
      }
    }
    if (changes.name !== undefined) {
      const name = validLoanName(changes.name);
      if (name !== this.state.name) {
        patch.name = name;
        fields.push('name');
      }
    }
    if (
      changes.lenderCounterpartyId !== undefined &&
      changes.lenderCounterpartyId !== this.state.lenderCounterpartyId
    ) {
      patch.lenderCounterpartyId = changes.lenderCounterpartyId;
      fields.push('lenderCounterpartyId');
    }
    if (changes.paymentAccountId !== undefined && changes.paymentAccountId !== this.state.paymentAccountId) {
      if (this.state.status === 'PAID_OFF') {
        throw new DomainError('LOAN_NOT_ACTIVE', 'a paid-off loan keeps its payment account');
      }
      patch.paymentAccountId = changes.paymentAccountId;
      fields.push('paymentAccountId');
    }
    if (changes.terms !== undefined && this.state.status === 'DRAFT') {
      const s = this.state;
      const merged: LoanTermsInput = {
        name: s.name,
        accountId: changes.terms.accountId ?? s.accountId,
        disbursementAccountId: changes.terms.disbursementAccountId ?? s.disbursementAccountId,
        paymentAccountId: s.paymentAccountId,
        principal: changes.terms.principal ?? s.principal,
        currency: s.currency,
        currencyScale: scale,
        annualRate: changes.terms.annualRate ?? s.annualRate,
        rateType: changes.terms.rateType ?? s.rateType,
        dayCount: changes.terms.dayCount ?? s.dayCount,
        frequency: changes.terms.frequency ?? s.frequency,
        termInstallments: changes.terms.termInstallments ?? s.termInstallments,
        method: changes.terms.method ?? s.method,
        disbursementDate: changes.terms.disbursementDate ?? s.disbursementDate,
        firstDueDate: changes.terms.firstDueDate ?? s.firstDueDate,
        charges: changes.terms.charges !== undefined ? changes.terms.charges : s.charges,
      };
      const v = validateTerms(merged, 'NEW');
      const next: Partial<LoanState> = {
        accountId: merged.accountId,
        disbursementAccountId: merged.disbursementAccountId,
        principal: v.principal,
        annualRate: v.annualRate,
        rateType: v.rateType,
        dayCount: v.dayCount,
        frequency: v.frequency,
        termInstallments: v.termInstallments,
        method: v.method,
        disbursementDate: v.disbursementDate,
        firstDueDate: v.firstDueDate,
        charges: v.charges,
      };
      for (const [k, val] of Object.entries(next)) {
        const before = (s as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(before) !== JSON.stringify(val)) {
          (patch as Record<string, unknown>)[k] = val;
          fields.push(k);
        }
      }
    }
    if (fields.length === 0) return;
    this.apply(patch, at);
    this.fieldsChanged = fields;
  }

  /** DRAFT → ACTIVE: fija el cronograma v1, la comisión retenida, el desembolso y el compromiso de cuotas. */
  disburse(
    input: {
      readonly transactionId: string;
      readonly retainedFee: string;
      readonly recurringDefinitionId: string;
    },
    at: string,
  ): void {
    this.assertDraft();
    this.apply(
      {
        status: 'ACTIVE',
        currentScheduleVersion: 1,
        retainedFee: input.retainedFee,
        disbursementTransactionId: input.transactionId,
        recurringDefinitionId: input.recurringDefinitionId,
      },
      at,
    );
    this.mark('DISBURSE', 'DRAFT', 'ACTIVE');
  }

  /** Vincula el compromiso de cuotas a un préstamo recién creado (antes de persistirlo; no cambia la versión). */
  attachCommitment(definitionId: string): void {
    if (this.persisted !== 0) throw new DomainError('INTERNAL_ERROR', 'the loan is already persisted');
    this.state = { ...this.state, recurringDefinitionId: definitionId };
  }

  /** ACTIVE → PAID_OFF: el principal pendiente llegó a cero. */
  payOff(at: string): void {
    this.assertActive();
    this.apply({ status: 'PAID_OFF' }, at);
    this.mark('PAY_OFF', 'ACTIVE', 'PAID_OFF');
  }

  /** PAID_OFF → ACTIVE: se anuló el pago que saldó el préstamo; `definitionId` = el compromiso reinstaurado. */
  reactivate(at: string, definitionId: string | null = null): void {
    if (this.state.status !== 'PAID_OFF') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `Loan: cannot reactivate from ${this.state.status}`);
    }
    this.apply({ status: 'ACTIVE', ...(definitionId ? { recurringDefinitionId: definitionId } : {}) }, at);
    this.mark('REACTIVATE', 'PAID_OFF', 'ACTIVE');
  }

  /** DRAFT|ACTIVE → CANCELLED (el llamador verificó que no hay pagos vigentes). */
  cancel(reason: string, at: string): void {
    if (this.state.status !== 'DRAFT' && this.state.status !== 'ACTIVE') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `Loan: cannot cancel from ${this.state.status}`);
    }
    const from = this.state.status;
    this.apply({ status: 'CANCELLED', cancelledReason: reason }, at);
    this.mark('CANCEL', from, 'CANCELLED');
  }

  /** Anotación sin cambio de datos: pagos y anulaciones suben la versión (el outbox exige una versión por hecho). */
  touch(fields: readonly string[], at: string): void {
    this.transition = null;
    this.apply({}, at);
    this.fieldsChanged = [...fields];
  }

  // ───────────────────────────────────────────────────────────── internos

  private apply(patch: Partial<Mutable<LoanState>>, at: string): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1, updatedAt: at } as LoanState;
  }

  private mark(transition: LoanTransition, from: LoanStatus | null, to: LoanStatus): void {
    this.transition = LOAN_LIFECYCLE.transition(transition, from, to);
    this.fieldsChanged = [];
  }
}
