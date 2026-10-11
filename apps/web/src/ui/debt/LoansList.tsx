'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cellStyle, mutedStyle, numCellStyle, pageStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { debtHref, loanPath, loansPath } from './logic';
import { debtText, LoanStatusBadge } from './Tables';
import type { Loan, LoanDetail } from './types';

export interface LoanRowData {
  readonly loan: Loan;
  /** Detalle con el principal pendiente y la próxima cuota (puede faltar si su carga falló). */
  readonly detail?: LoanDetail | undefined;
}

/** Lista de préstamos: nombre, estado, deuda (principal pendiente), próxima cuota con su fecha y atraso. */
export function LoansTable({
  items,
  f,
  href,
}: {
  items: readonly LoanRowData[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('list.region')}>
      <table style={tableStyle} data-testid="loans-table">
        <caption className="pf-sr-only">{f.t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('list.name')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.state')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('list.outstanding')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.next')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.overdue')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ loan, detail }) => {
            const next = detail?.nextInstallment ?? null;
            const outstanding = detail?.outstandingPrincipal ?? null;
            return (
              <tr key={loan.id} data-testid="loan-row" data-status={loan.status} data-name={loan.name}>
                <th scope="row" style={cellStyle}>
                  <a href={href(debtHref(loan.id))} data-testid="loan-link">
                    {loan.name}
                  </a>
                  {loan.lenderName ? <div style={mutedStyle}>{loan.lenderName}</div> : null}
                </th>
                <td style={cellStyle}>
                  <LoanStatusBadge status={loan.status} f={f} />
                </td>
                <td style={numCellStyle} data-testid="loan-outstanding">
                  {outstanding ? debtText(f, outstanding) : '—'}
                </td>
                <td style={cellStyle} data-testid="loan-next">
                  {next ? (
                    <>
                      {f.t('list.nextValue', {
                        n: next.n,
                        date: formatBusinessDate(next.dueDate),
                        amount: formatMoney(next.outstanding, f.locale),
                      })}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={cellStyle} data-testid="loan-overdue">
                  {next && next.overdueDays > 0 ? (
                    <span style={{ color: 'var(--pf-error)' }}>
                      <span aria-hidden="true">⚠</span> {f.t('list.overdueDays', { days: next.overdueDays })}
                    </span>
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
  );
}

export function LoansListPage() {
  return <WithWorkspace>{(ctx) => <LoansList ctx={ctx} />}</WithWorkspace>;
}

const MAX_DETAILS = 50;

function LoansList({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Debt', ctx);
  const [items, setItems] = useState<readonly LoanRowData[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await ctx.api.get<{ data: Loan[] }>(loansPath(ctx.base))).data?.data ?? [];
        // El listado trae solo las condiciones: el principal pendiente y la próxima cuota salen del detalle.
        const rows = await Promise.all(
          list.map(async (loan, index): Promise<LoanRowData> => {
            if (index >= MAX_DETAILS || (loan.status !== 'ACTIVE' && loan.status !== 'PAID_OFF'))
              return { loan };
            try {
              return { loan, detail: (await ctx.api.get<LoanDetail>(loanPath(ctx.base, loan.id))).data };
            } catch {
              return { loan };
            }
          }),
        );
        if (!cancelled) setItems(rows);
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setProblem(problemOf(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  return (
    <section aria-labelledby="debts-title" style={pageStyle} data-testid="debts-page">
      <h1 id="debts-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {ctx.canEdit ? (
        <p style={{ margin: 0 }}>
          <a href={ctx.href('/debts/nuevo')} data-testid="new-loan">
            {f.t('list.new')}
          </a>
        </p>
      ) : (
        <p style={mutedStyle}>{f.t('viewerNotice')}</p>
      )}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : items.length === 0 ? (
        <p style={mutedStyle} data-testid="loans-empty">
          {f.t('list.empty')}
        </p>
      ) : (
        <LoansTable items={items} f={f} href={ctx.href} />
      )}
    </section>
  );
}
