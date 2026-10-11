import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import type { CardCycleCalendar } from './card-cycle-calendar.js';
import { scheduleInstallments } from './installment-scheduler.js';

/**
 * AR `CardInstallmentPlan` (openspec add-credit-cards, design decisión 13; capability `debt/credit-cards`, requirements
 * de cuotas, Could): plan de 2 a 60 cuotas sobre un gasto posteado de una cuenta de tarjeta. No crea asientos: la
 * compra ya adeuda su monto completo; el plan solo reparte cuánto del capital se factura en cada ciclo (el saldo
 * facturado descuenta las cuotas aún no facturadas) y alimenta el calendario de cargos futuros. El interés es una
 * proyección y nunca se postea.
 */
export const INSTALLMENT_PLAN_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type InstallmentPlanStatus = (typeof INSTALLMENT_PLAN_STATUSES)[number];

export const INSTALLMENT_START_CYCLES = ['PURCHASE', 'NEXT'] as const;
export type InstallmentStartCycle = (typeof INSTALLMENT_START_CYCLES)[number];

export type InstallmentCancelReason = 'PURCHASE_VOIDED' | 'PURCHASE_REVISED' | 'USER';

export interface CardInstallmentState {
  readonly n: number;
  /** Cierre del ciclo en que se factura la cuota. */
  readonly billingClosingDate: string;
  /** Vencimiento (con ajuste de fin de semana) del pago que factura esa cuota. */
  readonly dueDate: string;
  /** Vencimiento nominal (clave de la ocurrencia del plan de pago). */
  readonly nominalDueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly total: string;
}

