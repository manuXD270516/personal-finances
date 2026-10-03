import { DomainError, type Money, type LocalDate } from '@pf/shared-kernel';
import { isNominal, type LedgerAccountRef } from './ledger-account.js';

/** Tipos de asiento (docs/09 §3). */
export type EntryType = 'STANDARD' | 'REVERSAL' | 'OPENING';

/**
 * Origen del asiento (FR-LEDGER-009/010): idempotencia por `(type, id, revision, entryType)`. El contrato
 * `ledger.JournalEntryPosted.v1` fija `context = TRANSACTIONS` y `type = Transaction` en Phase 1.
 */
export interface SourceRef {
  readonly context: 'TRANSACTIONS';
  readonly type: 'Transaction';
  readonly id: string;
  readonly revision: number;
}

export interface PostingInput {
  readonly id: string;
  readonly account: LedgerAccountRef;
  readonly amount: Money;
  readonly splitId: string | null;
}

/** Entidad `Posting`: débito positivo, crédito negativo (FR-LEDGER-002). Inmutable. */
export interface Posting extends PostingInput {
  readonly lineNo: number;
}

export interface JournalEntryInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly entryDate: LocalDate;
  readonly entryType: EntryType;
  readonly sourceRef: SourceRef;
  readonly reversesEntryId: string | null;
  readonly memo: string | null;
  readonly correlationId: string | null;
  readonly createdBy: string | null;
  readonly postings: readonly PostingInput[];
}

/** Contexto de validación que el dominio no puede calcular solo (lo aporta el caso de uso en la misma transacción). */
export interface ValidationContext {
  /** ¿La `entryDate` cae en un periodo bloqueado del workspace? (INV-015) */
  readonly periodLocked: boolean;
}

/** `LEDGER_UNBALANCED_ENTRY` con el residuo de cada moneda desbalanceada (INV-004). */
export class UnbalancedEntryError extends DomainError {
  override readonly name = 'UnbalancedEntryError';
  constructor(readonly residues: readonly Money[]) {
    super('LEDGER_UNBALANCED_ENTRY', `entry is unbalanced: ${residues.map(signed).join(', ')}`);
  }
}

const signed = (m: Money): string => `${m.isNegative() ? '' : '+'}${m.toString()}`;

/** Σ exacta por moneda (orden de primera aparición). */
export function totalsByCurrency(amounts: readonly Money[]): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const a of amounts) {
    const prev = totals.get(a.currency.code);
    totals.set(a.currency.code, prev ? prev.add(a) : a);
  }
  return totals;
}

/**
 * DS `EntryValidator` (design.md §Decisiones 2): devuelve el PRIMER error en este orden, o `null`:
 * workspace único (INV-025, `REFERENCE_NOT_FOUND`) → ≥ 2 postings → ningún monto cero (INV-005) → escala por moneda
 * (INV-003) → moneda del posting = moneda de la cuenta (INV-006) → split en postings nominales → Σ por moneda = 0
 * (INV-004) → periodo abierto (INV-015). Estos errores delatan bugs del traductor, no entrada de usuario.
 */
export const EntryValidator = {
  validate(input: JournalEntryInput, ctx: ValidationContext): DomainError | null {
    for (const p of input.postings) {
      if (p.account.workspaceId !== input.workspaceId) {
        return new DomainError('REFERENCE_NOT_FOUND', `ledger account ${p.account.id} not found`);
      }
    }
    if (input.postings.length < 2) {
      return new DomainError('LEDGER_ENTRY_TOO_FEW_POSTINGS', `an entry needs at least 2 postings`);
    }
    if (input.postings.some((p) => p.amount.isZero())) {
      return new DomainError('LEDGER_ZERO_AMOUNT_POSTING', 'postings must be non-zero');
    }
    for (const p of input.postings) {
      if (p.amount.amount.decimalPlaces() > p.account.currency.scale) {
        return new DomainError(
          'AMOUNT_SCALE_EXCEEDED',
          `${p.account.currency.code} allows ${p.account.currency.scale} decimals`,
        );
      }
    }
    for (const p of input.postings) {
      if (
        p.amount.currency.code !== p.account.currency.code ||
        p.amount.currency.scale !== p.account.currency.scale
      ) {
        return new DomainError(
          'CURRENCY_MISMATCH',
          `posting in ${p.amount.currency.code} against ledger account in ${p.account.currency.code}`,
        );
      }
    }
    for (const p of input.postings) {
      if (isNominal(p.account.nature) && p.splitId === null) {
        return new DomainError(
          'LEDGER_SPLIT_REQUIRED',
          `posting to ${p.account.code.value} requires a split`,
        );
      }
    }
    const residues = [...totalsByCurrency(input.postings.map((p) => p.amount)).values()].filter(
      (m) => !m.isZero(),
    );
    if (residues.length > 0) return new UnbalancedEntryError(residues);
    if ((input.entryType === 'REVERSAL') !== (input.reversesEntryId !== null)) {
      return new DomainError('INTERNAL_ERROR', 'only REVERSAL entries reference the reversed entry');
    }
    if (ctx.periodLocked) {
      return new DomainError('PERIOD_CLOSED', `${input.entryDate.toString()} is in a closed period`);
    }
    return null;
  },
};

/**
 * AR `JournalEntry` (docs/09 §3–§5): asiento balanceado por moneda, append-only. Solo se construye validado
 * (`post`) o rehidratado desde la BD (`restore`, que también valida la estructura salvo el periodo). Nunca se
 * modifica: la corrección es una reversa (`ReversalFactory`).
 */
export class JournalEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly entryDate: LocalDate;
  readonly entryType: EntryType;
  readonly sourceRef: SourceRef;
  readonly reversesEntryId: string | null;
  readonly memo: string | null;
  readonly correlationId: string | null;
  readonly createdBy: string | null;
  readonly postings: readonly Posting[];
  /** Asignada por la BD (`bigint IDENTITY`, como string); `null` antes de persistir. */
  readonly sequence: string | null;

  private constructor(input: JournalEntryInput, sequence: string | null) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.entryDate = input.entryDate;
    this.entryType = input.entryType;
    this.sourceRef = Object.freeze({ ...input.sourceRef });
    this.reversesEntryId = input.reversesEntryId;
    this.memo = input.memo;
    this.correlationId = input.correlationId;
    this.createdBy = input.createdBy;
    this.postings = Object.freeze(input.postings.map((p, i) => Object.freeze({ ...p, lineNo: i + 1 })));
    this.sequence = sequence;
    Object.freeze(this);
  }

  /** Valida y crea el asiento; lanza el primer `DomainError` del `EntryValidator`. */
  static post(input: JournalEntryInput, ctx: ValidationContext): JournalEntry {
    const error = EntryValidator.validate(input, ctx);
    if (error) throw error;
    return new JournalEntry(input, null);
  }

  /** Rehidrata un asiento ya registrado (el periodo se validó al registrarlo). */
  static restore(input: JournalEntryInput, sequence: string): JournalEntry {
    const error = EntryValidator.validate(input, { periodLocked: false });
    if (error) throw new DomainError('INTERNAL_ERROR', `stored entry ${input.id} violates ${error.code}`);
    return new JournalEntry(input, sequence);
  }

  withSequence(sequence: string): JournalEntry {
    return new JournalEntry(this, sequence);
  }

  totalsByCurrency(): Map<string, Money> {
    return totalsByCurrency(this.postings.map((p) => p.amount));
  }
}
