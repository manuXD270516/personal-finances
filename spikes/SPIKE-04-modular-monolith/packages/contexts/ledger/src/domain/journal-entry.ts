import { DomainError, Money } from '@pf/shared-kernel';

/** Límite de importe por línea (invariante del ledger; Accounts no lo conoce). */
export const MAX_LINE_MINOR = 10n ** 15n;

export interface JournalLine {
  readonly ledgerAccountRef: string;
  /** Positivo = débito, negativo = crédito. */
  readonly amount: Money;
}

/** Agregado JournalEntry: framework-free, sin I/O. Invariante: balanceado por moneda. */
export class JournalEntry {
  private constructor(
    readonly id: string,
    readonly lines: readonly JournalLine[],
    readonly description: string,
  ) {}

  static post(props: { id: string; description: string; lines: JournalLine[] }): JournalEntry {
    if (props.lines.length < 2) {
      throw new DomainError('LEDGER_TOO_FEW_LINES', 'Un asiento necesita al menos dos líneas');
    }
    const totals = new Map<string, Money>();
    for (const line of props.lines) {
      if (line.amount.isZero()) throw new DomainError('LEDGER_ZERO_LINE', 'Línea con importe cero');
      const abs = line.amount.minor < 0n ? -line.amount.minor : line.amount.minor;
      if (abs > MAX_LINE_MINOR) throw new DomainError('LEDGER_AMOUNT_OUT_OF_RANGE', 'Importe fuera de rango');
      const prev = totals.get(line.amount.currency) ?? Money.zero(line.amount.currency);
      totals.set(line.amount.currency, prev.add(line.amount));
    }
    for (const [currency, total] of totals) {
      if (!total.isZero()) {
        throw new DomainError('LEDGER_UNBALANCED', `Asiento desbalanceado en ${currency}: ${total.minor}`);
      }
    }
    return new JournalEntry(props.id, [...props.lines], props.description);
  }
}

/** Puerto de persistencia (lo implementa infrastructure). */
export interface JournalEntryRepository {
  save(entry: JournalEntry): Promise<void>;
  list(): Promise<JournalEntry[]>;
}