export interface CardInstallmentPlanState {
  readonly id: string;
  readonly workspaceId: string;
  readonly cardAccountId: string;
  readonly purchaseTransactionId: string;
  /** Fecha de negocio de la compra. */
  readonly purchaseDate: string;
  readonly principal: string;
  readonly currency: string;
  readonly scale: number;
  readonly installmentCount: number;
  /** Porcentaje nominal anual (`0.00` = sin interés). */
  readonly annualRate: string;
  readonly startCycle: InstallmentStartCycle;
  readonly status: InstallmentPlanStatus;
  readonly cancelReason: InstallmentCancelReason | null;
  readonly installments: readonly CardInstallmentState[];
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Cierres de facturación de las cuotas `fromIndex..count−1`: el primero es el primer cierre >= `anchor`; los demás, uno
 * por ciclo consecutivo.
 */
function assignClosings(calendar: CardCycleCalendar, anchor: LocalDate, count: number) {
  const out: { billingClosingDate: string; dueDate: string; nominalDueDate: string }[] = [];
  let cursor = anchor;
  for (let i = 0; i < count; i += 1) {
    const cycle = calendar.cycleContaining(cursor);
    out.push({
      billingClosingDate: cycle.closing.toString(),
      dueDate: cycle.dueDate.toString(),
      nominalDueDate: cycle.nominalDue.toString(),
    });
    cursor = cycle.closing.plusDays(1);
  }
  return out;
}

export class CardInstallmentPlan {
  private constructor(
    private state: CardInstallmentPlanState,
    private persisted: number,
  ) {}

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly cardAccountId: string;
    readonly purchaseTransactionId: string;
    readonly purchaseDate: string;
    readonly principal: Money;
    readonly count: number;
    readonly annualRatePercent: string;
    readonly startCycle?: InstallmentStartCycle | undefined;
    readonly calendar: CardCycleCalendar;
    readonly at: string;
    readonly by: string;
  }): CardInstallmentPlan {
    const startCycle = input.startCycle ?? 'PURCHASE';
    if (!(INSTALLMENT_START_CYCLES as readonly string[]).includes(startCycle)) {
      throw new DomainError('INSTALLMENT_PLAN_INVALID', 'startCycle must be PURCHASE or NEXT').at(
        '/startCycle',
      );
    }
    const amounts = scheduleInstallments({
      principal: input.principal,
      count: input.count,
      annualRatePercent: input.annualRatePercent,
    });
    const purchase = LocalDate.parse(input.purchaseDate);
    const anchor =
      startCycle === 'PURCHASE' ? purchase : input.calendar.cycleContaining(purchase).closing.plusDays(1);
    const closings = assignClosings(input.calendar, anchor, input.count);
    const cur = input.principal.currency;
    return new CardInstallmentPlan(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        cardAccountId: input.cardAccountId,
        purchaseTransactionId: input.purchaseTransactionId,
        purchaseDate: input.purchaseDate,
        principal: input.principal.toFixed(),
        currency: cur.code,
        scale: cur.scale,
        installmentCount: input.count,
        annualRate: Number(input.annualRatePercent) === 0 ? '0.00' : input.annualRatePercent,
        startCycle,
        status: 'ACTIVE',
        cancelReason: null,
        installments: amounts.map((a, i) => ({
          n: a.n,
          ...(closings[i] as (typeof closings)[number]),
          principal: a.principal.toFixed(),
          interest: a.interest.toFixed(),
          total: a.total.toFixed(),
        })),
        version: 1,
        createdBy: input.by,
        createdAt: input.at,
        updatedAt: input.at,
      },
      0,
    );
  }

  static restore(state: CardInstallmentPlanState): CardInstallmentPlan {
    return new CardInstallmentPlan({ ...state }, state.version);
  }

  get persistedVersion(): number {
    return this.persisted;
  }
  markPersisted(): void {
    this.persisted = this.state.version;
  }

  get id(): string {
    return this.state.id;
  }
  get status(): InstallmentPlanStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): CardInstallmentPlanState {
    return { ...this.state };
  }

  /**
   * Reasigna las cuotas NO facturadas (cierre > `lastIssuedClosing`) en orden a los cierres del calendario nuevo tras un
   * cambio de términos (decisión 13). Devuelve `true` si algo cambió.
   */
  reassign(calendar: CardCycleCalendar, lastIssuedClosing: LocalDate | null, at: string): boolean {
    if (this.state.status !== 'ACTIVE') return false;
    const kept: CardInstallmentState[] = [];
    const pending: CardInstallmentState[] = [];
    for (const i of this.state.installments) {
      const billed =
        lastIssuedClosing !== null && LocalDate.parse(i.billingClosingDate).compare(lastIssuedClosing) <= 0;
      (billed ? kept : pending).push(i);
    }
    if (pending.length === 0) return false;
    const afterKept =
      kept.length > 0
        ? LocalDate.parse((kept.at(-1) as CardInstallmentState).billingClosingDate).plusDays(1)
        : null;
    const afterIssued = lastIssuedClosing ? lastIssuedClosing.plusDays(1) : null;
    const purchase = LocalDate.parse(this.state.purchaseDate);
    const base =
      kept.length > 0
        ? (afterKept as LocalDate)
        : this.state.startCycle === 'PURCHASE'
          ? purchase
          : calendar.cycleContaining(purchase).closing.plusDays(1);
    const anchor = afterIssued && afterIssued.compare(base) > 0 ? afterIssued : base;
    const closings = assignClosings(calendar, anchor, pending.length);
    const next = [
      ...kept,
      ...pending.map((i, idx) => ({ ...i, ...(closings[idx] as (typeof closings)[number]) })),
    ];
    if (JSON.stringify(next) === JSON.stringify(this.state.installments)) return false;
    this.apply({ installments: next }, at);
    return true;
  }

  /** `ACTIVE → COMPLETED` cuando el ciclo de la última cuota ya se emitió. */
  completeIfBilled(lastIssuedClosing: LocalDate | null, at: string): boolean {
    if (this.state.status !== 'ACTIVE' || lastIssuedClosing === null) return false;
    const last = this.state.installments.at(-1) as CardInstallmentState;
    if (LocalDate.parse(last.billingClosingDate).compare(lastIssuedClosing) > 0) return false;
    this.apply({ status: 'COMPLETED' }, at);
    return true;
  }

  cancel(reason: InstallmentCancelReason, at: string): void {
    if (this.state.status === 'CANCELLED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'CardInstallmentPlan: already cancelled');
    }
    this.apply({ status: 'CANCELLED', cancelReason: reason }, at);
  }

  private apply(patch: Partial<Mutable<CardInstallmentPlanState>>, at: string): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1, updatedAt: at };
  }

  // ───────────────────────────────────────────── agregaciones sobre varios planes

  /** Cuotas de planes que cuentan (ACTIVE o COMPLETED) con su moneda. */
  static counting(plans: readonly CardInstallmentPlan[]): CardInstallmentPlan[] {
    return plans.filter((p) => p.state.status !== 'CANCELLED');
  }

  /**
   * Capital de las cuotas que se facturarán en ciclos posteriores a `closing`, de las compras con fecha <= `closing`
   * (el saldo facturado del ciclo las descuenta; la utilización usa el saldo completo).
   */
  static unbilledCapital(
    plans: readonly CardInstallmentPlan[],
    closing: LocalDate,
    currency: Currency,
  ): Money {
    let total = Money.zero(currency);
    for (const plan of CardInstallmentPlan.counting(plans)) {
      if (plan.state.currency !== currency.code) continue;
      if (LocalDate.parse(plan.state.purchaseDate).compare(closing) > 0) continue;
      for (const i of plan.state.installments) {
        if (LocalDate.parse(i.billingClosingDate).compare(closing) > 0) {
          total = total.add(Money.parse(i.principal, currency));
        }
      }
    }
    return total;
  }

  /** Σ total (capital + interés proyectado) de las cuotas que se facturan exactamente en `closing`. */
  static totalBilledAt(plans: readonly CardInstallmentPlan[], closing: LocalDate, currency: Currency): Money {
    let total = Money.zero(currency);
    for (const plan of CardInstallmentPlan.counting(plans)) {
      if (plan.state.currency !== currency.code) continue;
      for (const i of plan.state.installments) {
        if (i.billingClosingDate === closing.toString()) total = total.add(Money.parse(i.total, currency));
      }
    }
    return total;
  }

  /**
   * Calendario de cargos futuros: por fecha de vencimiento, las cuotas cuyo ciclo de facturación aún no cerró
   * (cierre >= hoy) — solo planes ACTIVE.
   */
  static futureCharges(plans: readonly CardInstallmentPlan[], today: LocalDate): FutureChargeGroup[] {
    const groups = new Map<
      string,
      { dueDate: string; closingDate: string; installments: FutureChargeItem[] }
    >();
    for (const plan of plans) {
      if (plan.state.status !== 'ACTIVE') continue;
      for (const i of plan.state.installments) {
        if (LocalDate.parse(i.billingClosingDate).compare(today) < 0) continue;
        const key = `${i.dueDate}|${i.billingClosingDate}`;
        const group = groups.get(key) ?? {
          dueDate: i.dueDate,
          closingDate: i.billingClosingDate,
          installments: [],
        };
        group.installments.push({
          planId: plan.state.id,
          purchaseTransactionId: plan.state.purchaseTransactionId,
          n: i.n,
          of: plan.state.installmentCount,
          principal: i.principal,
          interest: i.interest,
          total: i.total,
        });
        groups.set(key, group);
      }
    }
    return [...groups.values()].sort((a, b) =>
      a.dueDate === b.dueDate ? (a.closingDate < b.closingDate ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1,
    );
  }
}

export interface FutureChargeItem {
  readonly planId: string;
  readonly purchaseTransactionId: string;
  readonly n: number;
  readonly of: number;
  readonly principal: string;
  readonly interest: string;
  readonly total: string;
}

export interface FutureChargeGroup {
  readonly dueDate: string;
  readonly closingDate: string;
  readonly installments: readonly FutureChargeItem[];
}
