import type { LocalDate, Money } from '@pf/shared-kernel';
import type { CardStatementStatus } from './card-types.js';

/**
 * `NextDueResolver` (openspec fix-phase-4-gaps, decisión 2; capability `debt/credit-cards`, requirement "Próximo
 * vencimiento de la tarjeta"): próximo vencimiento de una cuenta de tarjeta y estados de cuenta atrasados. Puro y
 * determinista.
 *
 * `nextDueDate` = la fecha de vencimiento más cercana NO anterior a hoy entre los estados de cuenta EMITIDOS a los que
 * les falta algo para no generar intereses y el ciclo abierto. Los ciclos cerrados sin estado emitido (anteriores al
 * registro de la tarjeta) nunca cuentan. Un estado emitido con faltante cuyo vencimiento ya pasó se informa aparte
 * (`overdue`), con su estado y lo que falta. El ciclo abierto siempre vence después de hoy, así que el resultado nunca
 * es nulo.
 */
export interface DueCycle {
  readonly closingDate: LocalDate;
  readonly dueDate: LocalDate;
  /** Ciclo en curso (aún sin cerrar). */
  readonly open: boolean;
  /** `true` si el ciclo tiene estado de cuenta emitido (registro persistido). */
  readonly issued: boolean;
  /** Situación del ciclo cerrado (nulo en el abierto). */
  readonly standing: {
    readonly status: Exclude<CardStatementStatus, 'OPEN'>;
    readonly remainingNoInterest: Money;
    readonly remainingMinimum: Money;
  } | null;
}

export interface OverdueStatement {
  readonly closingDate: LocalDate;
  readonly dueDate: LocalDate;
  readonly status: Exclude<CardStatementStatus, 'OPEN'>;
  readonly remainingNoInterest: Money;
  readonly remainingMinimum: Money;
}

export interface NextDue {
  readonly nextDueDate: LocalDate;
  /** Más antiguos primero. */
  readonly overdue: readonly OverdueStatement[];
}

export function resolveNextDue(input: {
  readonly cycles: readonly DueCycle[];
  readonly today: LocalDate;
}): NextDue {
  const { today } = input;
  const candidates: LocalDate[] = [];
  const overdue: OverdueStatement[] = [];
  for (const c of input.cycles) {
    if (c.open) {
      candidates.push(c.dueDate);
      continue;
    }
    if (!c.issued || !c.standing || !c.standing.remainingNoInterest.isPositive()) continue;
    if (c.dueDate.compare(today) < 0) {
      overdue.push({
        closingDate: c.closingDate,
        dueDate: c.dueDate,
        status: c.standing.status,
        remainingNoInterest: c.standing.remainingNoInterest,
        remainingMinimum: c.standing.remainingMinimum,
      });
    } else {
      candidates.push(c.dueDate);
    }
  }
  overdue.sort((a, b) => a.dueDate.compare(b.dueDate));
  const upcoming = candidates.filter((d) => d.compare(today) >= 0).sort((a, b) => a.compare(b));
  // El ciclo abierto cierra hoy o después y vence tras el cierre: nunca queda sin fecha.
  const first = upcoming[0];
  if (first === undefined)
    throw new Error('NextDueResolver requires an open cycle that is due today or later');
  return { nextDueDate: first, overdue };
}
