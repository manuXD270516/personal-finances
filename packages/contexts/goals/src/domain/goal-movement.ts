import { DomainError, Money, dec, sumByCurrency, type Decimal } from '@pf/shared-kernel';
import type { GoalFund, MovementKind, MovementOrigin } from './goal-types.js';

/**
 * Movimiento de una meta (entidad append-only, openspec add-savings-goals decisión 2; INV-018). Monto FIRMADO en la
 * moneda de la cuenta: `CONTRIBUTION` y `REASSIGN_IN` > 0; `WITHDRAWAL` y `REASSIGN_OUT` < 0; `REVERSAL` con el signo
 * opuesto al del movimiento que invierte. La "liberación" de una reserva es `EARMARK + WITHDRAWAL`. Los movimientos
 * nunca se editan ni se borran: toda corrección es un movimiento inverso.
 */
export interface GoalMovement {
  readonly id: string;
  readonly goalId: string;
  readonly fund: GoalFund;
  readonly kind: MovementKind;
  readonly amount: Money;
  readonly accountId: string;
  readonly occurredOn: string;
  readonly transactionId: string | null;
  readonly transactionRevision: number | null;
  readonly reversesId: string | null;
  readonly reassignmentId: string | null;
  readonly origin: MovementOrigin;
  readonly note: string | null;
}

interface Common {
  readonly id: string;
  readonly goalId: string;
  readonly accountId: string;
  readonly occurredOn: string;
  readonly origin: MovementOrigin;
  readonly note?: string | null | undefined;
}

function positive(amount: Money, pointer = '/amount'): void {
  if (!amount.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be greater than zero').at(pointer);
  }
}

const noteOf = (note: string | null | undefined): string | null => {
  const text = note?.trim();
  return text ? text.slice(0, 500) : null;
};

/** Aporte (`amount` positivo): real respalda una transacción; la reserva no. */
export function contribution(
  input: Common & {
    readonly fund: GoalFund;
    readonly amount: Money;
    readonly transactionId?: string | null;
    readonly transactionRevision?: number | null;
  },
): GoalMovement {
  positive(input.amount);
  return build(input, 'CONTRIBUTION', input.amount);
}

/** Retiro o liberación (`amount` positivo en la entrada; se guarda negativo). */
export function withdrawal(
  input: Common & {
    readonly fund: GoalFund;
    readonly amount: Money;
    readonly transactionId?: string | null;
    readonly transactionRevision?: number | null;
  },
): GoalMovement {
  positive(input.amount);
  return build(input, 'WITHDRAWAL', input.amount.negate());
}

/** Movimiento inverso de `original` (mismo fondo, cuenta y transacción; signo opuesto). */
export function reversalOf(
  original: GoalMovement,
  input: {
    readonly id: string;
    readonly occurredOn: string;
    readonly origin: MovementOrigin;
    readonly note?: string;
  },
): GoalMovement {
  return {
    id: input.id,
    goalId: original.goalId,
    fund: original.fund,
    kind: 'REVERSAL',
    amount: original.amount.negate(),
    accountId: original.accountId,
    occurredOn: input.occurredOn,
    transactionId: original.transactionId,
    transactionRevision: original.transactionRevision,
    reversesId: original.id,
    reassignmentId: null,
    origin: input.origin,
    note: noteOf(input.note),
  };
}

/** Reasignación entre metas: un `REASSIGN_OUT` en el origen y un `REASSIGN_IN` en el destino, ligados entre sí. */
export function reassignment(input: {
  readonly reassignmentId: string;
  readonly outId: string;
  readonly inId: string;
  readonly fromGoalId: string;
  readonly toGoalId: string;
  readonly fund: GoalFund;
  readonly accountId: string;
  readonly amount: Money;
  readonly occurredOn: string;
  readonly note?: string | null | undefined;
}): { readonly out: GoalMovement; readonly in: GoalMovement } {
  positive(input.amount);
  if (input.fromGoalId === input.toGoalId) {
    throw new DomainError('VALIDATION_FAILED', 'the target goal must differ from the source goal').at(
      '/targetGoalId',
    );
  }
  const common = {
    fund: input.fund,
    accountId: input.accountId,
    occurredOn: input.occurredOn,
    transactionId: null,
    transactionRevision: null,
    reversesId: null,
    reassignmentId: input.reassignmentId,
    origin: 'USER' as const,
    note: noteOf(input.note),
  };
  return {
    out: {
      ...common,
      id: input.outId,
      goalId: input.fromGoalId,
      kind: 'REASSIGN_OUT',
      amount: input.amount.negate(),
    },
    in: { ...common, id: input.inId, goalId: input.toGoalId, kind: 'REASSIGN_IN', amount: input.amount },
  };
}

