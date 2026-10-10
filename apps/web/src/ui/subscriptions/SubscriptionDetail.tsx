'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { AuditHistory, formatDecimal } from '../AuditHistory';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import { ConfirmPanel, Field, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { formatBusinessDate } from '../planning/logic';
import { notifyRecurringChanged } from '../recurring/logic';
import { useCatalogs } from '../transactions/catalogs';
import { MoneyText, SubscriptionStatusBadge, cycleSummary } from './Badges';
import { ChargesSection } from './ChargesSection';
import { PriceForm, PriceHistoryTable, ProposalCard, ProposalGone, SupersedeForm } from './PriceSections';
import { SubscriptionFormView } from './SubscriptionForm';
import { SubscriptionsPage } from './SubscriptionsPage';
import {
  availableActions,
  buildCancelBody,
  currencyMismatch,
  formFromSubscription,
  type CancelMode,
} from './logic';
import type { Subscription, SubscriptionPrice } from './types';

export function SubscriptionDetailPage({
  subscriptionId,
  proposalId,
  fromList = false,
}: {
  subscriptionId: string;
  /** `?propuesta=`: resalta la propuesta pendiente (enlace de la notificación de cambio de precio). */
  proposalId?: string;
  /** `?historial=1`: acceso desde el listado (una cancelada sí se consulta; desde una notificación, no). */
  fromList?: boolean;
}) {
  return (
    <WithWorkspace>
      {(ctx) => (
        <Detail ctx={ctx} subscriptionId={subscriptionId} proposalId={proposalId} fromList={fromList} />
      )}
    </WithWorkspace>
  );
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly subscription: Subscription };

type Panel = 'pause' | 'resume' | 'cancel' | 'undo' | 'edit' | 'price' | undefined;

/**
 * Detalle de una suscripción (`/recurring/suscripciones/{id}`, openspec add-subscriptions 6.2): resumen, propuesta de
 * precio pendiente (aceptar/rechazar), historial de precios con sus reemplazos, cargos con tasa implícita o desvío y
 * monto del extracto, recorrido y las acciones Editar, Pausar/Reanudar, Cancelar (ahora o al fin del ciclo), Deshacer
 * la cancelación programada y Registrar precio. Si no existe, o está cancelada y se llegó desde una notificación, se
 * muestra el listado con el aviso "esta suscripción ya no está disponible".
 */
