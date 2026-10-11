'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceContext } from '../common/workspace';
import { loansPath } from './logic';
import type { Loan } from './types';

export interface LoanRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Préstamo de origen de una definición de cuotas (`Loan.recurringDefinitionId`): lo usan Recurrentes y Transacciones para
 * mostrar el préstamo y ofrecer "Registrar pago". Solo consulta cuando `enabled` (hay cuotas en pantalla).
 */
export function useLoanLookup(ctx: WorkspaceContext, enabled: boolean) {
  const [loans, setLoans] = useState<readonly Loan[]>([]);
  const { api, base } = ctx;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<{ data: Loan[] }>(loansPath(base))
      .then((r) => {
        if (!cancelled) setLoans(r.data?.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, base, enabled]);
  return useMemo(() => {
    const byDefinition = new Map(
      loans
        .filter((l) => l.recurringDefinitionId)
        .map((l) => [l.recurringDefinitionId as string, l] as const),
    );
    const byId = new Map(loans.map((l) => [l.id, l] as const));
    return {
      ofDefinition: (definitionId: string): LoanRef | undefined => byDefinition.get(definitionId),
      ofId: (loanId: string): LoanRef | undefined => byId.get(loanId),
    };
  }, [loans]);
}
