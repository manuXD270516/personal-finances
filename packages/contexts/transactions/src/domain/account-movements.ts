import type { Money } from '@pf/shared-kernel';

/** Clase de un movimiento sobre una cuenta (openspec add-credit-cards, decisión 12). */
export type MovementClass = 'PURCHASE' | 'REFUND' | 'PAYMENT' | 'OTHER';

/**
 * Pata vigente de una transacción con asiento activo, tal como la lee la consulta: `legAmount` es el posting firmado
 * del ledger (débito +, crédito −). Para `EXPENSE` y `REFUND` la fila se repite por porción (`splitAmount`,
 * `categoryId`) porque la categoría vive en las porciones; en el resto `splitAmount` es `null`.
 */
export interface MovementLegRow {
  readonly accountId: string;
  readonly businessDate: string;
  readonly transactionId: string;
  readonly kind: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly legAmount: Money;
  readonly splitAmount: Money | null;
  readonly categoryId: string | null;
}

export interface MovementLine {
  readonly accountId: string;
  readonly businessDate: string;
  readonly transactionId: string;
  readonly movementClass: MovementClass;
  readonly systemCategoryCode: string | null;
  /** Efecto sobre el saldo PRESENTADO de la cuenta (pasivo: positivo = más deuda). */
  readonly amount: Money;
}

/**
 * Clasifica una pata por la porción de la cuenta (decisión 3 y 12):
 *   EXPENSE ⇒ PURCHASE (incluye comisiones e intereses cargados a la cuenta); REFUND ⇒ REFUND;
 *   TRANSFER / CONVERSION ⇒ la pata que ENTRA (posting débito) es PAYMENT y la que SALE (o paga una comisión) PURCHASE;
 *   ADJUSTMENT, INCOME, préstamos y todo lo demás ⇒ OTHER. Las comisiones explícitas de un pago las paga la cuenta de
 *   origen (su pata `SOURCE` o `FEE`), nunca la de la tarjeta destino.
 */
export function classifyMovementKind(kind: string, legAmount: Money): MovementClass {
  switch (kind) {
    case 'EXPENSE':
      return 'PURCHASE';
    case 'REFUND':
      return 'REFUND';
    case 'TRANSFER':
    case 'CONVERSION':
      return legAmount.isNegative() ? 'PURCHASE' : 'PAYMENT';
    default:
      return 'OTHER';
  }
}

/** Saldo presentado de un pasivo = −posting; de un activo = posting. */
function presented(nature: 'ASSET' | 'LIABILITY', ledgerAmount: Money): Money {
  return nature === 'LIABILITY' ? ledgerAmount.negate() : ledgerAmount;
}

export function toMovementLines(
  rows: readonly MovementLegRow[],
  codeOf: (categoryId: string) => string | null,
): MovementLine[] {
  return rows.map((r) => {
    const movementClass = classifyMovementKind(r.kind, r.legAmount);
    const perSplit = r.splitAmount !== null && (r.kind === 'EXPENSE' || r.kind === 'REFUND');
    // Con porciones el monto de la fila es el de la porción, con el signo del posting de la pata.
    const ledger = perSplit
      ? r.legAmount.isNegative()
        ? (r.splitAmount as Money).negate()
        : (r.splitAmount as Money)
      : r.legAmount;
    return {
      accountId: r.accountId,
      businessDate: r.businessDate,
      transactionId: r.transactionId,
      movementClass,
      systemCategoryCode: perSplit && r.categoryId !== null ? codeOf(r.categoryId) : null,
      amount: presented(r.nature, ledger),
    };
  });
}

export interface MovementGroup {
  readonly accountId: string;
  readonly businessDate: string;
  readonly movementClass: MovementClass;
  readonly systemCategoryCode: string | null;
  readonly transactionId: string | null;
  readonly amount: Money;
}

/**
 * `DAY`: suma por `(cuenta, fecha, clase, categoría de sistema)`. `TRANSACTION`: una fila por `(cuenta, transacción,
 * clase)`; su categoría de sistema es la común a todas sus porciones (o `null` si difieren o no hay).
 */
export function groupMovements(
  lines: readonly MovementLine[],
  groupBy: 'DAY' | 'TRANSACTION',
): MovementGroup[] {
  const groups = new Map<string, { first: MovementLine; amount: Money; codes: Set<string | null> }>();
  for (const l of lines) {
    const key =
      groupBy === 'DAY'
        ? [l.accountId, l.businessDate, l.movementClass, l.systemCategoryCode ?? ''].join('|')
        : [l.accountId, l.transactionId, l.movementClass].join('|');
    const g = groups.get(key);
    if (g) {
      g.amount = g.amount.add(l.amount);
      g.codes.add(l.systemCategoryCode);
    } else groups.set(key, { first: l, amount: l.amount, codes: new Set([l.systemCategoryCode]) });
  }
  const out: MovementGroup[] = [...groups.values()].map(({ first, amount, codes }) => ({
    accountId: first.accountId,
    businessDate: first.businessDate,
    movementClass: first.movementClass,
    systemCategoryCode:
      groupBy === 'DAY' ? first.systemCategoryCode : codes.size === 1 ? [...codes][0]! : null,
    transactionId: groupBy === 'TRANSACTION' ? first.transactionId : null,
    amount,
  }));
  const classOrder: Record<MovementClass, number> = { PURCHASE: 0, REFUND: 1, PAYMENT: 2, OTHER: 3 };
  return out.sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      a.accountId.localeCompare(b.accountId) ||
      classOrder[a.movementClass] - classOrder[b.movementClass] ||
      (a.systemCategoryCode ?? '').localeCompare(b.systemCategoryCode ?? '') ||
      (a.transactionId ?? '').localeCompare(b.transactionId ?? ''),
  );
}
