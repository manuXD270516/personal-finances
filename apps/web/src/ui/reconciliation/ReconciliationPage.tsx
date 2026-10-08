'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import { scaleFor } from '../common/money';
import { Tabs } from '../common/Tabs';
import type { Account, Transaction } from '../common/types';
import { ConfirmPanel, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import type { ReconciliationLifecycle } from '../lifecycle/types';
import { useCatalogs } from '../transactions/catalogs';
import {
  AdjustmentPanel,
  SessionHistory,
  SessionStatusBadge,
  SessionSummary,
  SessionTransactions,
  StartForm,
} from './ReconciliationView';
import {
  differenceState,
  isEditable,
  parseStatementBalance,
  sessionCandidates,
  sessionTransactionsQuery,
  type Reconciliation,
} from './logic';

export function ReconciliationPage({ accountId, sessionId }: { accountId: string; sessionId?: string }) {
  return (
    <WithWorkspace>
      {(ctx) => <Reconcile ctx={ctx} accountId={accountId} {...(sessionId ? { sessionId } : {})} />}
    </WithWorkspace>
  );
}

type Pending = 'cancel' | 'adjust' | null;

/**
 * Pantalla "Reconciliar" de una cuenta (openspec add-reconciliation 6.1): inicia una sesión con la fecha y el saldo
 * del extracto, muestra el saldo confirmado y la diferencia EN VIVO, lista las transacciones hasta esa fecha para
 * confirmarlas o desconfirmarlas, y finaliza con diferencia cero o con un ajuste confirmado con motivo. Pestaña
 * "Recorrido" con la máquina de la sesión. Lectura para todos; escritura para EDITOR/OWNER (la API decide).
 */
function Reconcile({
  ctx,
  accountId,
  sessionId,
}: {
  ctx: WorkspaceContext;
  accountId: string;
  sessionId?: string;
}) {
  const f = useFormat('Reconciliation', ctx);
  const txf = useFormat('Transactions', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const { t, locale } = f;
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [account, setAccount] = useState<Account | undefined>();
  const [sessions, setSessions] = useState<readonly Reconciliation[] | undefined>();
  const [session, setSession] = useState<Reconciliation | undefined>();
  const [transactions, setTransactions] = useState<readonly Transaction[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<{ balance?: string; date?: string }>({});
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  // Sesión que se muestra: la de `?sesion=`, la recién finalizada/cancelada o, por omisión, la que está en curso.
  const [shownId, setShownId] = useState<string | undefined>(sessionId);

  const loadSession = useCallback(
    async (id: string) => {
      const r = await ctx.api.get<Reconciliation>(`${ctx.base}/reconciliations/${id}`);
      const data = r.data;
      if (!data) return;
      setSession(data);
      const txs = await listAll<Transaction>(
        ctx.api,
        `${ctx.base}/transactions`,
        sessionTransactionsQuery(accountId, data.statementDate),
      );
      setTransactions(txs);
    },
    [ctx.api, ctx.base, accountId],
  );

  const load = useCallback(
    async (override?: string) => {
      try {
        const [acc, list] = await Promise.all([
          ctx.api.get<Account>(`${ctx.base}/accounts/${accountId}`),
          listAll<Reconciliation>(ctx.api, `${ctx.base}/reconciliations`, new URLSearchParams({ accountId })),
        ]);
        setAccount(acc.data);
        setSessions(list);
        const chosen = override ?? shownId ?? list.find((s) => s.status === 'IN_PROGRESS')?.id;
        if (chosen) await loadSession(chosen);
        else {
          setSession(undefined);
          setTransactions([]);
        }
        setProblem(undefined);
      } catch (err) {
        setProblem(problemOf(err));
        setSessions((prev) => prev ?? []);
      }
    },
    [ctx.api, ctx.base, accountId, shownId, loadSession],
  );
  useEffect(() => {
    void load();
  }, [load]);

  /** Ejecuta un comando y recarga; si devuelve el id de una sesión, esa es la que se muestra a continuación. */
  const run = async (action: () => Promise<string | undefined | void>, done?: string) => {
    setBusy(true);
    setProblem(undefined);
    try {
      const next = await action();
      if (typeof next === 'string') setShownId(next);
      if (done) setStatus(done);
      setPending(null);
      await load(typeof next === 'string' ? next : undefined);
    } catch (err) {
      setProblem(problemOf(err));
      // Un rechazo por estado obsoleto se resuelve recargando lo vigente.
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!account || sessions === undefined) {
    return problem ? (
      <ProblemMessage problem={problem} locale={ctx.uiLocale} />
    ) : (
      <p aria-busy="true">{t('loading')}</p>
    );
  }
  const scale = scaleFor(account.currency, ctx.scales);
  const liability = account.classification === 'LIABILITY';

  function start(values: { statementDate: string; statementBalance: string }) {
    const parsed = parseStatementBalance(values.statementBalance, {
      locale: ctx.formatLocale,
      currency: account!.currency,
      scale,
    });
    if (!parsed.ok) {
      setFieldError({ balance: t(`start.errors.${parsed.error}`) });
      return;
    }
    setFieldError({});
    void run(async () => {
      const r = await ctx.api.command<Reconciliation>('POST', `${ctx.base}/reconciliations`, {
        accountId,
        statementDate: values.statementDate,
        statementBalance: parsed.value,
      });
      return r.data?.id;
    }, t('done.started'));
  }

  function toggle(tx: Transaction, cleared: boolean) {
    if (!session) return;
    void run(async () => {
      await ctx.api.command<Reconciliation>(
        'POST',
        `${ctx.base}/reconciliations/${session.id}/cleared`,
        { items: [{ id: tx.id, version: tx.version }], cleared },
        { ifMatch: session.version },
      );
    });
  }

  function finish(adjustmentReason?: string) {
    if (!session) return;
    void run(async () => {
      await ctx.api.command<Reconciliation>(
        'POST',
        `${ctx.base}/reconciliations/${session.id}/complete`,
        adjustmentReason ? { adjustment: { reason: adjustmentReason } } : {},
        { ifMatch: session.version },
      );
      // Se queda en la sesión finalizada (solo lectura) para ver su resultado.
      return session.id;
    }, t('done.completed'));
  }

  const state = differenceState(session?.difference ?? null);
  const editable = session ? isEditable(session, ctx.canEdit) : false;
  const candidates = session ? sessionCandidates(transactions, accountId, session.statementDate) : [];
  const inProgress = sessions.find((s) => s.status === 'IN_PROGRESS');
  const sessionHref = (id: string) => ctx.href(`/cuentas/${accountId}/reconciliar?sesion=${id}`);

  const detail = (
    <>
      {session ? (
        <>
          <SessionSummary session={session} f={f} />
          {editable ? (
            <div style={rowStyle} role="group" aria-label={t('actions.label')}>
              <button
                type="button"
                disabled={busy || state === null}
                onClick={() => (state === 'ZERO' ? finish() : setPending('adjust'))}
                data-testid="finish-reconciliation"
              >
                {state === 'ZERO' ? t('actions.finish') : t('actions.finishWithAdjustment')}
              </button>
              <button type="button" disabled={busy} onClick={() => setPending('cancel')}>
                {t('actions.cancel')}
              </button>
            </div>
          ) : null}
          {session.status !== 'IN_PROGRESS' && ctx.canEdit && account.status === 'ACTIVE' ? (
            <div style={rowStyle}>
              <button
                type="button"
                disabled={busy || Boolean(inProgress)}
                data-testid="new-reconciliation"
                onClick={() => {
                  setShownId(undefined);
                  setStatus(undefined);
                  window.history.replaceState(null, '', ctx.href(`/cuentas/${accountId}/reconciliar`));
                }}
              >
                {t('actions.another')}
              </button>
            </div>
          ) : null}
          {pending === 'adjust' && session.difference && state !== 'ZERO' ? (
            <AdjustmentPanel
              difference={session.difference}
              f={f}
              locale={locale}
              busy={busy}
              onConfirm={(reason) => finish(reason)}
              onCancel={() => setPending(null)}
            />
          ) : null}
          {pending === 'cancel' ? (
            <ConfirmPanel
              title={t('cancel.title')}
              description={t('cancel.description')}
              confirmLabel={t('cancel.confirm')}
              cancelLabel={t('cancel.keep')}
              busy={busy}
              onCancel={() => setPending(null)}
              onConfirm={() =>
                void run(async () => {
                  await ctx.api.command<Reconciliation>(
                    'POST',
                    `${ctx.base}/reconciliations/${session.id}/cancel`,
                    undefined,
                    { ifMatch: session.version },
                  );
                  return session.id;
                }, t('done.cancelled'))
              }
            />
          ) : null}
          <section aria-labelledby="rec-list-title" data-testid="reconciliation-list">
            <h2 id="rec-list-title" style={{ fontSize: '1.1rem' }}>
              {t('list.title', { date: formatLocalDate(session.statementDate, locale) })}
            </h2>
            <p style={mutedStyle}>{editable ? t('list.help') : t('list.readOnly')}</p>
            {session.status === 'COMPLETED' && session.items ? (
              <p style={mutedStyle} data-testid="reconciliation-completed-items">
                {t('list.completedItems', { n: session.items.length })}
              </p>
            ) : null}
            <SessionTransactions
              transactions={candidates}
              accountId={accountId}
              names={catalogs.names}
              f={f}
              txf={txf}
              href={ctx.href}
              editable={editable}
              busy={busy}
              onToggle={toggle}
            />
          </section>
        </>
      ) : ctx.canEdit && account.status === 'ACTIVE' ? (
        <StartForm
          f={f}
          currency={account.currency}
          liability={liability}
          today={today}
          busy={busy}
          error={fieldError}
          onSubmit={start}
        />
      ) : (
        <p style={mutedStyle}>{t('noStart')}</p>
      )}
      <section aria-labelledby="rec-history-title">
        <h2 id="rec-history-title" style={{ fontSize: '1.1rem' }}>
          {t('history.title')}
        </h2>
        <SessionHistory sessions={sessions} f={f} href={sessionHref} currentId={session?.id} />
      </section>
    </>
  );

  return (
    <section aria-labelledby="rec-title" style={pageStyle} data-testid="reconciliation-page">
      <p>
        <a href={ctx.href(`/cuentas/${accountId}`)}>{t('backToAccount')}</a>
      </p>
      <h1 id="rec-title" style={{ marginBottom: 0 }}>
        {t('title', { account: account.name })}{' '}
        {session ? <SessionStatusBadge status={session.status} f={f} /> : null}
      </h1>
      <p style={mutedStyle}>
        {liability ? t('introLiability') : t('intro')}
        {inProgress && !session ? ` ${t('inProgressElsewhere')}` : ''}
      </p>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {session ? (
        <Tabs
          idPrefix="reconciliation"
          label={lf.t('tabs.label')}
          tabs={[
            { id: 'detail', label: t('tabs.reconcile'), content: detail },
            {
              id: 'lifecycle',
              label: lf.t('tabs.lifecycle'),
              content: (
                <LifecycleTab
                  ctx={ctx}
                  path={`reconciliations/${session.id}`}
                  refreshKey={session.version}
                  stateLabel={(code) => (f.has(`status.${code}`) ? t(`status.${code}`) : code)}
                  fieldLabel={(name) => (f.has(`fields.${name}`) ? t(`fields.${name}`) : name)}
                  accountName={(id) => catalogs.names.account(id)}
                  idPrefix="reconciliation-lifecycle"
                  extra={(row, lifecycle) => {
                    const life = lifecycle as ReconciliationLifecycle;
                    const r = life.reconciliation;
                    if (!r || row.kind !== 'TRANSITION') return null;
                    if (row.transition === 'START')
                      return (
                        <p style={{ margin: '0.25rem 0' }} data-testid="rec-lifecycle-start">
                          {t('lifecycle.start', {
                            date: formatLocalDate(r.statementDate, locale),
                            balance: formatMoney(r.statementBalance, locale),
                          })}
                        </p>
                      );
                    if (row.transition === 'COMPLETE')
                      return (
                        <p style={{ margin: '0.25rem 0' }} data-testid="rec-lifecycle-complete">
                          {t('lifecycle.complete', {
                            cleared: r.clearedBalance ? formatMoney(r.clearedBalance, locale) : '—',
                            difference: r.difference ? formatMoney(r.difference, locale) : '—',
                          })}
                          {r.adjustmentTransactionId ? (
                            <>
                              {' · '}
                              <a href={ctx.href(`/transacciones/${r.adjustmentTransactionId}`)}>
                                {t('lifecycle.adjustment')}
                              </a>
                            </>
                          ) : null}
                        </p>
                      );
                    return null;
                  }}
                />
              ),
            },
          ]}
        />
      ) : (
        detail
      )}
    </section>
  );
}
