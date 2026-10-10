import { Instant, LocalDate, type Money } from '@pf/shared-kernel';

/** Egreso resuelto por una transacción no anulada (COMMITMENTS, `ResolvedOccurrencesQuery`), ya con `Money`. */
export interface ResolvedOutflowInput {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  /** Instante en que se generó la ocurrencia. */
  readonly generatedAt: string;
  readonly transactionId: string;
  readonly transactionDate: string;
  readonly amount: Money;
}

export interface SurprisePayment {
  readonly transactionId: string;
  readonly date: string;
  readonly name: string;
  readonly amount: Money;
  readonly occurrenceId: string;
  readonly definitionId: string;
  /** Fecha local (zona del workspace) en que se generó la ocurrencia. */
  readonly generatedOn: string;
}

/**
 * DS `SurprisePaymentClassifier` (design.md decisión 10, SM-07): un pago es sorpresa cuando la ocurrencia que resolvió se
 * generó el MISMO día de la transacción o después (en la fecha local del workspace): no estaba en la lista antes de
 * pagarse. Solo cuentan las transacciones con fecha en el periodo; las omitidas y las anuladas no llegan (COMMITMENTS).
 * Un periodo que no terminó (hoy no pasó de su fin) es parcial.
 */
export const SurprisePaymentClassifier = {
  classify(input: {
    readonly resolved: readonly ResolvedOutflowInput[];
    readonly timeZone: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly today: string;
  }): { readonly items: SurprisePayment[]; readonly partial: boolean } {
    const items: SurprisePayment[] = [];
    for (const r of input.resolved) {
      if (r.transactionDate < input.periodStart || r.transactionDate > input.periodEnd) continue;
      const generatedOn = LocalDate.ofInstant(Instant.parse(r.generatedAt), input.timeZone).toString();
      if (generatedOn < r.transactionDate) continue;
      items.push({
        transactionId: r.transactionId,
        date: r.transactionDate,
        name: r.definitionName,
        amount: r.amount,
        occurrenceId: r.occurrenceId,
        definitionId: r.definitionId,
        generatedOn,
      });
    }
    items.sort((a, b) =>
      a.date === b.date ? a.transactionId.localeCompare(b.transactionId) : a.date < b.date ? -1 : 1,
    );
    return { items, partial: input.today <= input.periodEnd };
  },
} as const;
