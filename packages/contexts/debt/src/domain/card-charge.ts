import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';

/**
 * Cargo de una tarjeta de crédito (openspec add-card-interest-ledger-portions, decisiones 3 a 5; docs/76): los intereses,
 * comisiones, seguro e impuestos que cobra el banco a una cuenta de la tarjeta. Dominio puro: valida y calcula; la
 * transacción (`EXPENSE` con `debtRole = CARD_CHARGE`) la crea TRANSACTIONS por su puerto público.
 */

/** Componentes de un cargo, en el orden en que se presentan. */
export const CARD_CHARGE_COMPONENT_KEYS = ['interest', 'fees', 'insurance', 'taxes'] as const;
export type CardChargeComponentKey = (typeof CARD_CHARGE_COMPONENT_KEYS)[number];

export const CARD_CHARGE_ORIGINS = ['RECORDED', 'ADOPTED'] as const;
export type CardChargeOrigin = (typeof CARD_CHARGE_ORIGINS)[number];

export const CARD_CHARGE_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type CardChargeStatus = (typeof CARD_CHARGE_STATUSES)[number];

/** Componentes de entrada: texto decimal en la moneda de la cuenta; los ausentes valen cero. */
export type CardChargeComponentInput = Partial<Record<CardChargeComponentKey, string | null | undefined>>;

export interface CardChargeState {
  readonly id: string;
  readonly workspaceId: string;
  readonly cardId: string;
  /** Cuenta de la tarjeta en DEBT (una por moneda). */
  readonly cardAccountId: string;
  /** Cuenta de usuario a la que se carga. */
  readonly accountId: string;
  readonly transactionId: string;
  readonly businessDate: string;
  readonly currency: Currency;
  readonly interest: Money;
  readonly fees: Money;
  readonly insurance: Money;
  readonly taxes: Money;
  readonly origin: CardChargeOrigin;
  readonly status: CardChargeStatus;
  readonly voidReason: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly voidedAt: string | null;
  readonly voidedBy: string | null;
  readonly version: number;
}

export interface CreateCardChargeInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly cardId: string;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly transactionId: string;
  readonly businessDate: string;
  readonly currency: Currency;
  readonly components: CardChargeComponentInput;
  readonly origin: CardChargeOrigin;
  readonly createdAt: string;
  readonly createdBy: string;
}

const invalid = (detail: string, pointer?: string) => {
  const err = new DomainError('CARD_CHARGE_INVALID', detail);
  return pointer ? err.at(pointer) : err;
};

/**
 * Componentes ≥ 0 a la escala de la moneda (`AMOUNT_NOT_POSITIVE` si es negativo, `AMOUNT_SCALE_EXCEEDED` si tiene más
 * decimales) con al menos uno positivo (`CARD_CHARGE_INVALID`).
 */
export function parseCardChargeComponents(
  input: CardChargeComponentInput,
  currency: Currency,
): Record<CardChargeComponentKey, Money> {
  const out = {} as Record<CardChargeComponentKey, Money>;
  for (const key of CARD_CHARGE_COMPONENT_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      out[key] = Money.zero(currency);
      continue;
    }
    if (typeof raw !== 'string') {
      throw new DomainError('VALIDATION_FAILED', `${key} must be a decimal string`).at(`/${key}`);
    }
    const money = Money.parse(raw, currency);
    if (money.isNegative()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', `${key} must be >= 0`).at(`/${key}`);
    }
    out[key] = money;
  }
  const total = Money.sum(
    CARD_CHARGE_COMPONENT_KEYS.map((k) => out[k]),
    currency,
  );
  if (!total.isPositive()) throw invalid('a card charge needs at least one positive component');
  return out;
}

/**
 * Fecha de un cargo (INV-015 aparte, lo valida el ledger): no posterior a hoy en la zona del workspace ni anterior a la
 * apertura de la cuenta (`openedOn`, la fecha del primer asiento de apertura, si lo hay).
 */
export function assertCardChargeDate(businessDate: string, today: LocalDate, openedOn: string | null): void {
  let date: LocalDate;
  try {
    date = LocalDate.parse(businessDate);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'date must be YYYY-MM-DD').at('/businessDate');
  }
  if (date.compare(today) > 0)
    throw invalid('the date of a card charge cannot be in the future', '/businessDate');
  if (openedOn !== null && date.compare(LocalDate.parse(openedOn)) < 0) {
    throw invalid('the date precedes the opening of the account', '/businessDate');
  }
}

export class CardCharge {
  private constructor(private state: CardChargeState) {}

  static rehydrate(state: CardChargeState): CardCharge {
    return new CardCharge(state);
  }

  /** Cargo nuevo y vigente; los componentes ya vienen validados por `parseCardChargeComponents`. */
  static create(
    input: Omit<CreateCardChargeInput, 'components'> & {
      readonly components: Record<CardChargeComponentKey, Money>;
    },
  ): CardCharge {
    return new CardCharge({
      id: input.id,
      workspaceId: input.workspaceId,
      cardId: input.cardId,
      cardAccountId: input.cardAccountId,
      accountId: input.accountId,
      transactionId: input.transactionId,
      businessDate: input.businessDate,
      currency: input.currency,
      interest: input.components.interest,
      fees: input.components.fees,
      insurance: input.components.insurance,
      taxes: input.components.taxes,
      origin: input.origin,
      status: 'ACTIVE',
      voidReason: null,
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      voidedAt: null,
      voidedBy: null,
      version: 1,
    });
  }

  get snapshot(): CardChargeState {
    return this.state;
  }

  get id(): string {
    return this.state.id;
  }

  /** Σ de los componentes (INV-021: lo que suman las porciones de la transacción). */
  total(): Money {
    const s = this.state;
    return Money.sum([s.interest, s.fees, s.insurance, s.taxes], s.currency);
  }

  /** Anula el cargo vigente; devuelve `false` si ya estaba anulado (idempotente). */
  void(reason: string, by: string, at: string): boolean {
    const trimmed = reason.trim();
    if (trimmed.length === 0) throw new DomainError('VALIDATION_FAILED', 'reason is required').at('/reason');
    if (trimmed.length > 200) {
      throw new DomainError('VALIDATION_FAILED', 'reason must have at most 200 characters').at('/reason');
    }
    if (this.state.status === 'VOIDED') return false;
    this.state = {
      ...this.state,
      status: 'VOIDED',
      voidReason: trimmed,
      voidedAt: at,
      voidedBy: by,
      version: this.state.version + 1,
    };
    return true;
  }
}

/**
 * Propuesta de cargo desde la diferencia con el banco (Could): si el saldo facturado informado supera al recalculado,
 * el total a repartir y la fecha de cierre; si no, `null`. Solo lectura: nada se registra sin confirmación.
 */
export function proposeChargeFromDifference(input: {
  readonly reportedBilledBalance: Money | null;
  readonly currentBilledBalance: Money;
  readonly closingDate: string;
}): { readonly businessDate: string; readonly total: Money } | null {
  if (input.reportedBilledBalance === null) return null;
  const difference = input.reportedBilledBalance.subtract(input.currentBilledBalance);
  return difference.isPositive() ? { businessDate: input.closingDate, total: difference } : null;
}
