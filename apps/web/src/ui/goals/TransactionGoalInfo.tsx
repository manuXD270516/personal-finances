'use client';

import { useEffect, useState } from 'react';
import type { Transaction } from '../common/types';
import { cardStyle, mutedStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import { formatSignedMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { goalsHref, orderLinks, transactionLinksPath } from './logic';
import type { GoalTransactionLink, GoalTransactionLinkItem } from './types';

/**
 * Meta a la que respalda una transacción (aporte o retiro, vigente o ya revertido): el nombre enlaza a la meta y el
 * inverso queda marcado, no oculto (add-savings-goals). Presentacional.
 */
export function TransactionGoalView({
  links,
  f,
  href,
}: {
  links: readonly GoalTransactionLinkItem[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="tx-goal-title" style={cardStyle} data-testid="tx-goal">
      <h2 id="tx-goal-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('transaction.title')}
      </h2>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {orderLinks(links).map((l) => (
          <li key={l.movementId} data-testid="tx-goal-link" data-active={l.active ? 'true' : 'false'}>
            <a href={href(goalsHref(l.goalId))} data-testid="tx-goal-name">
              {l.goalName}
            </a>
            : {f.t(`movementKinds.${l.movement}`)} ({f.t(`funds.${l.fund}`)}) ·{' '}
            {formatSignedMoney(l.amount, f.locale)}
            {!l.active ? (
              <span style={mutedStyle} data-testid="tx-goal-reverted">
                {' '}
                · <span aria-hidden="true">↺</span> {f.t('transaction.reverted')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Detalle de transacción: si es una transferencia (o un gasto vinculado como retiro) compone la meta con
 * `GET …/goals/transaction-links?transactionIds=`. Un fallo de esa lectura no afecta al resto del detalle.
 */
export function TransactionGoalInfo({
  ctx,
  tx,
}: {
  ctx: WorkspaceContext;
  tx: Pick<Transaction, 'id' | 'kind' | 'source'>;
}) {
  const f = useFormat('Goals', ctx);
  const [links, setLinks] = useState<readonly GoalTransactionLinkItem[]>([]);
  const { api, base } = ctx;
  const relevant = tx.kind === 'TRANSFER' || tx.kind === 'EXPENSE' || tx.source === 'GOAL';
  useEffect(() => {
    if (!relevant) return;
    let cancelled = false;
    api
      .get<{ data: GoalTransactionLink[] }>(transactionLinksPath(base, [tx.id]))
      .then((r) => {
        if (!cancelled) setLinks(r.data?.data.find((d) => d.transactionId === tx.id)?.links ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, base, tx.id, relevant]);
  return <TransactionGoalView links={links} f={f} href={ctx.href} />;
}
