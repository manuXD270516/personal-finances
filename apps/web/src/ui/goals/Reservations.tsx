'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cellStyle, mutedStyle, numCellStyle, pageStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { goalsHref, reservationsPath, shortfallOf, sortReservations } from './logic';
import { OverAllocatedMark } from './parts';
import type { AccountReservation, AccountReservationList } from './types';

/**
 * Reservas por cuenta: saldo, reservado, disponible y faltante (cuando está sobre-asignada), con las metas que
 * reservan en cada cuenta. El estado se dice con texto + icono; el disponible negativo no se esconde.
 */
export function ReservationsTable({
  items,
  f,
  href,
}: {
  items: readonly AccountReservation[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('reservations.region')}>
      <table style={tableStyle} data-testid="reservations-table">
        <caption className="pf-sr-only">{f.t('reservations.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('reservations.account')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('reservations.balance')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('reservations.reserved')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('reservations.available')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('reservations.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('reservations.goals')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortReservations(items).map((r) => {
            const shortfall = shortfallOf(r);
            const money = (amount: string) => formatMoney({ amount, currency: r.currency }, f.locale);
            return (
              <tr
                key={r.accountId}
                data-testid="reservation-row"
                data-account-id={r.accountId}
                data-over-allocated={r.overAllocated ? 'true' : 'false'}
              >
                <th scope="row" style={cellStyle}>
                  <a href={href(`/cuentas/${r.accountId}`)}>{r.accountName}</a>
                  {r.accountStatus !== 'ACTIVE' ? (
                    <div style={mutedStyle}>{f.t(`reservations.accountStatus.${r.accountStatus}`)}</div>
                  ) : null}
                </th>
                <td style={numCellStyle} data-testid="reservation-balance">
                  {money(r.balance)}
                </td>
                <td style={numCellStyle} data-testid="reservation-reserved">
                  {money(r.reserved)}
                </td>
                <td style={numCellStyle} data-testid="reservation-available">
                  {money(r.available)}
                </td>
                <td style={cellStyle}>
                  {r.overAllocated ? (
                    <>
                      <OverAllocatedMark f={f} />
                      {shortfall ? (
                        <div data-testid="reservation-shortfall">
                          {f.t('reservations.shortfall', { amount: money(shortfall) })}
                        </div>
                      ) : null}
                      {r.since ? (
                        <div style={mutedStyle}>
                          {f.t('reservations.since', { date: formatBusinessDate(r.since) })}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span style={mutedStyle}>
                      <span aria-hidden="true">✓</span> {f.t('reservations.ok')}
                    </span>
                  )}
                </td>
                <td style={cellStyle}>
                  {r.goals.length === 0 ? (
                    '—'
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                      {r.goals.map((g) => (
                        <li key={g.goalId} data-testid="reservation-goal">
                          <a href={href(goalsHref(g.goalId))}>{g.name}</a>:{' '}
                          {f.t('reservations.goalFunds', {
                            earmarked: money(g.earmarked),
                            real: money(g.realHeld),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReservationsPage({ accountId }: { accountId?: string | undefined }) {
  return <WithWorkspace>{(ctx) => <Reservations ctx={ctx} accountId={accountId} />}</WithWorkspace>;
}

function Reservations({ ctx, accountId }: { ctx: WorkspaceContext; accountId: string | undefined }) {
  const f = useFormat('Goals', ctx);
  const [items, setItems] = useState<readonly AccountReservation[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const { api, base } = ctx;
  useEffect(() => {
    let cancelled = false;
    api
      .get<AccountReservationList>(reservationsPath(base, accountId))
      .then((r) => {
        if (!cancelled) setItems(r.data?.data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([]);
          setProblem(problemOf(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, base, accountId]);
  return (
    <section aria-labelledby="reservations-title" style={pageStyle} data-testid="reservations-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/goals')}>{f.t('back')}</a>
      </p>
      <h1 id="reservations-title">{f.t('reservations.title')}</h1>
      <p style={mutedStyle}>{f.t('reservations.intro')}</p>
      {accountId ? (
        <p style={mutedStyle}>
          {f.t('reservations.filtered')} <a href={ctx.href('/goals/reservas')}>{f.t('reservations.all')}</a>
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : items.length === 0 ? (
        <p style={mutedStyle} data-testid="reservations-empty">
          {f.t('reservations.empty')}
        </p>
      ) : (
        <ReservationsTable items={items} f={f} href={ctx.href} />
      )}
    </section>
  );
}
