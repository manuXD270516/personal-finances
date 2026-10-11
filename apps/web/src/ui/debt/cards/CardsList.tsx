'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import { cardStyle, cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../../common/workspace';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import { cardHref, cardsPath, NEW_CARD_HREF } from './logic';
import { StatementStatusBadge, UtilizationMeter } from './parts';
import type { CardAccount, CreditCard } from './types';

/** Utilización de una cuenta: la propia (límite separado) o la compartida de la tarjeta. */
function utilizationOf(card: CreditCard, account: CardAccount) {
  return account.utilization ?? card.utilization.find((u) => u.scope === 'SHARED') ?? null;
}

/**
 * Una tarjeta del listado: nombre (enlace al detalle), cierre y vencimiento, y por cuenta el saldo adeudado, el crédito
 * usado, la utilización (texto + barra), lo disponible, el próximo vencimiento y lo que falta pagar del último estado.
 */
export function CardSummary({
  card,
  f,
  href,
}: {
  card: CreditCard;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const shared = card.utilization.find((u) => u.scope === 'SHARED');
  return (
    <article
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="card-item"
      data-name={card.name}
      data-status={card.status}
      aria-labelledby={`card-${card.id}-name`}
    >
      <header style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
        <h3 id={`card-${card.id}-name`} style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>
          <a href={href(cardHref(card.id))} data-testid="card-link">
            {card.name}
          </a>
          {card.status === 'ARCHIVED' ? <span style={mutedStyle}> · {f.t('status.ARCHIVED')}</span> : null}
        </h3>
        <p style={{ ...mutedStyle, margin: 0 }}>
          {f.t('list.calendar', { statementDay: card.statementDay, dueDay: card.dueDay })}
        </p>
      </header>
      {shared ? (
        <div data-testid="card-shared-limit">
          <p style={{ margin: 0 }}>
            {f.t('list.sharedLimit', {
              limit: formatMoney(shared.limit, f.locale),
              used: shared.used ? formatMoney(shared.used, f.locale) : '—',
              available: shared.available ? formatMoney(shared.available, f.locale) : '—',
            })}
          </p>
          <UtilizationMeter
            utilization={shared}
            thresholds={card.utilizationThresholds}
            f={f}
            label={f.t('utilization.labelShared', { name: card.name })}
          />
        </div>
      ) : null}
      <div
        style={tableWrapStyle}
        tabIndex={0}
        role="region"
        aria-label={f.t('list.region', { name: card.name })}
      >
        <table style={tableStyle} data-testid="card-accounts">
          <caption className="pf-sr-only">{f.t('list.caption', { name: card.name })}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('list.account')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('list.balance')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('list.used')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('list.utilization')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('list.available')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('list.nextDue')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('list.missing')}
              </th>
            </tr>
          </thead>
          <tbody>
            {card.accounts.map((a) => {
              const u = utilizationOf(card, a);
              const last = a.lastStatement;
              return (
                <tr key={a.id} data-testid="card-account-row" data-currency={a.currency}>
                  <th scope="row" style={cellStyle}>
                    {a.currency}
                    {a.paymentPlan ? (
                      <div style={mutedStyle} data-testid="card-plan-flag">
                        {f.t('list.planActive')}
                      </div>
                    ) : null}
                  </th>
                  <td style={numCellStyle} data-testid="card-balance">
                    {formatMoney(a.balance, f.locale)}
                  </td>
                  <td style={numCellStyle} data-testid="card-used">
                    {formatMoney(a.creditUsed, f.locale)}
                  </td>
                  <td style={cellStyle}>
                    {shared ? (
                      <span style={mutedStyle}>{f.t('list.sharedRef')}</span>
                    ) : (
                      <UtilizationMeter
                        utilization={u}
                        thresholds={card.utilizationThresholds}
                        f={f}
                        label={f.t('utilization.label', { name: card.name, currency: a.currency })}
                      />
                    )}
                  </td>
                  <td style={numCellStyle} data-testid="card-available">
                    {!shared && u?.available ? formatMoney(u.available, f.locale) : '—'}
                  </td>
                  <td style={cellStyle} data-testid="card-next-due">
                    {formatBusinessDate(a.nextDueDate)}
                  </td>
                  <td style={numCellStyle} data-testid="card-missing">
                    {last ? (
                      <>
                        {formatMoney(last.remainingNoInterest, f.locale)}
                        <div>
                          <StatementStatusBadge status={last.status} f={f} />
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function CardsGrid({
  cards,
  f,
  href,
}: {
  cards: readonly CreditCard[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }} data-testid="cards-list">
      {cards.map((c) => (
        <CardSummary key={c.id} card={c} f={f} href={href} />
      ))}
    </div>
  );
}

/** Pestaña Tarjetas de `/debts`: tarjetas con utilización, disponible y próximo vencimiento; alta solo EDITOR/OWNER. */
export function CardsPanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Cards', ctx);
  const [cards, setCards] = useState<readonly CreditCard[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ data: CreditCard[] }>(cardsPath(ctx.base))
      .then((r) => {
        if (!cancelled) setCards(r.data?.data ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCards([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  return (
    <section
      aria-labelledby="cards-title"
      style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
      data-testid="cards-panel"
    >
      <h2 id="cards-title" style={{ margin: 0, fontSize: 'var(--pf-text-xl)' }}>
        {f.t('title')}
      </h2>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {ctx.canEdit ? (
        <p style={{ margin: 0 }}>
          <a href={ctx.href(NEW_CARD_HREF)} data-testid="new-card">
            {f.t('list.new')}
          </a>
        </p>
      ) : (
        <p style={mutedStyle}>{f.t('viewerNotice')}</p>
      )}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {cards === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : cards.length === 0 ? (
        <p style={mutedStyle} data-testid="cards-empty">
          {f.t('list.empty')}
        </p>
      ) : (
        <CardsGrid cards={cards} f={f} href={ctx.href} />
      )}
    </section>
  );
}
