'use client';

import { useEffect, useState } from 'react';
import { warningStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { voidImpactPath } from './logic';
import type { GoalNegativeFunds, GoalVoidImpact } from './types';

/**
 * Aviso previo a anular una transacción que respalda aportes o retiros de metas (D222, fix-phase-4-gaps): por cada meta
 * afectada, la cuenta y los fondos que quedarán. La anulación NO se bloquea: el aviso solo informa y, si algún fondo
 * queda en negativo, lo dice. Presentacional.
 */
export function VoidImpactView({ impact, f }: { impact: GoalVoidImpact; f: FormatContext }) {
  if (impact.goals.length === 0) return null;
  const negative = impact.goals.some((g) => g.negative);
  return (
    <section role="alert" aria-label={f.t('voidImpact.title')} data-testid="void-impact" style={warningStyle}>
      <strong>
        <span aria-hidden="true">⚠</span> {f.t('voidImpact.title')}
      </strong>
      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
        {impact.goals.map((g) => (
          <li
            key={`${g.goalId}-${g.accountId}-${g.fund}`}
            data-testid="void-impact-item"
            data-negative={g.negative ? 'true' : 'false'}
          >
            {f.t('voidImpact.item', {
              goal: g.goalName,
              funds: formatMoney(g.fundsAfterVoid, f.locale),
              account: g.accountName,
            })}
          </li>
        ))}
      </ul>
      {negative ? <p style={{ margin: '0.25rem 0 0' }}>{f.t('voidImpact.negative')}</p> : null}
    </section>
  );
}

/**
 * Compone el aviso con `GET …/goals/void-impact?transactionId=` al abrir el diálogo de anulación. Un fallo de la
 * lectura (o sin metas afectadas) no muestra nada ni impide anular.
 */
export function VoidImpactNotice({ ctx, transactionId }: { ctx: WorkspaceContext; transactionId: string }) {
  const f = useFormat('Goals', ctx);
  const [impact, setImpact] = useState<GoalVoidImpact | undefined>();
  const { api, base } = ctx;
  useEffect(() => {
    let cancelled = false;
    api
      .get<GoalVoidImpact>(voidImpactPath(base, transactionId))
      .then((r) => {
        if (!cancelled) setImpact(r.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, base, transactionId]);
  return impact ? <VoidImpactView impact={impact} f={f} /> : null;
}

/** Faltante de la meta: los fondos negativos por cuenta, como cifra positiva a regularizar. */
export function NegativeFundsNotice({
  negativeFunds,
  f,
  accountName,
}: {
  negativeFunds: readonly GoalNegativeFunds[];
  f: FormatContext;
  accountName: (id: string) => string | undefined;
}) {
  if (negativeFunds.length === 0) return null;
  return (
    <section
      role="note"
      aria-label={f.t('negativeFunds.title')}
      data-testid="goal-negative-funds"
      style={warningStyle}
    >
      <strong>
        <span aria-hidden="true">⚠</span> {f.t('negativeFunds.title')}
      </strong>
      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
        {negativeFunds.map((n) => (
          <li key={n.accountId} data-testid="goal-negative-fund" data-account-id={n.accountId}>
            {f.t('negativeFunds.item', {
              amount: formatMoney(
                { amount: n.amount.amount.replace(/^-/, ''), currency: n.amount.currency },
                f.locale,
              ),
              account: accountName(n.accountId) ?? '…',
            })}
          </li>
        ))}
      </ul>
      <p style={{ margin: '0.25rem 0 0' }}>{f.t('negativeFunds.hint')}</p>
    </section>
  );
}
