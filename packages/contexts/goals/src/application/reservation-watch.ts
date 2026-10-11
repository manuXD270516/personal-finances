import { LocalDate, Money, currency as makeCurrency, dec, type Decimal } from '@pf/shared-kernel';
import { GOALS_EVENTS, type EarmarkExceedsBalanceV1 } from '../contracts/index.js';
import { RESERVING_STATUSES, evaluateEpisode, type ReservationEpisodeState } from '../domain/index.js';
import type { GoalsDeps, FundRow } from './ports/index.js';
import { ACCOUNT_AGGREGATE, RESERVATION_AGGREGATE, publishEvent } from './recorder.js';
import { moneyDto } from './views.js';

/** Reservado de una cuenta: Σ de los movimientos de metas `ACTIVE`, `PAUSED` o `ACHIEVED` (ambos fondos). */
export function reservedOf(rows: readonly FundRow[]): {
  readonly reserved: Decimal;
  readonly earmarked: Decimal;
  readonly realHeld: Decimal;
} {
  let earmarked = dec('0');
  let realHeld = dec('0');
  for (const r of rows) {
    if (!RESERVING_STATUSES.includes(r.goalStatus)) continue;
    if (r.fund === 'EARMARK') earmarked = earmarked.plus(dec(r.amount));
    else realHeld = realHeld.plus(dec(r.amount));
  }
  return { reserved: earmarked.plus(realHeld), earmarked, realHeld };
}

/**
 * Vigilancia de la sobre-asignación por cuenta (openspec add-savings-goals, decisión 6; INV-018 "vigilado después"):
 * compara el saldo contable con lo reservado bajo `SELECT … FOR UPDATE` de la fila `account_reservation_state` y
 * abre, actualiza o cierra el episodio. Un hecho `goals.EarmarkExceedsBalance.v1` por episodio nuevo; dentro del
 * episodio solo cambia el faltante. Las transacciones pendientes no generan asiento, así que no la disparan.
 */
export class ReservationWatch {
  constructor(private readonly deps: GoalsDeps) {}

  /** Reevalúa las cuentas (orden estable); las que no tienen fondos de metas ni estado previo no se tocan. */
  async evaluateAccounts(workspaceId: string, accountIds: readonly string[]): Promise<void> {
    const ids = [...new Set(accountIds)].sort();
    for (const accountId of ids) {
      await this.evaluateAccount(workspaceId, accountId);
    }
  }

  async evaluateAccount(workspaceId: string, accountId: string): Promise<void> {
    const { deps } = this;
    const [existing] = await deps.reservations.states(workspaceId, [accountId]);
    const funds = await deps.movements.funds(workspaceId, { accountIds: [accountId] });
    const { reserved } = reservedOf(funds);
    if (!existing && reserved.lte(0)) return;
    // Bloquea la fila (get-or-create) y relee: la vigilancia y las reservas se serializan por cuenta.
    const state = await deps.reservations.lock(workspaceId, accountId);
    const [account] = await deps.accounts.find(workspaceId, [accountId]);
    if (!account) return;
    const balances = await deps.balances.presentedBalances(workspaceId, [accountId]);
    const balance = dec(balances.get(accountId) ?? '0');
    const calendar = await deps.calendar.calendarOf(workspaceId);
    const today = LocalDate.ofInstant(deps.clock.now(), calendar.timeZone);
    const scale = (await deps.currencies.scaleOf(account.currency)) ?? 2;
    const currency = makeCurrency(account.currency, scale);
    const result = evaluateEpisode(state, {
      balance,
      reserved,
      currency,
      today,
      newEpisodeId: () => deps.ids.next(),
    });
    if (result.change === 'UNCHANGED') return;
    const next: ReservationEpisodeState = result.next;
    const record = { ...next, accountId, version: state.version + 1 };
    await deps.reservations.save(workspaceId, record, deps.clock.now().toString());
    if (result.change === 'OPENED') {
      const goals = new Map<string, { name: string; reserved: Decimal }>();
      for (const f of funds) {
        if (!RESERVING_STATUSES.includes(f.goalStatus)) continue;
        const prev = goals.get(f.goalId) ?? { name: f.goalName, reserved: dec('0') };
        goals.set(f.goalId, { name: f.goalName, reserved: prev.reserved.plus(dec(f.amount)) });
      }
      const payload: EarmarkExceedsBalanceV1 = {
        accountId,
        accountName: account.name,
        episodeId: next.episodeId as string,
        balance: moneyDto(Money.roundToScale(balance, currency)),
        reserved: moneyDto(Money.roundToScale(reserved, currency)),
        shortfall: { amount: next.shortfall as string, currency: currency.code },
        detectedOn: today.toString(),
        goals: [...goals.entries()]
          .filter(([, g]) => g.reserved.gt(0))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([goalId, g]) => ({
            goalId,
            goalName: g.name,
            reserved: moneyDto(Money.roundToScale(g.reserved, currency)),
          })),
      };
      await publishEvent(
        deps,
        {
          workspaceId,
          aggregateType: ACCOUNT_AGGREGATE,
          aggregateId: accountId,
          aggregateVersion: record.version,
        },
        GOALS_EVENTS.earmarkExceedsBalance,
        payload,
      );
    }
    if (result.change === 'OPENED' || result.change === 'CLOSED') {
      const refShortfall = result.change === 'OPENED' ? next.shortfall : state.shortfall;
      await deps.audit.append({
        workspaceId,
        action:
          result.change === 'OPENED' ? 'goals.reservation.over_allocated' : 'goals.reservation.resolved',
        aggregateType: RESERVATION_AGGREGATE,
        aggregateId: accountId,
        aggregateVersion: record.version,
        changes: [
          { field: 'state', before: state.state, after: next.state },
          { field: 'episodeId', before: state.episodeId, after: next.episodeId },
          refShortfall
            ? { field: 'shortfall', before: null, after: { amount: refShortfall, currency: currency.code } }
            : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null),
      });
    }
  }
}
