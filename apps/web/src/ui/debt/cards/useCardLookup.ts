'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FinanceApiClient } from '../../../bff/finance-api-client';
import { cardOfAccount, cardOfDefinition, cardsPath } from './logic';
import type { CardAccount, CreditCard } from './types';

export interface CardRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Tarjeta del plan de pago de una definición `CARD_PAYMENT` (`CardAccount.paymentPlan.definitionId`): la usan Recurrentes y
 * los próximos pagos para rotular "Pago de tarjeta · <nombre>" y enlazar a la tarjeta. Solo consulta cuando `enabled`
 * (hay pagos de tarjeta en pantalla).
 */
export function useCardLookup(api: FinanceApiClient | undefined, base: string | undefined, enabled: boolean) {
  const [cards, setCards] = useState<readonly CreditCard[]>([]);
  useEffect(() => {
    if (!enabled || !api || !base) return;
    let cancelled = false;
    api
      .get<{ data: CreditCard[] }>(cardsPath(base))
      .then((r) => {
        if (!cancelled) setCards(r.data?.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, base, enabled]);
  return useMemo(
    () => ({
      ofDefinition: (definitionId: string): CardRef | undefined =>
        cardOfDefinition(cards, definitionId)?.card,
      ofAccount: (accountId: string): CardRef | undefined => cardOfAccount(cards, accountId),
    }),
    [cards],
  );
}

/** Tarjeta (con sus estados de cuenta) a la que pertenece una cuenta de tarjeta: el formulario de transferencia la usa. */
export function useCardOfAccount(
  api: FinanceApiClient,
  base: string,
  accountId: string | undefined,
): CreditCard | undefined {
  const [found, setFound] = useState<{ accountId: string; card: CreditCard | undefined } | undefined>();
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    api
      .get<{ data: CreditCard[] }>(
        `${cardsPath(base)}?${new URLSearchParams({ accountId, status: 'ACTIVE' }).toString()}`,
      )
      .then((r) => {
        if (!cancelled) setFound({ accountId, card: r.data?.data?.[0] });
      })
      .catch(() => {
        if (!cancelled) setFound({ accountId, card: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [api, base, accountId]);
  return found && found.accountId === accountId ? found.card : undefined;
}

/** Cuenta de la tarjeta (del ledger) dentro de la tarjeta. */
export const accountOf = (card: CreditCard, accountId: string): CardAccount | undefined =>
  card.accounts.find((a) => a.accountId === accountId);
