'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemMessage } from '../../errors/error-messages';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import { mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { formatBusinessDate } from '../planning/logic';
import { cardHref, cardPaymentName } from '../debt/cards/logic';
import { useCardLookup } from '../debt/cards/useCardLookup';
import { paymentHref } from '../debt/logic';
import { useLoanLookup } from '../debt/useLoanLookup';
import { useCatalogs } from '../transactions/catalogs';
import { AmountText, OccurrenceStatusBadge } from './Badges';
import { MatchSuggestionsNotice } from './MatchSuggestionsPanel';
import { OccurrenceActionPanel } from './OccurrenceActionPanel';
import { actionButtonId } from './OccurrencesTable';
import {
  availableOccurrenceActions,
  canRegisterLoanPayment,
  definitionPath,
  isCardPayment,
  isLoanInstallment,
  type OccurrenceAction,
} from './logic';
import type { RecurringOccurrence } from './types';

export function OccurrenceDetailPage({ occurrenceId }: { occurrenceId: string }) {
  return <WithWorkspace>{(ctx) => <Detail ctx={ctx} occurrenceId={occurrenceId} />}</WithWorkspace>;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly occurrence: RecurringOccurrence };

/**
 * Detalle de una ocurrencia (`/recurring/occurrences/{id}`, destino del enlace de las notificaciones): estado, monto,
 * fechas, transacción resultante, las acciones Aprobar, Vincular, Omitir y Editar mientras no esté resuelta y su recorrido.
 */
