import { DomainError, Money } from '@pf/shared-kernel';

/**
 * Componentes de un cargo de tarjeta (openspec add-card-interest-ledger-portions, decisiones 2 y 4) y la categoría de
 * sistema (`systemCode`) a la que se imputa cada uno: interés, comisiones, seguro e impuestos.
 */
export const CARD_CHARGE_COMPONENTS = [
  { key: 'interest', systemCode: 'INTEREST' },
  { key: 'fees', systemCode: 'FEES' },
  { key: 'insurance', systemCode: 'INSURANCE' },
  { key: 'taxes', systemCode: 'TAXES' },
] as const;
export type CardChargeComponent = (typeof CARD_CHARGE_COMPONENTS)[number]['key'];
export type CardChargeSystemCode = (typeof CARD_CHARGE_COMPONENTS)[number]['systemCode'];

/** Rol de una transacción administrada por otro contexto sin ser un `kind` propio (`txn.transaction.debt_role`). */
export const DEBT_ROLES = ['CARD_CHARGE'] as const;
export type DebtRole = (typeof DEBT_ROLES)[number];

/** Componentes de un cargo en la moneda de la cuenta de la tarjeta, ya parseados a la escala de la moneda. */
export type CardChargeAmounts = Readonly<Record<CardChargeComponent, Money>>;

/**
 * Valida los componentes de un cargo: misma moneda, ≥ 0 (`AMOUNT_NOT_POSITIVE`) y al menos uno positivo
 * (`CARD_CHARGE_INVALID`). Devuelve el total (Σ componentes, INV-021).
 */
export function assertCardChargeAmounts(amounts: CardChargeAmounts, currencyCode: string): Money {
  for (const { key } of CARD_CHARGE_COMPONENTS) {
    const m = amounts[key];
    if (m.currency.code !== currencyCode) {
      throw new DomainError('CURRENCY_MISMATCH', `${key} is in ${m.currency.code}, not ${currencyCode}`).at(
        `/${key}`,
      );
    }
    if (m.isNegative()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', `${key} must be >= 0`).at(`/${key}`);
    }
  }
  const total = Money.sum(
    CARD_CHARGE_COMPONENTS.map(({ key }) => amounts[key]),
    amounts.interest.currency,
  );
  if (!total.isPositive()) {
    throw new DomainError('CARD_CHARGE_INVALID', 'a card charge needs at least one positive component');
  }
  return total;
}
