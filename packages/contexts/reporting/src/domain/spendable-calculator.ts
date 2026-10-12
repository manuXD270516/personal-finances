import { dec, Money, type Currency, type Decimal } from '@pf/shared-kernel';
import { ConsolidationService } from './consolidation-service.js';
import { present, type ExactRate } from './valuation.js';

/** Cuenta líquida (`ASSET` + `LIQUID`, no archivada; D35) con su saldo contable. */
export interface SpendableAccount {
  readonly accountId: string;
  readonly name: string;
  readonly balance: Money;
}

/** Reservado por metas en una cuenta (`GoalReservationsQuery.getReservedByAccount`), en la moneda de la cuenta. */
export interface SpendableReservation {
  readonly accountId: string;
  readonly reserved: Money;
}

/**
 * Ítem de egreso que informa COMMITMENTS (`CommittedQuery.listForSpendable`): ocurrencia no resuelta o transacción
 * `PENDING`, con la liquidez de su cuenta de origen y de destino.
 */
export interface SpendableCommittedItem {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: string;
  /** Vencimiento (ocurrencia) o fecha de negocio (pendiente). */
  readonly date: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly sourceLiquid: boolean;
  readonly targetLiquid: boolean | null;
  readonly managedBy: string | null;
  /** Monto que suma (máximo en `MIN_MAX`); `null` si es `VARIABLE` (D115). */
  readonly amount: Money | null;
  readonly overdueFromPrevious: boolean;
}

/** Aporte planificado pendiente de una meta `ACTIVE` con plan (`GoalPlansQuery.getForPeriod`), en la moneda de la meta. */
export interface SpendablePlanned {
  readonly goalId: string;
  readonly goalName: string;
  readonly pending: Money;
}

export interface SpendableInput {
  /** Periodo financiero vigente `[from, to]` (fechas de negocio inclusivas). */
  readonly period: { readonly from: string; readonly to: string };
  readonly liquidAccounts: readonly SpendableAccount[];
  readonly reservations: readonly SpendableReservation[];
  readonly committed: readonly SpendableCommittedItem[];
  readonly planned: readonly SpendablePlanned[];
  /** Reserva mínima de liquidez (FR-IDENTITY-005); `null` ⇒ término omitido. */
  readonly minimumReserve: Money | null;
}

/** Términos del disponible de una moneda; todos en la moneda `spendable.currency`, sin redondeo intermedio. */
export interface SpendableTerms {
  readonly currency: Currency;
  readonly liquid: Money;
  readonly reservedForGoals: Money;
  readonly committed: Money;
  readonly plannedGoalContributions: Money;
  /** `null` si el workspace no tiene reserva mínima en esta moneda (no se muestra el término). */
  readonly minimumReserve: Money | null;
  /** `liquid − reservedForGoals − committed − plannedGoalContributions − minimumReserve`. */
  readonly spendable: Money;
}

export interface SpendableReservedLine {
  readonly accountId: string;
  readonly name: string;
  readonly balance: Money;
  /** Lo que reservan las metas en la cuenta. */
  readonly reserved: Money;
  /** Lo que resta del disponible: `min(max(saldo, 0), reservado)` (D216). */
  readonly counted: Money;
}

export interface SpendableResult {
  readonly byCurrency: readonly SpendableTerms[];
  /** Ítems que restan del comprometido (con monto), ordenados por fecha. */
  readonly committedItems: readonly SpendableCommittedItem[];
  /** Ocurrencias o pendientes `VARIABLE` que NO restan (D115). */
  readonly withoutAmountCount: number;
  readonly reservedByAccount: readonly SpendableReservedLine[];
  readonly planned: readonly SpendablePlanned[];
}

export interface SpendableConsolidation {
  readonly total: Decimal;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
  /** Monedas con disponible negativo que el consolidado positivo oculta; vacío si el consolidado es negativo. */
  readonly shortfalls: readonly Money[];
  /** `WARNING` si el consolidado es negativo (se muestra con signo y desglose, nunca 0.00). */
  readonly status: 'OK' | 'WARNING';
}

/**
 * ¿El ítem resta del disponible? (design.md decisión 5, D127, D115, D211, D212, D213):
 *   - solo se pagan desde una cuenta LÍQUIDA (una compra con tarjeta se descuenta al pagar la tarjeta);
 *   - un egreso (`EXPENSE`) y una cuota de préstamo (`LOAN_PAYMENT`) restan; una transferencia o pago de tarjeta solo si
 *     va de una cuenta líquida a una que no lo es (entre líquidas no cambia el dinero);
 *   - los administrados por una meta (`managedBy = GOAL`) los cubre el término de aportes planificados (sin doble conteo);
 *   - posteriores al fin del periodo no restan.
 */
function countsTowardsSpendable(item: SpendableCommittedItem, periodTo: string): boolean {
  if (item.date > periodTo) return false;
  if (item.managedBy === 'GOAL') return false;
  if (!item.sourceLiquid) return false;
  switch (item.kind) {
    case 'EXPENSE':
    case 'LOAN_PAYMENT':
      return true;
    case 'TRANSFER':
    case 'CARD_PAYMENT':
      return item.targetLiquid === false;
    default:
      return false;
  }
}

/**
 * DS `SpendableCalculator` (openspec add-spendable-amount, design.md decisiones 2 a 9; FR-PLANNING-024, docs/00 §6 Q5):
 * el disponible para gastar libre de compromisos del periodo, por moneda y SIN redondeo:
 *   `disponible_c = líquido_c − reservadoMetas_c − comprometido_c − aportesPlanificados_c − reservaMínima_c`.
 * Los ingresos esperados no suman (conservador, docs/14 §4.2). Puro y determinista: sin reloj, sin E/S.
 */
