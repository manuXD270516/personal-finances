import { DomainError, LocalDate, type Instant, type Money } from '@pf/shared-kernel';

/** Ventana de la lista de próximos pagos: por defecto 30 días, de 1 a 90 (horizonte de generación del motor). */
export const DEFAULT_UPCOMING_DAYS = 30;
export const MAX_UPCOMING_DAYS = 90;
/** Namespace del `externalRef` de una transacción que nació de una ocurrencia (COMMITMENTS). */
export const OCCURRENCE_REF_NAMESPACE = 'commitments.occurrence';

/** Clase de una cuenta para el criterio de egreso comprometido (D127; `ASSET` + `LIQUID` es dinero disponible). */
export interface AccountClass {
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly liquidity: 'LIQUID' | 'SEMI_LIQUID' | 'ILLIQUID';
}

const isLiquid = (a: AccountClass): boolean => a.nature === 'ASSET' && a.liquidity === 'LIQUID';

/**
 * ¿Una transacción pendiente reduce el dinero disponible? (D127) Un gasto siempre; una transferencia solo si sale de
 * una cuenta líquida hacia una que no lo es (pago de tarjeta, aporte a ahorro); entre líquidas no cuenta. Misma regla
 * que aplica COMMITMENTS a sus totales: aquí se repite porque REPORTING no importa `@pf/commitments`.
 */
export function countsAsOutflow(input: {
  readonly kind: string;
  readonly direction: 'IN' | 'OUT';
  readonly from: AccountClass | undefined;
  readonly to: AccountClass | undefined;
}): boolean {
  if (input.direction !== 'OUT') return false;
  if (input.kind === 'EXPENSE') return true;
  if (input.kind === 'TRANSFER') {
    return input.from !== undefined && input.to !== undefined && isLiquid(input.from) && !isLiquid(input.to);
  }
  return false;
}

export interface UpcomingWindowValue {
  /** Hoy en la zona del workspace. */
  readonly from: LocalDate;
  /** Último día de la ventana (inclusive). */
  readonly to: LocalDate;
  readonly days: number;
}

export const UpcomingWindow = {
  /**
   * "Hoy" es la fecha LOCAL del workspace (RISK-020), no la UTC; la ventana `[hoy, hoy + días]` es inclusiva. `days`
   * fuera de 1..90 o no entero se rechaza con `INVALID_FILTER`.
   */
  of(now: Instant, timeZone: string, days: number | undefined): UpcomingWindowValue {
    const n = days ?? DEFAULT_UPCOMING_DAYS;
    if (!Number.isInteger(n) || n < 1 || n > MAX_UPCOMING_DAYS) {
      throw new DomainError(
        'INVALID_FILTER',
        `days must be an integer between 1 and ${MAX_UPCOMING_DAYS}`,
      ).at('/days');
    }
    const from = LocalDate.ofInstant(now, timeZone);
    return { from, to: from.plusDays(n), days: n };
  },
} as const;

export type UpcomingAmountType = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';
export type UpcomingItemStatus = 'SCHEDULED' | 'DUE' | 'OVERDUE' | 'PENDING_APPROVAL' | 'PENDING';

/** Ocurrencia de egreso no resuelta que informa COMMITMENTS (`UpcomingPaymentsQuery`), ya con `Money`. */
export interface OccurrenceInput {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly dueDate: string;
  readonly status: 'SCHEDULED' | 'DUE' | 'OVERDUE';
  readonly requiresApproval: boolean;
  readonly amountType: UpcomingAmountType;
  readonly amount: Money | null;
  readonly min: Money | null;
  readonly max: Money | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
}

/** Transacción `PENDING` (TRANSACTIONS, `PendingFlowQuery`), ya con `Money`. */
export interface PendingInput {
  readonly transactionId: string;
  readonly kind: string;
  readonly direction: 'IN' | 'OUT';
  readonly businessDate: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: Money;
  readonly description: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}

