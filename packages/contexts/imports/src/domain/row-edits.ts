import { DomainError, Money, currency as makeCurrency, dec } from '@pf/shared-kernel';

/**
 * Edición de la vista previa (openspec add-import-pipeline, decisiones 8, 11 y 12; FR-IMPORTS-009): lo EFECTIVO de una
 * fila es lo que el usuario editó (`edits`, origen `MANUAL`) sobre la propuesta de la clasificación (`proposal`:
 * alias, reglas, categoría por defecto). Reevaluar las reglas recalcula la propuesta y NUNCA toca las ediciones.
 * Dominio puro: ni base de datos ni efectos financieros.
 */

export type RowKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CONVERSION';
export const ROW_KINDS: readonly RowKind[] = ['EXPENSE', 'INCOME', 'TRANSFER', 'CONVERSION'];

/** Quién fijó un campo de la fila. */
export type FieldOrigin =
  | { readonly type: 'MANUAL' }
  | { readonly type: 'RULE'; readonly ruleId: string; readonly ruleVersion: number }
  | { readonly type: 'ALIAS' }
  | { readonly type: 'COUNTERPARTY_DEFAULT' }
  | { readonly type: 'SYSTEM_DEFAULT' };

export interface Originated<T> {
  readonly value: T;
  readonly origin: FieldOrigin;
}

/** Propuesta del pipeline (sin tocar al usuario). `null` = el pipeline no propone nada para ese campo. */
export interface ClassificationProposal {
  readonly category: Originated<string | null> | null;
  readonly counterparty: Originated<string | null> | null;
  readonly tags: Originated<readonly string[]> | null;
  readonly description: Originated<string> | null;
  readonly notes: Originated<string> | null;
  /** Regla que pidió revisar la fila. */
  readonly needsReview: { readonly ruleId: string; readonly ruleVersion: number } | null;
  /** Regla que propone excluirla del import (revertible, decisión 8). */
  readonly exclude: { readonly ruleId: string; readonly ruleVersion: number } | null;
  /** La evaluación de reglas falló para esta fila (`IMPORT_RULES_UNAVAILABLE`). */
  readonly rulesUnavailable: boolean;
}

export const EMPTY_PROPOSAL: ClassificationProposal = {
  category: null,
  counterparty: null,
  tags: null,
  description: null,
  notes: null,
  needsReview: null,
  exclude: null,
  rulesUnavailable: false,
};

export interface TransferEdit {
  readonly counterAccountId: string;
}

export interface ConversionEdit {
  readonly counterAccountId: string;
  /** Monto de la cuenta contraparte, en su moneda y su escala (texto decimal positivo). */
  readonly counterAmount: { readonly amount: string; readonly currency: string };
  readonly fee?: { readonly amount: string; readonly currency: string };
  /** Tasa cotizada por la institución: 1 `base` = `value` `quote` (exacta). */
  readonly quotedRate?: { readonly base: string; readonly quote: string; readonly value: string };
}

/** Lo que el usuario editó. `undefined` = sin edición; `null` = valor vaciado a propósito (origen manual). */
export interface RowEdits {
  readonly kind?: RowKind;
  readonly categoryId?: string | null;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly description?: string | null;
  readonly note?: string | null;
  readonly transfer?: TransferEdit | null;
  readonly conversion?: ConversionEdit | null;
  /** Vínculo confirmado con una ocurrencia de compromiso (D121: nunca automático). */
  readonly occurrenceLink?: { readonly occurrenceId: string } | null;
}

export const NO_EDITS: RowEdits = {};

const MANUAL: FieldOrigin = { type: 'MANUAL' };

export interface EffectiveRow {
  readonly kind: RowKind | null;
  readonly category: Originated<string | null> | null;
  readonly counterparty: Originated<string | null> | null;
  readonly tags: Originated<readonly string[]> | null;
  readonly description: Originated<string | null> | null;
  readonly notes: Originated<string | null> | null;
  readonly transfer: TransferEdit | null;
  readonly conversion: ConversionEdit | null;
  readonly occurrenceLink: { readonly occurrenceId: string } | null;
  readonly needsReview: boolean;
}

/** Lo efectivo: `edits` (origen manual) sobre la `proposal`; `originalDescription` es la del archivo. */
export function effectiveRow(
  proposal: ClassificationProposal,
  edits: RowEdits,
  originalDescription: string | null,
): EffectiveRow {
  const pick = <T>(edit: T | undefined, proposed: Originated<T> | null): Originated<T> | null =>
    edit !== undefined ? { value: edit, origin: MANUAL } : proposed;
  const description =
    edits.description !== undefined
      ? { value: edits.description, origin: MANUAL }
      : (proposal.description ?? {
          value: originalDescription,
          origin: { type: 'SYSTEM_DEFAULT' } as FieldOrigin,
        });
  return {
    kind: edits.kind ?? null,
    category: pick(edits.categoryId, proposal.category),
    counterparty: pick(edits.counterpartyId, proposal.counterparty),
    tags: pick(edits.tagIds, proposal.tags),
    description: description as Originated<string | null>,
    notes: pick(edits.note, proposal.notes) as Originated<string | null> | null,
    transfer: edits.transfer ?? null,
    conversion: edits.conversion ?? null,
    occurrenceLink: edits.occurrenceLink ?? null,
    needsReview: proposal.needsReview !== null,
  };
}

/**
 * Aplica un parche de edición (un `PATCH` de fila o una edición en lote) sobre las ediciones previas. Una clave
 * ausente no cambia nada; `null` en `transfer`/`conversion`/`occurrenceLink` quita la edición. Marcar una fila como
 * transferencia o conversión descarta la otra; volver a gasto/ingreso descarta ambas.
 */
