import { DomainError, Money, dec, type Currency, type Decimal, type LocalDate } from '@pf/shared-kernel';

/**
 * `EarmarkGuard` (openspec add-savings-goals, decisión 4; INV-018): una reserva nueva solo se acepta si
 * `reservado(cuenta) + monto ≤ saldo contable(cuenta)` (límite inclusivo). `reserved` suma reservas vigentes y aportes
 * reales netos que siguen en la cuenta (decisión 5).
 */
export function assertEarmarkWithinBalance(input: {
  readonly balance: Decimal;
  readonly reserved: Decimal;
  readonly amount: Decimal;
  readonly currency: Currency;
}): void {
  const { balance, reserved, amount, currency } = input;
  if (reserved.plus(amount).lte(balance)) return;
  const available = balance.minus(reserved);
  const money = (value: Decimal) => Money.roundToScale(value, currency).toJSON();
  throw new DomainError(
    'EARMARK_EXCEEDS_BALANCE',
    'the reservation exceeds the available balance of the account',
    {
      details: {
        balance: money(balance),
        reserved: money(reserved),
        available: money(available.isNegative() ? dec('0') : available),
      },
    },
  ).at('/amount');
}

/** Disponible para reservar: saldo contable − reservado (puede ser negativo si la cuenta está sobre-asignada). */
export const availableToReserve = (balance: Decimal, reserved: Decimal): Decimal => balance.minus(reserved);

// ───────────────────────────────────────────── episodios de sobre-asignación (decisión 6)

export type ReservationStateCode = 'NORMAL' | 'OVER_ALLOCATED';

export interface ReservationEpisodeState {
  readonly state: ReservationStateCode;
  readonly episodeId: string | null;
  readonly since: string | null;
  /** Faltante (reservado − saldo) con signo positivo; `null` en `NORMAL`. */
  readonly shortfall: string | null;
  readonly currency: string | null;
}

export const NORMAL_RESERVATION: ReservationEpisodeState = Object.freeze({
  state: 'NORMAL',
  episodeId: null,
  since: null,
  shortfall: null,
  currency: null,
});

export type EpisodeChange = 'OPENED' | 'UPDATED' | 'CLOSED' | 'UNCHANGED';

export interface EpisodeEvaluation {
  readonly next: ReservationEpisodeState;
  /** `OPENED` publica el hecho de sobre-asignación; `UPDATED` solo cambia el faltante; `CLOSED` quita la marca. */
  readonly change: EpisodeChange;
}

/**
 * `ReservationEpisode` (VO): `NORMAL → OVER_ALLOCATED` (episodio nuevo, un hecho), dentro del episodio solo cambia el
 * faltante y `OVER_ALLOCATED → NORMAL` cuando el saldo vuelve a cubrir lo reservado. Una cuenta sin nada reservado
 * nunca está sobre-asignada (aunque su saldo sea negativo).
 */
export function evaluateEpisode(
  current: ReservationEpisodeState,
  input: {
    readonly balance: Decimal;
    readonly reserved: Decimal;
    readonly currency: Currency;
    readonly today: LocalDate;
    readonly newEpisodeId: () => string;
  },
): EpisodeEvaluation {
  const over = input.reserved.gt(0) && input.reserved.gt(input.balance);
  if (!over) {
    return current.state === 'OVER_ALLOCATED'
      ? { next: NORMAL_RESERVATION, change: 'CLOSED' }
      : { next: current, change: 'UNCHANGED' };
  }
  const shortfall = Money.roundToScale(input.reserved.minus(input.balance), input.currency).toFixed();
  if (current.state === 'NORMAL') {
    return {
      next: {
        state: 'OVER_ALLOCATED',
        episodeId: input.newEpisodeId(),
        since: input.today.toString(),
        shortfall,
        currency: input.currency.code,
      },
      change: 'OPENED',
    };
  }
  return current.shortfall === shortfall
    ? { next: current, change: 'UNCHANGED' }
    : { next: { ...current, shortfall }, change: 'UPDATED' };
}