function Detail({ ctx, occurrenceId }: { ctx: WorkspaceContext; occurrenceId: string }) {
  const f = useFormat('Recurring', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const loans = useLoanLookup(ctx, loaded.status === 'ready' && isLoanInstallment(loaded.occurrence));
  const cards = useCardLookup(
    ctx.api,
    ctx.base,
    loaded.status === 'ready' && isCardPayment(loaded.occurrence),
  );
  const [action, setAction] = useState<OccurrenceAction | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const r = await ctx.api.get<RecurringOccurrence>(`${ctx.base}/recurring/occurrences/${occurrenceId}`);
      setLoaded({ status: 'ready', occurrence: r.data! });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    }
  }, [ctx.api, ctx.base, occurrenceId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p data-testid="occurrence-loading">{f.t('loading')}</p>
      </section>
    );
  if (loaded.status !== 'ready')
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        {loaded.status === 'notFound' ? (
          <p role="alert" data-error-code="RESOURCE_NOT_FOUND" data-testid="occurrence-not-found">
            {f.t('occurrence.notFound')}
          </p>
        ) : (
          <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        )}
        <p>
          <a href={ctx.href('/recurring')}>{f.t('detail.back')}</a>
        </p>
      </section>
    );

  const o = loaded.occurrence;
  const actions = availableOccurrenceActions(o, ctx.canEdit);
  const currencyOf = (id: string) => catalogs.accounts.find((a) => a.id === id)?.currency;
  const rows: [string, ReactNode][] = [
    [f.t('occurrence.dueDate'), formatBusinessDate(o.dueDate)],
    [f.t('occurrence.nominalDate'), formatBusinessDate(o.occurrenceDate)],
    [f.t('columns.amount'), <AmountText key="amount" expected={o.expected} f={f} />],
    [
      f.t('columns.account'),
      `${catalogs.names.account(o.accountId) ?? '—'}${o.toAccountId ? ` → ${catalogs.names.account(o.toAccountId) ?? '—'}` : ''}`,
    ],
    [f.t('occurrence.mode'), f.t(`modes.${o.mode}`)],
    [f.t('occurrence.version'), `v${o.definitionVersionNo}`],
  ];
  if (o.overridden) rows.push([f.t('occurrence.edited'), f.t('occurrence.editedValue')]);
  if (o.cancelReason) rows.push([f.t('occurrence.cancelReason'), f.t(`cancelReasons.${o.cancelReason}`)]);
  if (o.skipReason) rows.push([f.t('occurrence.skipReason'), o.skipReason]);
  if (o.matchedBy) rows.push([f.t('occurrence.matchedBy'), f.t(`matchedBy.${o.matchedBy}`)]);

  return (
    <section
      aria-labelledby="occurrence-title"
      style={pageStyle}
      data-testid="occurrence-detail"
      data-status={o.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/recurring')}>{f.t('detail.back')}</a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="occurrence-title" style={{ margin: 0 }}>
          {isCardPayment(o)
            ? f.t('cardPayment.label', { name: cardPaymentName(o.definitionName) })
            : o.definitionName}
        </h1>
        <OccurrenceStatusBadge status={o.status} f={f} />
      </div>
      <p style={mutedStyle}>
        {f.t(`kinds.${o.kind}`)} ·{' '}
        <a href={ctx.href(definitionPath(o.definitionId))} data-testid="occurrence-definition-link">
          {f.t('occurrence.viewDefinition')}
        </a>
      </p>
      {o.lastAutoCreateError ? (
        <p
          role="note"
          data-testid="auto-create-error"
          data-error-code={o.lastAutoCreateError}
          style={{ color: 'var(--pf-error)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>{' '}
          {f.t('autoCreateError', { error: problemMessage({ code: o.lastAutoCreateError }, ctx.uiLocale) })}
        </p>
      ) : null}
      {status ? (
        <p role="status" data-testid="occurrence-status-message">
          {status}
        </p>
      ) : null}
      {o.status === 'SCHEDULED' || o.status === 'DUE' || o.status === 'OVERDUE' ? (
        <MatchSuggestionsNotice
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          scope={{ kind: 'occurrence', occurrenceId: o.id }}
          refreshKey={o.version}
          onChanged={(message) => {
            setStatus(message);
            void load();
          }}
        />
      ) : null}
      {isCardPayment(o) ? (
        <p style={mutedStyle} data-testid="occurrence-card">
          {o.expected.type === 'ESTIMATED' ? `${f.t('cardPayment.estimatedNote')} ` : ''}
          <a
            href={ctx.href(
              cards.ofDefinition(o.definitionId)
                ? cardHref(cards.ofDefinition(o.definitionId)!.id)
                : '/debts?vista=tarjetas',
            )}
            data-testid="occurrence-card-link"
          >
            {cards.ofDefinition(o.definitionId)
              ? f.t('cardPayment.viewCard', { name: cards.ofDefinition(o.definitionId)!.name })
              : f.t('cardPayment.viewCards')}
          </a>
        </p>
      ) : null}
      {isLoanInstallment(o) ? (
        <p style={mutedStyle} data-testid="occurrence-loan">
          {f.t('loan.managedNotice')}{' '}
          <a
            href={ctx.href(
              loans.ofDefinition(o.definitionId)
                ? `/debts/${loans.ofDefinition(o.definitionId)!.id}`
                : '/debts',
            )}
          >
            {loans.ofDefinition(o.definitionId)?.name ?? f.t('loan.viewLoans')}
          </a>
          {canRegisterLoanPayment(o, ctx.canEdit) ? (
            <>
              {' · '}
              <a
                href={ctx.href(
                  loans.ofDefinition(o.definitionId)
                    ? paymentHref(loans.ofDefinition(o.definitionId)!.id, { date: o.dueDate })
                    : '/debts',
                )}
                data-testid="occurrence-register-payment"
              >
                {f.t('loan.registerPayment')}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <div style={rowStyle} role="group" aria-label={f.t('detail.actions')}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              id={actionButtonId(o.id, a)}
              data-action={a}
              onClick={() => setAction(a)}
            >
              {f.t(`actions.${a}`)}
            </button>
          ))}
        </div>
      ) : null}
      {action ? (
        <OccurrenceActionPanel
          key={action}
          ctx={ctx}
          f={f}
          action={action}
          occurrence={o}
          currencyOf={currencyOf}
          today={today}
          onCancel={() => {
            setAction(undefined);
            setTimeout(() => document.getElementById(actionButtonId(o.id, action))?.focus(), 0);
          }}
          onDone={(_updated, message) => {
            setAction(undefined);
            setStatus(message);
            void load();
          }}
        />
      ) : null}
      <Tabs
        idPrefix="occurrence"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <>
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content 1fr',
                    gap: 'var(--pf-space-1) var(--pf-space-4)',
                    margin: 0,
                  }}
                >
                  {rows.map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt style={mutedStyle}>{label}</dt>
                      <dd style={{ margin: 0 }}>{value}</dd>
                    </div>
                  ))}
                </dl>
                {o.transactionId ? (
                  <p>
                    <a
                      href={ctx.href(`/transacciones/${o.transactionId}`)}
                      data-testid="occurrence-transaction-link"
                    >
                      {f.t('occurrence.viewTransaction')}
                    </a>
                  </p>
                ) : null}
              </>
            ),
          },
          {
            id: 'lifecycle',
            label: lf.t('tabs.lifecycle'),
            content: (
              <LifecycleTab
                ctx={ctx}
                path={`recurring/occurrences/${o.id}`}
                refreshKey={o.version}
                stateLabel={(code) => (f.has(`status.${code}`) ? f.t(`status.${code}`) : code)}
                idPrefix="occurrence-lifecycle"
              />
            ),
          },
        ]}
      />
    </section>
  );
}