function build(
  input: Common & {
    readonly fund: GoalFund;
    readonly transactionId?: string | null | undefined;
    readonly transactionRevision?: number | null | undefined;
  },
  kind: MovementKind,
  amount: Money,
): GoalMovement {
  const backed = input.fund === 'REAL';
  if (backed && (!input.transactionId || !input.transactionRevision)) {
    throw new DomainError('INTERNAL_ERROR', 'a real movement needs its backing transaction');
  }
  if (!backed && input.transactionId) {
    throw new DomainError('INTERNAL_ERROR', 'an earmark movement never references a transaction');
  }
  return {
    id: input.id,
    goalId: input.goalId,
    fund: input.fund,
    kind,
    amount,
    accountId: input.accountId,
    occurredOn: input.occurredOn,
    transactionId: backed ? (input.transactionId ?? null) : null,
    transactionRevision: backed ? (input.transactionRevision ?? null) : null,
    reversesId: null,
    reassignmentId: null,
    origin: input.origin,
    note: noteOf(input.note),
  };
}

/** Signo coherente con el tipo (espejo del CHECK `goal_movement_sign_ck`). */
export function assertSignConsistent(m: Pick<GoalMovement, 'kind' | 'amount'>): void {
  const ok =
    m.kind === 'CONTRIBUTION' || m.kind === 'REASSIGN_IN'
      ? m.amount.isPositive()
      : m.kind === 'WITHDRAWAL' || m.kind === 'REASSIGN_OUT'
        ? m.amount.isNegative()
        : !m.amount.isZero();
  if (!ok) throw new DomainError('INTERNAL_ERROR', `movement ${m.kind} has an inconsistent sign`);
}

/**
 * Fondos de una meta (decisión 2): saldo por `(cuenta, fondo)` = Σ de sus movimientos; saldo acumulado por moneda =
 * Σ de todos. Funciones puras sobre la lista de movimientos (la fuente de verdad, INV-018).
 */
export class GoalFunds {
  constructor(readonly movements: readonly GoalMovement[]) {}

  /** Σ firmada de los movimientos de `(cuenta, fondo)`. */
  balance(accountId: string, fund: GoalFund): Decimal {
    let total = dec('0');
    for (const m of this.movements) {
      if (m.accountId === accountId && m.fund === fund) total = total.plus(m.amount.amount);
    }
    return total;
  }

  /** Σ por moneda de todos los movimientos (saldo acumulado antes de convertir). */
  totalsByCurrency(): Money[] {
    return sumByCurrency(this.movements.map((m) => m.amount)).filter((m) => !m.isZero());
  }

  /** Cuentas con movimientos y su saldo por fondo (para el reservado por cuenta). */
  byAccount(): ReadonlyMap<string, { earmarked: Decimal; realHeld: Decimal }> {
    const out = new Map<string, { earmarked: Decimal; realHeld: Decimal }>();
    for (const m of this.movements) {
      const row = out.get(m.accountId) ?? { earmarked: dec('0'), realHeld: dec('0') };
      if (m.fund === 'EARMARK') row.earmarked = row.earmarked.plus(m.amount.amount);
      else row.realHeld = row.realHeld.plus(m.amount.amount);
      out.set(m.accountId, row);
    }
    return out;
  }

  /** Aportes y retiros vigentes (los no invertidos), útiles para reaccionar a una anulación o revisión. */
  liveByTransaction(transactionId: string): GoalMovement[] {
    const reversed = new Set(
      this.movements.map((m) => m.reversesId).filter((id): id is string => id !== null),
    );
    return this.movements.filter(
      (m) =>
        m.transactionId === transactionId &&
        (m.kind === 'CONTRIBUTION' || m.kind === 'WITHDRAWAL') &&
        !reversed.has(m.id),
    );
  }

  /** `amount ≤ fondos(cuenta, fondo)`; si no, `GOAL_INSUFFICIENT_FUNDS` (aunque el saldo de la cuenta alcance). */
  assertSufficient(accountId: string, fund: GoalFund, amount: Money): void {
    const held = this.balance(accountId, fund);
    if (amount.amount.lte(held)) return;
    throw new DomainError('GOAL_INSUFFICIENT_FUNDS', 'the goal does not hold enough funds in that account', {
      details: {
        fund,
        held: Money.roundToScale(held.isNegative() ? dec('0') : held, amount.currency).toJSON(),
        requested: amount.toJSON(),
      },
    }).at('/amount');
  }
}
