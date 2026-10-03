'use client';

import { useEffect, useState } from 'react';
import type { Money, ReportSummary, ResolvedRate } from '../dashboard/types';
import type { WorkspaceContext } from '../common/workspace';

/** Valoración de una cuenta en la moneda base con la tasa usada (la misma del Home, `reports/summary`). */
export interface AccountValuation {
  readonly converted: Money;
  readonly rate: ResolvedRate;
}

/**
 * La API de cuentas aún devuelve `baseCurrencyBalance: null` (pendiente de FX en accounts); mientras tanto el
 * equivalente se toma de `GET /reports/summary`, que valora cada cuenta con la tasa resuelta (sin inventar 1:1).
 */
export function valuationsOf(summary: ReportSummary): Map<string, AccountValuation> {
  const out = new Map<string, AccountValuation>();
  for (const a of summary.accounts) {
    if (a.convertedBalance && a.rate) out.set(a.accountId, { converted: a.convertedBalance, rate: a.rate });
  }
  return out;
}

export function useValuations(
  ctx: WorkspaceContext,
  refreshKey?: unknown,
): ReadonlyMap<string, AccountValuation> {
  const [map, setMap] = useState<ReadonlyMap<string, AccountValuation>>(new Map());
  useEffect(() => {
    ctx.api
      .get<ReportSummary>(`${ctx.base}/reports/summary`)
      .then((r) => setMap(r.data ? valuationsOf(r.data) : new Map()))
      .catch(() => setMap(new Map()));
  }, [ctx.api, ctx.base, refreshKey]);
  return map;
}