function Detail({
  ctx,
  subscriptionId,
  proposalId,
  fromList,
}: {
  ctx: WorkspaceContext;
  subscriptionId: string;
  proposalId: string | undefined;
  fromList: boolean;
}) {
  const f = useFormat('Subscriptions', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [panel, setPanel] = useState<Panel>();
  const [supersede, setSupersede] = useState<SubscriptionPrice | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const firstLoad = useRef(true);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await ctx.api.get<Subscription>(`${ctx.base}/subscriptions/${subscriptionId}`);
      const sub = r.data!;
      // Desde una notificación, una suscripción cancelada ya no está disponible (solo la primera carga decide).
      if (firstLoad.current && sub.status === 'CANCELLED' && !fromList) setLoaded({ status: 'unavailable' });
      else setLoaded({ status: 'ready', subscription: sub });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'unavailable' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    } finally {
      firstLoad.current = false;
    }
  }, [ctx.api, ctx.base, subscriptionId, fromList]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p data-testid="subscription-loading">{f.t('loading')}</p>
      </section>
    );
  if (loaded.status === 'unavailable') return <SubscriptionsPage unavailable />;
  if (loaded.status === 'error')
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        <p>
          <a href={ctx.href('/recurring/suscripciones')}>{f.t('detail.back')}</a>
        </p>
      </section>
    );

  const sub = loaded.subscription;
  const actions = availableActions(sub, ctx.canEdit);
  const reload = (message?: string) => {
    setPanel(undefined);
    setSupersede(undefined);
    if (message) setStatus(message);
    setRefreshKey((k) => k + 1);
    notifyRecurringChanged();
  };

  async function run(request: () => Promise<unknown>, done: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      await request();
      reload(done);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const base = `${ctx.base}/subscriptions/${sub.id}`;
  const transition = (kind: 'pause' | 'resume') =>
    run(
      () =>
        ctx.api.command('POST', `${base}/${kind}`, undefined, { ifMatch: sub.version, idempotent: false }),
      f.t(`detail.done.${kind}`, { name: sub.name }),
    );
  const proposal = sub.pendingProposal ?? null;
  const highlighted = proposalId !== undefined && proposal?.id === proposalId;
  const mismatch =
    sub.definition?.indexed === true || currencyMismatch(sub.currentPrice.currency, sub.accountCurrency);

  return (
    <section
      aria-labelledby="subscription-title"
      style={pageStyle}
      data-testid="subscription-detail"
      data-status={sub.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/recurring/suscripciones')} data-testid="subscription-back">
          {f.t('detail.back')}
        </a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="subscription-title" style={{ margin: 0 }}>
          {sub.name}
        </h1>
        <SubscriptionStatusBadge status={sub.status} f={f} />
      </div>
      <p style={mutedStyle}>
        {[sub.providerName, sub.planName].filter(Boolean).join(' · ') || '—'} ·{' '}
        {cycleSummary(sub.billingCycle, f)}
      </p>
      {sub.scheduledCancellationOn && sub.status !== 'CANCELLED' ? (
        <p role="note" data-testid="scheduled-cancellation">
          <span aria-hidden="true">⏳</span>{' '}
          {f.t('detail.scheduledCancellation', { date: formatBusinessDate(sub.scheduledCancellationOn) })}
        </p>
      ) : null}
      {sub.status === 'CANCELLED' ? (
        <p role="note" data-testid="cancelled-note">
          {f.t('detail.cancelledOn', { date: sub.cancelledOn ? formatBusinessDate(sub.cancelledOn) : '—' })}
          {sub.cancellationReason ? ` ${f.t('detail.cancelReason', { reason: sub.cancellationReason })}` : ''}
        </p>
      ) : null}
      {status ? (
        <p ref={statusRef} tabIndex={-1} role="status" data-testid="subscription-status-message">
          {status}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {proposalId && !highlighted ? <ProposalGone f={f} /> : null}

      {ctx.canEdit && sub.status !== 'CANCELLED' ? (
        <div style={rowStyle} role="group" aria-label={f.t('detail.actions')}>
          {actions.edit ? (
            <button
              type="button"
              data-testid="edit-subscription"
              disabled={busy}
              onClick={() => setPanel('edit')}
            >
              {f.t('detail.edit')}
            </button>
          ) : null}
          {actions.addPrice ? (
            <button type="button" data-testid="add-price" disabled={busy} onClick={() => setPanel('price')}>
              {f.t('detail.addPrice')}
            </button>
          ) : null}
          {actions.pause ? (
            <button
              type="button"
              data-testid="pause-subscription"
              disabled={busy}
              onClick={() => setPanel('pause')}
            >
              {f.t('detail.pause')}
            </button>
          ) : null}
          {actions.resume ? (
            <button
              type="button"
              data-testid="resume-subscription"
              disabled={busy}
              onClick={() => setPanel('resume')}
            >
              {f.t('detail.resume')}
            </button>
          ) : null}
          {actions.undoCancellation ? (
            <button
              type="button"
              data-testid="undo-cancellation"
              disabled={busy}
              onClick={() => setPanel('undo')}
            >
              {f.t('detail.undoCancellation')}
            </button>
          ) : null}
          {actions.cancel ? (
            <button
              type="button"
              data-testid="cancel-subscription"
              disabled={busy}
              onClick={() => setPanel('cancel')}
            >
              {f.t('detail.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}

      {panel === 'pause' ? (
        <ConfirmPanel
          testId="pause-panel"
          title={f.t('detail.pauseTitle', { name: sub.name })}
          description={f.t('detail.pauseDescription')}
          confirmLabel={f.t('detail.pause')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void transition('pause')}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'resume' ? (
        <ConfirmPanel
          testId="resume-panel"
          title={f.t('detail.resumeTitle', { name: sub.name })}
          description={f.t('detail.resumeDescription')}
          confirmLabel={f.t('detail.resume')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void transition('resume')}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'undo' ? (
        <ConfirmPanel
          testId="undo-panel"
          title={f.t('detail.undoTitle', { name: sub.name })}
          description={f.t('detail.undoDescription', {
            date: sub.scheduledCancellationOn ? formatBusinessDate(sub.scheduledCancellationOn) : '—',
          })}
          confirmLabel={f.t('detail.undoCancellation')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() =>
            void run(
              () =>
                ctx.api.command('POST', `${base}/scheduled-cancellation/undo`, undefined, {
                  ifMatch: sub.version,
                  idempotent: false,
                }),
              f.t('detail.done.undo', { name: sub.name }),
            )
          }
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'cancel' ? (
        <CancelPanel
          f={f}
          subscription={sub}
          busy={busy}
          onConfirm={(mode, reason) =>
            void run(
              () =>
                ctx.api.command('POST', `${base}/cancel`, buildCancelBody(mode, sub.nextRenewalOn, reason), {
                  ifMatch: sub.version,
                  idempotent: false,
                }),
              mode === 'NOW'
                ? f.t('detail.done.cancel', { name: sub.name })
                : f.t('detail.done.cancelScheduled', {
                    name: sub.name,
                    date: sub.nextRenewalOn ? formatBusinessDate(sub.nextRenewalOn) : '—',
                  }),
            )
          }
          onCancel={() => setPanel(undefined)}
          canCycleEnd={actions.cancelAtCycleEnd}
        />
      ) : null}
      {panel === 'edit' ? (
        <SubscriptionFormView
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          today={today}
          mode="edit"
          initial={formFromSubscription(sub)}
          subscription={sub}
          onCancel={() => setPanel(undefined)}
          onSaved={() => reload(f.t('detail.done.edit', { name: sub.name }))}
        />
      ) : null}
      {panel === 'price' ? (
        <PriceForm
          ctx={ctx}
          f={f}
          subscription={sub}
          today={today}
          onCancel={() => setPanel(undefined)}
          onSaved={() => reload(f.t('detail.done.price'))}
        />
      ) : null}
      {supersede ? (
        <SupersedeForm
          ctx={ctx}
          f={f}
          subscription={sub}
          entry={supersede}
          onCancel={() => setSupersede(undefined)}
          onSaved={() => reload(f.t('detail.done.supersede'))}
        />
      ) : null}

      {proposal ? (
        <ProposalCard
          ctx={ctx}
          f={f}
          subscription={sub}
          canDecide={actions.decideProposal}
          highlighted={highlighted}
          onChanged={(message) => reload(message)}
        />
      ) : null}

      <Tabs
        idPrefix="subscription"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <>
                <Summary
                  subscription={sub}
                  f={f}
                  ctx={ctx}
                  mismatch={mismatch}
                  categoryName={(id) => catalogs.names.category(id)}
                />
                <section
                  aria-labelledby="history-title"
                  style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
                >
                  <h2 id="history-title">{f.t('history.title')}</h2>
                  <PriceHistoryTable
                    history={sub.priceHistory ?? []}
                    f={f}
                    locale={ctx.formatLocale}
                    today={today}
                    canSupersede={actions.supersede}
                    onSupersede={(entry) => {
                      setPanel(undefined);
                      setSupersede(entry);
                    }}
                  />
                </section>
                <ChargesSection
                  ctx={ctx}
                  f={f}
                  subscription={sub}
                  canRecord={actions.recordStatement}
                  refreshKey={refreshKey}
                  onChanged={(message) => reload(message)}
                />
              </>
            ),
          },
          {
            id: 'lifecycle',
            label: lf.t('tabs.lifecycle'),
            content: (
              <LifecycleTab
                ctx={ctx}
                path={`subscriptions/${sub.id}`}
                refreshKey={`${sub.version}-${refreshKey}`}
                stateLabel={(code) => (f.has(`status.${code}`) ? f.t(`status.${code}`) : code)}
                idPrefix="subscription-lifecycle"
              />
            ),
          },
          ...(ctx.canEdit
            ? [
                {
                  id: 'history',
                  label: lf.t('tabs.history'),
                  content: (
                    <AuditHistory
                      workspaceId={ctx.ws.id}
                      aggregateType="Subscription"
                      aggregateId={sub.id}
                      role={ctx.ws.role}
                      locale={ctx.formatLocale}
                      timeZone={ctx.timeZone}
                      refreshKey={sub.version}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

/** Cancelar ahora o al fin del ciclo pagado (la fecha de la próxima renovación, que ya no se cobrará), con motivo opcional. */
function CancelPanel({
  f,
  subscription,
  busy,
  canCycleEnd,
  onConfirm,
  onCancel,
}: {
  f: FormatContext;
  subscription: Subscription;
  busy: boolean;
  canCycleEnd: boolean;
  onConfirm: (mode: CancelMode, reason: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<CancelMode>('NOW');
  const [reason, setReason] = useState('');
  return (
    <ConfirmPanel
      testId="cancel-panel"
      title={f.t('detail.cancelTitle', { name: subscription.name })}
      description={f.t('detail.cancelDescription')}
      confirmLabel={mode === 'NOW' ? f.t('detail.cancelNow') : f.t('detail.cancelSchedule')}
      cancelLabel={f.t('detail.keep')}
      busy={busy}
      onConfirm={() => onConfirm(mode, reason)}
      onCancel={onCancel}
    >
      <div
        role="radiogroup"
        aria-label={f.t('detail.cancelWhen')}
        style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      >
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'start' }}>
          <input
            type="radio"
            name="cancelMode"
            value="NOW"
            checked={mode === 'NOW'}
            onChange={() => setMode('NOW')}
          />
          <span>
            {f.t('detail.cancelNow')}
            <small style={{ ...mutedStyle, display: 'block' }}>{f.t('detail.cancelNowHint')}</small>
          </span>
        </label>
        {canCycleEnd && subscription.nextRenewalOn ? (
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'start' }}>
            <input
              type="radio"
              name="cancelMode"
              value="CYCLE_END"
              checked={mode === 'CYCLE_END'}
              onChange={() => setMode('CYCLE_END')}
            />
            <span>
              {f.t('detail.cancelCycleEnd', { date: formatBusinessDate(subscription.nextRenewalOn) })}
              <small style={{ ...mutedStyle, display: 'block' }}>{f.t('detail.cancelCycleEndHint')}</small>
            </span>
          </label>
        ) : null}
      </div>
      <Field label={f.t('detail.cancelReasonLabel')}>
        {(p) => (
          <input
            {...p}
            name="reason"
            maxLength={500}
            autoComplete="off"
            style={inputStyle}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </ConfirmPanel>
  );
}

/** Resumen de la suscripción vigente. */
function Summary({
  subscription: s,
  f,
  ctx,
  mismatch,
  categoryName,
}: {
  subscription: Subscription;
  f: FormatContext;
  ctx: WorkspaceContext;
  mismatch: boolean;
  categoryName: (id: string) => string | undefined;
}) {
  const mat = s.definition?.materialization;
  const categoryId = s.definition?.categoryId ?? null;
  const rows: [string, ReactNode][] = [
    [f.t('summary.provider'), s.providerName ?? '—'],
    [f.t('summary.plan'), s.planName ?? '—'],
    [f.t('summary.price'), <MoneyText key="p" money={s.currentPrice} f={f} testId="current-price" />],
    [f.t('summary.cycle'), cycleSummary(s.billingCycle, f)],
    [
      f.t('summary.nextRenewal'),
      s.nextRenewalOn ? formatBusinessDate(s.nextRenewalOn) : f.t('list.noRenewal'),
    ],
    ...(s.trialEndsOn
      ? ([[f.t('summary.trialEnds'), formatBusinessDate(s.trialEndsOn)]] as [string, ReactNode][])
      : []),
    [f.t('summary.paymentAccount'), `${s.paymentAccountName ?? '—'} (${s.accountCurrency})`],
    [f.t('summary.category'), categoryId ? (categoryName(categoryId) ?? '—') : '—'],
    [
      f.t('summary.mode'),
      mat
        ? `${f.t(`modes.${mat.mode}`)}${
            mat.mode === 'AUTO_CREATE' && mat.autoCreateStatus
              ? ` (${f.t(mat.autoCreateStatus === 'POSTED' ? 'form.statusPosted' : 'form.statusPending')})`
              : ''
          }`
        : '—',
    ],
    [
      f.t('summary.reminder'),
      s.reminder.enabled
        ? f.t('summary.reminderOn', { days: s.reminder.daysBefore })
        : f.t('summary.reminderOff'),
    ],
    [f.t('summary.tolerance'), `${formatDecimal(s.priceTolerancePercent, ctx.formatLocale)} %`],
    [
      f.t('summary.cancellationUrl'),
      s.cancellationUrl && /^https?:\/\//i.test(s.cancellationUrl) ? (
        <a key="u" href={s.cancellationUrl} target="_blank" rel="noopener noreferrer">
          {s.cancellationUrl}
        </a>
      ) : (
        '—'
      ),
    ],
  ];
  return (
    <section aria-labelledby="summary-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h2 id="summary-title">{f.t('summary.title')}</h2>
      {mismatch ? (
        <p style={mutedStyle} data-testid="currency-mismatch">
          <span aria-hidden="true">ℹ</span>{' '}
          {f.t('form.currencyMismatch', { price: s.currentPrice.currency, account: s.accountCurrency })}
        </p>
      ) : null}
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
    </section>
  );
}