export interface UpcomingItem {
  readonly kind: 'OCCURRENCE' | 'PENDING_TRANSACTION';
  readonly occurrenceId?: string;
  readonly definitionId?: string;
  readonly transactionId?: string;
  readonly name: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly date: string;
  readonly status: UpcomingItemStatus;
  readonly daysOverdue?: number;
  readonly requiresApproval: boolean;
  readonly amountType: UpcomingAmountType | 'ACTUAL';
  /** Monto a mostrar; `null` en `VARIABLE` y en `MIN_MAX` (se muestra el rango). */
  readonly amount: Money | null;
  readonly range?: { readonly min: Money; readonly max: Money };
  readonly estimated: boolean;
  readonly withoutAmount: boolean;
  /** Monto que suma en los totales (máximo en `MIN_MAX`); `null` si no suma (`VARIABLE`). */
  readonly forTotals: Money | null;
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function occurrenceItem(o: OccurrenceInput, today: LocalDate): UpcomingItem {
  const overdueBy = today.toEpochDay() - LocalDate.parse(o.dueDate).toEpochDay();
  const overdue = overdueBy > 0;
  const status: UpcomingItemStatus = overdue
    ? 'OVERDUE'
    : o.requiresApproval
      ? 'PENDING_APPROVAL'
      : o.status === 'OVERDUE'
        ? 'DUE'
        : o.status;
  const base = {
    kind: 'OCCURRENCE' as const,
    occurrenceId: o.occurrenceId,
    definitionId: o.definitionId,
    name: o.name,
    accountId: o.accountId,
    toAccountId: o.toAccountId,
    date: o.dueDate,
    status,
    ...(overdue ? { daysOverdue: overdueBy } : {}),
    requiresApproval: o.requiresApproval,
    amountType: o.amountType,
  };
  switch (o.amountType) {
    case 'FIXED':
    case 'ESTIMATED':
      return {
        ...base,
        amount: o.amount,
        estimated: o.amountType === 'ESTIMATED',
        withoutAmount: o.amount === null,
        forTotals: o.amount,
      };
    case 'MIN_MAX':
      return {
        ...base,
        amount: null,
        ...(o.min && o.max ? { range: { min: o.min, max: o.max } } : {}),
        estimated: false,
        withoutAmount: o.max === null,
        // Peor caso: el máximo del rango (FR-COMMITMENTS-004).
        forTotals: o.max,
      };
    case 'VARIABLE':
      return { ...base, amount: null, estimated: false, withoutAmount: true, forTotals: null };
  }
}

function pendingItem(p: PendingInput): UpcomingItem {
  const ref = p.externalRef?.namespace === OCCURRENCE_REF_NAMESPACE ? p.externalRef.id : undefined;
  return {
    kind: 'PENDING_TRANSACTION',
    ...(ref ? { occurrenceId: ref } : {}),
    transactionId: p.transactionId,
    name: p.description ?? '',
    accountId: p.accountId,
    toAccountId: p.toAccountId,
    date: p.businessDate,
    // Una pendiente con fecha pasada ya está registrada: no es "vencida" (decisión 5).
    status: 'PENDING',
    requiresApproval: false,
    amountType: 'ACTUAL',
    amount: p.amount,
    estimated: false,
    withoutAmount: false,
    forTotals: p.amount,
  };
}

/**
 * DS `UpcomingPaymentsAssembler` (design.md decisiones 3–6), puro:
 *   - une las ocurrencias de egreso no resueltas con las transacciones pendientes de egreso (D127 para transferencias);
 *   - sin doble conteo: una ocurrencia que ya tiene su transacción pendiente (`externalRef`) se cuenta solo como la
 *     transacción, con su monto real;
 *   - las ocurrencias con fecha anterior a hoy se marcan `OVERDUE` con `daysOverdue`, de cualquier antigüedad;
 *   - orden por fecha, nombre normalizado e id (determinista); solo lo que vence hasta `through`.
 */
export const UpcomingPaymentsAssembler = {
  assemble(input: {
    readonly today: LocalDate;
    readonly through: string;
    readonly occurrences: readonly OccurrenceInput[];
    readonly pending: readonly PendingInput[];
    readonly classes: ReadonlyMap<string, AccountClass>;
  }): UpcomingItem[] {
    const { today, through, classes } = input;
    const seenRefs = new Set<string>();
    const pending = input.pending
      .filter(
        (p) =>
          p.businessDate <= through &&
          countsAsOutflow({
            kind: p.kind,
            direction: p.direction,
            from: classes.get(p.accountId),
            to: p.toAccountId ? classes.get(p.toAccountId) : undefined,
          }),
      )
      .sort((a, b) =>
        a.businessDate === b.businessDate
          ? a.transactionId.localeCompare(b.transactionId)
          : a.businessDate < b.businessDate
            ? -1
            : 1,
      )
      // Una ocurrencia aparece a lo sumo una vez: si dos pendientes apuntan a la misma, queda la primera.
      .filter((p) => {
        if (p.externalRef?.namespace !== OCCURRENCE_REF_NAMESPACE) return true;
        if (seenRefs.has(p.externalRef.id)) return false;
        seenRefs.add(p.externalRef.id);
        return true;
      });
    const materialized = new Set(
      pending
        .filter((p) => p.externalRef?.namespace === OCCURRENCE_REF_NAMESPACE)
        .map((p) => (p.externalRef as { id: string }).id),
    );
    const items: UpcomingItem[] = [
      ...input.occurrences
        .filter((o) => o.dueDate <= through && !materialized.has(o.occurrenceId))
        .map((o) => occurrenceItem(o, today)),
      ...pending.map(pendingItem),
    ];
    const idOf = (i: UpcomingItem) => i.occurrenceId ?? i.transactionId ?? '';
    return items.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const na = normalize(a.name);
      const nb = normalize(b.name);
      if (na !== nb) return na < nb ? -1 : 1;
      return idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0;
    });
  },

  /**
   * Montos que suman en los totales (un `Money` por ítem, sin agregar) y cuántos pagos quedan fuera por no tener monto.
   * Nunca se suma 0 ni un monto inventado por un ítem `VARIABLE` (D115).
   */
  totals(items: readonly UpcomingItem[]): { lines: Money[]; withoutAmountCount: number } {
    const lines: Money[] = [];
    let withoutAmountCount = 0;
    for (const i of items) {
      if (i.forTotals === null) withoutAmountCount += 1;
      else lines.push(i.forTotals);
    }
    return { lines, withoutAmountCount };
  },
} as const;
