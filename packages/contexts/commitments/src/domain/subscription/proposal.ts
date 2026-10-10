import { DomainError, type Money } from '@pf/shared-kernel';
import type { ChargeOutcome } from './price-change-detector.js';

export const PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * Propuesta de precio creada por la detección (FR-COMMITMENTS-014): el EDITOR la acepta o la rechaza. A lo sumo una
 * `PENDING` por suscripción; la vigencia propuesta es la fecha nominal del cargo que la originó.
 */
export interface PriceChangeProposal {
  readonly id: string;
  readonly subscriptionId: string;
  readonly chargeId: string;
  readonly effectiveFrom: string;
  readonly previousPrice: Money;
  readonly proposedPrice: Money;
  /** Variación con signo (`+20.02`). */
  readonly changePercent: string;
  readonly status: ProposalStatus;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  /** Hecho `SubscriptionPriceChanged.v1` publicado al crearla (o `null` si aún no). */
  readonly eventId: string | null;
}

/** Decidir (aceptar o rechazar) exige `PENDING`; si no, `SUBSCRIPTION_PROPOSAL_NOT_PENDING` (409). */
export function assertPending(proposal: Pick<PriceChangeProposal, 'status'>): void {
  if (proposal.status !== 'PENDING') {
    throw new DomainError(
      'SUBSCRIPTION_PROPOSAL_NOT_PENDING',
      `the price proposal is ${proposal.status}, not PENDING`,
    );
  }
}

/** Cargo de la suscripción vinculado a una transacción (un cargo vigente por ocurrencia). */
export interface SubscriptionCharge {
  readonly id: string;
  readonly subscriptionId: string;
  readonly occurrenceId: string;
  /** Fecha nominal de la ocurrencia (clave de la vigencia propuesta). */
  readonly occurrenceDate: string;
  readonly transactionId: string;
  /** Monto de la transacción, en la moneda de la cuenta. */
  readonly charged: Money;
  /** Monto del extracto en la moneda del precio, indicado por el EDITOR (solo útil entre monedas distintas). */
  readonly priceCurrencyAmount: Money | null;
  /** Precio vigente en la fecha nominal. */
  readonly expectedPrice: Money;
  readonly impliedRate: string | null;
  readonly deviationPercent: string | null;
  readonly outcome: ChargeOutcome;
}

export type ProposalAction =
  | { readonly action: 'NONE' }
  | { readonly action: 'INSERT'; readonly supersedePendingId: string | null }
  | { readonly action: 'REVIVE'; readonly proposalId: string; readonly supersedePendingId: string | null };

/**
 * Qué hacer con una detección nueva (decisión 8): ya hay propuesta para esa vigencia (decidida o pendiente) ⇒ nada
 * (idempotencia de negocio); una retirada (`WITHDRAWN`, el cargo se liberó) se revive; si hay otra pendiente con el
 * MISMO monto propuesto ⇒ nada; con otro monto, la pendiente pasa a `SUPERSEDED` y se inserta la nueva.
 */
export function decideProposal(input: {
  readonly existing: readonly PriceChangeProposal[];
  readonly effectiveFrom: string;
  readonly proposedPrice: Money;
}): ProposalAction {
  const sameDate = input.existing.find((p) => p.effectiveFrom === input.effectiveFrom);
  const pending = input.existing.find(
    (p) => p.status === 'PENDING' && p.effectiveFrom !== input.effectiveFrom,
  );
  if (sameDate !== undefined && sameDate.status !== 'WITHDRAWN') return { action: 'NONE' };
  if (pending !== undefined && pending.proposedPrice.equals(input.proposedPrice)) return { action: 'NONE' };
  const supersedePendingId = pending?.id ?? null;
  return sameDate !== undefined
    ? { action: 'REVIVE', proposalId: sameDate.id, supersedePendingId }
    : { action: 'INSERT', supersedePendingId };
}