export function applyEditPatch(previous: RowEdits, patch: RowEdits): RowEdits {
  let next: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((key === 'transfer' || key === 'conversion' || key === 'occurrenceLink') && value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  if (patch.transfer) {
    next['kind'] = 'TRANSFER';
    delete next['conversion'];
  } else if (patch.conversion) {
    next['kind'] = 'CONVERSION';
    delete next['transfer'];
  } else if (patch.kind === 'EXPENSE' || patch.kind === 'INCOME') {
    delete next['transfer'];
    delete next['conversion'];
  } else if (patch.kind === 'TRANSFER') {
    delete next['conversion'];
  } else if (patch.kind === 'CONVERSION') {
    delete next['transfer'];
  }
  next = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  return next as RowEdits;
}

/** `true` si el parche no trae ningún campo editable (cuerpo vacío ⇒ `VALIDATION_FAILED`). */
export function isEmptyPatch(patch: RowEdits & { decision?: unknown }): boolean {
  return Object.values(patch).every((v) => v === undefined);
}

// ───────────────────────────────────────────────────────────── transferencias y conversiones (2.6)

export interface CounterAccountView {
  readonly accountId: string;
  readonly currency: string;
  /** Escala (decimales) de la moneda de la cuenta contraparte. */
  readonly scale: number;
  readonly status: string;
}

/**
 * Una fila `TRANSFER` exige una cuenta contraparte distinta, activa y de la MISMA moneda (decisión 12):
 * `TRANSFER_SAME_ACCOUNT` / `TRANSFER_CURRENCY_MISMATCH`. La fila no cambia si se rechaza (lo garantiza el llamador).
 */
export function assertValidTransfer(input: {
  readonly accountId: string;
  readonly accountCurrency: string;
  readonly counter: CounterAccountView;
}): void {
  const { counter } = input;
  if (counter.accountId === input.accountId) {
    throw new DomainError('TRANSFER_SAME_ACCOUNT', 'a transfer needs two different accounts').at(
      '/transfer/counterAccountId',
    );
  }
  if (counter.status !== 'ACTIVE') {
    throw new DomainError('ACCOUNT_CLOSED', 'the counterpart account is not active').at(
      '/transfer/counterAccountId',
    );
  }
  if (counter.currency !== input.accountCurrency) {
    throw new DomainError(
      'TRANSFER_CURRENCY_MISMATCH',
      'a transfer needs both accounts in the same currency (use a conversion)',
    ).at('/transfer/counterAccountId');
  }
}

/** Tasa efectiva exacta de una conversión. */
export interface EffectiveRate {
  /** Moneda base del par (la de menor valor por unidad, p. ej. USD) y moneda cotizada (BOB). */
  readonly pair: string;
  /** Unidades de moneda cotizada por una unidad de la base; texto decimal exacto (sin redondear). */
  readonly rate: string;
}

/**
 * Una fila `CONVERSION` exige cuenta contraparte distinta, activa y de OTRA moneda, con el monto de esa cuenta en su
 * escala exacta (sin redondeo, INV-003). Devuelve la tasa efectiva exacta: cotizada por base, con la base en la
 * moneda del monto menor (696.00 BOB / 100.00 USD ⇒ USD/BOB 6.96).
 */
export function assertValidConversion(input: {
  readonly accountId: string;
  readonly accountCurrency: string;
  readonly accountScale: number;
  readonly amount: string;
  readonly counter: CounterAccountView;
  readonly counterAmount: { readonly amount: string; readonly currency: string };
}): EffectiveRate {
  const { counter, counterAmount } = input;
  if (counter.accountId === input.accountId) {
    throw new DomainError('TRANSFER_SAME_ACCOUNT', 'a conversion needs two different accounts').at(
      '/conversion/counterAccountId',
    );
  }
  if (counter.status !== 'ACTIVE') {
    throw new DomainError('ACCOUNT_CLOSED', 'the counterpart account is not active').at(
      '/conversion/counterAccountId',
    );
  }
  if (counter.currency === input.accountCurrency) {
    throw new DomainError('VALIDATION_FAILED', 'a conversion needs accounts in different currencies').at(
      '/conversion/counterAccountId',
    );
  }
  if (counterAmount.currency !== counter.currency) {
    throw new DomainError('VALIDATION_FAILED', 'the counter amount must be in the counterpart currency').at(
      '/conversion/counterAmount/currency',
    );
  }
  let counterMoney: Money;
  try {
    counterMoney = Money.parse(counterAmount.amount, makeCurrency(counter.currency, counter.scale));
  } catch (error) {
    throw error instanceof DomainError ? error.at('/conversion/counterAmount/amount') : error;
  }
  if (counterMoney.isZero() || counterMoney.isNegative()) {
    throw new DomainError('VALIDATION_FAILED', 'the counter amount must be positive').at(
      '/conversion/counterAmount/amount',
    );
  }
  const own = dec(input.amount);
  const other = dec(counterMoney.toJSON().amount);
  if (own.isZero()) {
    throw new DomainError('VALIDATION_FAILED', 'the row amount must be positive').at('/amount');
  }
  // La base del par es la moneda cuyo monto es MENOR (la divisa cara): 100.00 USD contra 696.00 BOB.
  const ownIsBase = own.lessThan(other);
  const base = ownIsBase ? input.accountCurrency : counter.currency;
  const quote = ownIsBase ? counter.currency : input.accountCurrency;
  const rate = ownIsBase ? other.div(own) : own.div(other);
  return { pair: `${base}/${quote}`, rate: rate.toString() };
}