export const SpendableCalculator = {
  calculate(input: SpendableInput): SpendableResult {
    const { period } = input;
    const currencies = new Map<string, Currency>();
    const note = (m: Money) => currencies.set(m.currency.code, m.currency);
    const total = (list: readonly Money[], c: Currency) => list.reduce((acc, m) => acc.add(m), Money.zero(c));
    const byCode = <T>(list: readonly T[], moneyOf: (t: T) => Money) => {
      const map = new Map<string, Money[]>();
      for (const t of list) {
        const m = moneyOf(t);
        note(m);
        map.set(m.currency.code, [...(map.get(m.currency.code) ?? []), m]);
      }
      return map;
    };

    // ---- reservado por metas: tope en el saldo de cada cuenta líquida (D216); cuentas no líquidas no restan
    const reservedBy = new Map<string, Money>();
    for (const r of input.reservations) {
      const prev = reservedBy.get(r.accountId);
      reservedBy.set(r.accountId, prev ? prev.add(r.reserved) : r.reserved);
    }
    const reservedByAccount: SpendableReservedLine[] = [];
    for (const a of input.liquidAccounts) {
      const reserved = reservedBy.get(a.accountId);
      if (!reserved || reserved.isZero()) continue;
      const available = a.balance.isPositive() ? a.balance : Money.zero(a.balance.currency);
      const counted = reserved.compare(available) < 0 ? reserved : available;
      reservedByAccount.push({ accountId: a.accountId, name: a.name, balance: a.balance, reserved, counted });
    }

    // ---- comprometido: solo desde cuentas líquidas, sin metas, sin compromisos sin monto
    const counted: SpendableCommittedItem[] = [];
    let withoutAmountCount = 0;
    for (const item of input.committed) {
      if (!countsTowardsSpendable(item, period.to)) continue;
      if (item.amount === null) {
        withoutAmountCount += 1;
        continue;
      }
      counted.push(item);
    }
    counted.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));

    // ---- aportes planificados pendientes (no negativos)
    const planned = input.planned.filter((p) => p.pending.isPositive());

    const liquidBy = byCode(input.liquidAccounts, (a) => a.balance);
    const reservedTerms = byCode(reservedByAccount, (r) => r.counted);
    const committedBy = byCode(counted, (i) => i.amount as Money);
    const plannedBy = byCode(planned, (p) => p.pending);
    if (input.minimumReserve) note(input.minimumReserve);

    const codes = [...currencies.keys()].sort();
    const byCurrency = codes.map((code): SpendableTerms => {
      const c = currencies.get(code) as Currency;
      const liquid = total(liquidBy.get(code) ?? [], c);
      const reservedForGoals = total(reservedTerms.get(code) ?? [], c);
      const committed = total(committedBy.get(code) ?? [], c);
      const plannedGoalContributions = total(plannedBy.get(code) ?? [], c);
      const minimumReserve = input.minimumReserve?.currency.code === code ? input.minimumReserve : null;
      let spendable = liquid
        .subtract(reservedForGoals)
        .subtract(committed)
        .subtract(plannedGoalContributions);
      if (minimumReserve) spendable = spendable.subtract(minimumReserve);
      return {
        currency: c,
        liquid,
        reservedForGoals,
        committed,
        plannedGoalContributions,
        minimumReserve,
        spendable,
      };
    });
    return { byCurrency, committedItems: counted, withoutAmountCount, reservedByAccount, planned };
  },

  /**
   * Consolida el disponible de cada moneda en la moneda de reporte con la tasa de valoración vigente (agregando por moneda
   * ANTES de convertir; los negativos se convierten igual); una moneda sin tasa queda sin convertir y el consolidado
   * incompleto, nunca 1:1. Con el consolidado ≥ 0 informa el faltante de cada moneda negativa (design.md decisión 9).
   */
  consolidate(
    terms: readonly SpendableTerms[],
    reporting: Currency,
    rateFor: (currency: string) => ExactRate | null,
  ): SpendableConsolidation {
    const consolidated = ConsolidationService.consolidate(
      terms.map((t) => t.spendable),
      reporting,
      rateFor,
    );
    const negative = consolidated.total.lt(dec('0'));
    const shortfalls = negative
      ? []
      : terms.filter((t) => t.spendable.isNegative()).map((t) => t.spendable.negate());
    return {
      total: consolidated.total,
      complete: consolidated.complete,
      unconverted: consolidated.unconverted,
      shortfalls,
      status: negative ? 'WARNING' : 'OK',
    };
  },

  /**
   * Tarjetas con saldo adeudado sin pago programado ni pendiente (D213): ningún ítem de COMMITMENTS (transferencia o
   * pago de tarjeta, administrado o no) tiene como destino la cuenta de la tarjeta. Sin ese pago la compra con tarjeta
   * no resta del disponible, y la UI lo avisa.
   */
  cardsWithoutPayment(cardAccountIds: readonly string[], items: readonly SpendableCommittedItem[]): number {
    const paid = new Set(
      items
        .filter((i) => i.kind === 'TRANSFER' || i.kind === 'CARD_PAYMENT')
        .map((i) => i.toAccountId)
        .filter((id): id is string => id !== null),
    );
    return cardAccountIds.filter((id) => !paid.has(id)).length;
  },

  /** Total presentado (HALF_EVEN solo aquí). */
  present(total: Decimal, reporting: Currency): Money {
    return present(total, reporting);
  },
} as const;
