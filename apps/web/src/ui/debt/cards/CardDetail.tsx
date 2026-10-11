'use client';

import { useCallback, useEffect, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import { Tabs } from '../../common/Tabs';
import type { Account } from '../../common/types';
import {
  ConfirmPanel,
  Field,
  cardStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
} from '../../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../../common/workspace';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import { useCatalogs } from '../../transactions/catalogs';
import { FuturePanel, InstallmentsPanel, PlanPanel, StatementsPanel, FiguresTable } from './CardPanels';
import {
  buildCardPatch,
  cardPath,
  CARDS_TAB_HREF,
  termsFormOf,
  type CardAccountTerms,
  type TermsForm,
} from './logic';
import { StatementStatusBadge, UtilizationMeter } from './parts';
import { WEEKEND_ADJUSTMENTS, type CardAccount, type CreditCard } from './types';

export function CardDetailPage({ cardId, statementId }: { cardId: string; statementId?: string }) {
  return (
    <WithWorkspace>
      {(ctx) => <CardDetail ctx={ctx} cardId={cardId} {...(statementId ? { statementId } : {})} />}
    </WithWorkspace>
  );
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly card: CreditCard };

/** Resumen: utilización por límite y, por cuenta, el ciclo abierto con lo que se debe y el próximo vencimiento. */
export function CardOverview({ card, f }: { card: CreditCard; f: FormatContext }) {
  const currencyOf = (accountId: string | null) =>
    card.accounts.find((a) => a.accountId === accountId)?.currency ?? '';
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }} data-testid="card-overview">
      <section
        aria-labelledby="overview-utilization"
        style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      >
        <h2 id="overview-utilization" style={{ margin: 0 }}>
          {f.t('detail.utilizationTitle')}
        </h2>
        {card.utilization.map((u) => (
          <div key={u.accountId ?? 'shared'} data-testid="overview-utilization" data-scope={u.scope}>
            <p style={{ margin: 0 }}>
              {u.scope === 'SHARED'
                ? f.t('detail.sharedLimit', { limit: formatMoney(u.limit, f.locale) })
                : f.t('detail.accountLimit', {
                    currency: currencyOf(u.accountId),
                    limit: formatMoney(u.limit, f.locale),
                  })}
              {u.used && u.available
                ? ` · ${f.t('detail.usedAvailable', {
                    used: formatMoney(u.used, f.locale),
                    available: formatMoney(u.available, f.locale),
                  })}`
                : ''}
            </p>
            <UtilizationMeter
              utilization={u}
              thresholds={card.utilizationThresholds}
              f={f}
              label={
                u.scope === 'SHARED'
                  ? f.t('utilization.labelShared', { name: card.name })
                  : f.t('utilization.label', { name: card.name, currency: currencyOf(u.accountId) })
              }
            />
          </div>
        ))}
        {card.utilization.length === 0 ? <p style={mutedStyle}>{f.t('detail.noLimit')}</p> : null}
      </section>
      {card.accounts.map((a) => (
        <OpenCycle key={a.id} account={a} f={f} />
      ))}
    </div>
  );
}

function OpenCycle({ account, f }: { account: CardAccount; f: FormatContext }) {
  const cycle = account.openCycle;
  return (
    <section
      aria-labelledby={`cycle-${account.id}`}
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="open-cycle"
      data-currency={account.currency}
    >
      <h2 id={`cycle-${account.id}`} style={{ margin: 0 }}>
        {f.t('detail.openCycle', { currency: account.currency })}
      </h2>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {f.t('detail.openCycleDates', {
          start: formatBusinessDate(cycle.cycleStart),
          closing: formatBusinessDate(cycle.closingDate),
          due: formatBusinessDate(cycle.dueDate),
        })}
      </p>
      <dl
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1) var(--pf-space-4)', margin: 0 }}
      >
        <div>
          <dt style={mutedStyle}>{f.t('list.balance')}</dt>
          <dd style={{ margin: 0 }} data-testid="detail-balance">
            {formatMoney(account.balance, f.locale)}
          </dd>
        </div>
        <div>
          <dt style={mutedStyle}>{f.t('detail.pendingPurchases')}</dt>
          <dd style={{ margin: 0 }}>{formatMoney(account.pendingPurchases, f.locale)}</dd>
        </div>
        <div>
          <dt style={mutedStyle}>{f.t('list.used')}</dt>
          <dd style={{ margin: 0 }}>{formatMoney(account.creditUsed, f.locale)}</dd>
        </div>
        <div>
          <dt style={mutedStyle}>{f.t('list.nextDue')}</dt>
          <dd style={{ margin: 0 }} data-testid="detail-next-due">
            {formatBusinessDate(account.nextDueDate)}
          </dd>
        </div>
        {account.lastStatement ? (
          <div>
            <dt style={mutedStyle}>{f.t('detail.lastStatement')}</dt>
            <dd style={{ margin: 0 }}>
              <StatementStatusBadge status={account.lastStatement.status} f={f} />{' '}
              {f.t('detail.missing', {
                amount: formatMoney(account.lastStatement.remainingNoInterest, f.locale),
              })}
            </dd>
          </div>
        ) : null}
      </dl>
      <FiguresTable statement={cycle} f={f} />
    </section>
  );
}

/** Edición de los términos (nombre, calendario, tasa, umbrales, recordatorio, límites y regla de mínimo). */
export function TermsEditor({
  ctx,
  f,
  card,
  onDone,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TermsForm>(() => termsFormOf(card));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TermsForm>) => setForm((p) => ({ ...p, ...patch }));
  const setAcc = (id: string, patch: Partial<CardAccountTerms>) =>
    setForm((p) => ({ ...p, accounts: { ...p.accounts, [id]: { ...p.accounts[id]!, ...patch } } }));
  const err = (k: string) => errors[k];

  async function save() {
    setProblem(undefined);
    const built = buildCardPatch(card, form, { locale: ctx.formatLocale, scales: ctx.scales });
    if (!built.ok) {
      setErrors(Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, f.t(`errors.${v}`)])));
      return;
    }
    setErrors({});
    if (Object.keys(built.patch).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await ctx.api.command('PATCH', cardPath(ctx.base, card.id), built.patch, { ifMatch: card.version });
      onDone(f.t('terms.saved'));
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(false);
    }
  }

  return (
    <form
      style={formStyle}
      noValidate
      aria-labelledby="terms-title"
      data-testid="terms-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="terms-title" style={{ margin: 0 }}>
        {f.t('terms.title')}
      </h2>
      <div style={rowStyle}>
        <Field label={f.t('form.name')} error={err('name')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              maxLength={120}
              value={form.name}
              data-testid="terms-name"
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.statementDay')} error={err('statementDay')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="numeric"
              value={form.statementDay}
              data-testid="terms-statement-day"
              onChange={(e) => set({ statementDay: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.dueDay')} error={err('dueDay')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="numeric"
              value={form.dueDay}
              data-testid="terms-due-day"
              onChange={(e) => set({ dueDay: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.weekend')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.weekend}
              onChange={(e) => set({ weekend: e.target.value as TermsForm['weekend'] })}
            >
              {WEEKEND_ADJUSTMENTS.map((w) => (
                <option key={w} value={w}>
                  {f.t(`weekend.${w}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('terms.calendarNote')}</p>
      <div style={rowStyle}>
        <Field label={f.t('form.annualRate')} error={err('annualRate')} hint={f.t('form.annualRateHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.annualRate}
              onChange={(e) => set({ annualRate: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.thresholds')} error={err('thresholds')} hint={f.t('form.thresholdsHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              value={form.thresholds}
              onChange={(e) => set({ thresholds: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.reminderDays')} error={err('reminderDays')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="numeric"
              value={form.reminderDays}
              onChange={(e) => set({ reminderDays: e.target.value })}
            />
          )}
        </Field>
      </div>
      {card.limitMode === 'SHARED' && card.sharedLimit ? (
        <Field
          label={f.t('terms.sharedLimit', { currency: card.sharedLimit.currency })}
          error={err('sharedLimit')}
          style={{ maxWidth: '16rem' }}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.sharedLimit}
              onChange={(e) => set({ sharedLimit: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      {card.accounts.map((a) => {
        const t = form.accounts[a.accountId];
        if (!t) return null;
        const key2 = `account.${a.accountId}`;
        return (
          <fieldset
            key={a.id}
            style={{ ...formStyle, margin: 0 }}
            data-testid="terms-account"
            data-currency={a.currency}
          >
            <legend>{f.t('terms.account', { currency: a.currency })}</legend>
            <div style={rowStyle}>
              {card.limitMode === 'SEPARATE' ? (
                <Field
                  label={f.t('form.creditLimit', { currency: a.currency })}
                  error={err(`${key2}.creditLimit`)}
                >
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={t.creditLimit}
                      data-testid={`terms-limit-${a.currency}`}
                      onChange={(e) => setAcc(a.accountId, { creditLimit: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
              <Field label={f.t('terms.minimumType')}>
                {(p) => (
                  <select
                    {...p}
                    style={inputStyle}
                    value={t.minimumType}
                    onChange={(e) =>
                      setAcc(a.accountId, { minimumType: e.target.value as CardAccountTerms['minimumType'] })
                    }
                  >
                    <option value="PERCENT">{f.t('form.minimumTypes.PERCENT')}</option>
                    <option value="FIXED">{f.t('form.minimumTypes.FIXED')}</option>
                  </select>
                )}
              </Field>
              {t.minimumType === 'PERCENT' ? (
                <>
                  <Field label={f.t('form.minPercent')} error={err(`${key2}.percent`)}>
                    {(p) => (
                      <input
                        {...p}
                        style={inputStyle}
                        inputMode="decimal"
                        value={t.percent}
                        onChange={(e) => setAcc(a.accountId, { percent: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={f.t('form.minFloor', { currency: a.currency })} error={err(`${key2}.floor`)}>
                    {(p) => (
                      <input
                        {...p}
                        style={inputStyle}
                        inputMode="decimal"
                        value={t.floor}
                        onChange={(e) => setAcc(a.accountId, { floor: e.target.value })}
                      />
                    )}
                  </Field>
                </>
              ) : (
                <Field label={f.t('form.minFixed', { currency: a.currency })} error={err(`${key2}.fixed`)}>
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={t.fixed}
                      onChange={(e) => setAcc(a.accountId, { fixed: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          </fieldset>
        );
      })}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="terms-save">
          {f.t('terms.save')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}

function CardDetail({
  ctx,
  cardId,
  statementId,
}: {
  ctx: WorkspaceContext;
  cardId: string;
  statementId?: string;
}) {
  const f = useFormat('Cards', ctx);
  const catalogs = useCatalogs(ctx);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await ctx.api.get<CreditCard>(cardPath(ctx.base, cardId));
      setLoaded({ status: 'ready', card: r.data! });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    }
  }, [ctx.api, ctx.base, cardId]);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const changed = useCallback((message: string) => {
    setStatus(message);
    setEditing(false);
    setReloadKey((n) => n + 1);
  }, []);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p>{f.t('loading')}</p>
      </section>
    );
  if (loaded.status === 'notFound')
    return (
      <section style={pageStyle} data-testid="card-not-found">
        <h1>{f.t('notFound')}</h1>
        <p>
          <a href={ctx.href(CARDS_TAB_HREF)}>{f.t('back')}</a>
        </p>
      </section>
    );
  if (loaded.status === 'error')
    return (
      <section style={pageStyle}>
        <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        <p>
          <a href={ctx.href(CARDS_TAB_HREF)}>{f.t('back')}</a>
        </p>
      </section>
    );

  const card = loaded.card;
  const accounts: readonly Account[] = catalogs.accounts;
  const editable = ctx.canEdit && card.status === 'ACTIVE';

  async function archive() {
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${cardPath(ctx.base, card.id)}/archive`, undefined, {
        ifMatch: card.version,
      });
      setArchiving(false);
      setBusy(false);
      changed(f.t('archive.done'));
    } catch (err) {
      setProblem(problemOf(err));
      setBusy(false);
      setArchiving(false);
    }
  }

  return (
    <section
      aria-labelledby="card-title"
      style={pageStyle}
      data-testid="card-detail"
      data-status={card.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href(CARDS_TAB_HREF)} data-testid="card-back">
          {f.t('back')}
        </a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="card-title" style={{ margin: 0 }}>
          {card.name}
        </h1>
        {card.status === 'ARCHIVED' ? (
          <span data-testid="card-archived">{f.t('status.ARCHIVED')}</span>
        ) : null}
      </div>
      <p style={mutedStyle}>
        {f.t('list.calendar', { statementDay: card.statementDay, dueDay: card.dueDay })}
        {card.annualRate ? ` · ${f.t('detail.rate', { rate: card.annualRate })}` : ''}
      </p>
      {status ? (
        <p role="status" data-testid="card-status-message">
          {status}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!ctx.canEdit ? <p style={mutedStyle}>{f.t('viewerNotice')}</p> : null}
      {card.status === 'ARCHIVED' ? <p style={mutedStyle}>{f.t('archive.archivedNotice')}</p> : null}
      {editable ? (
        <div style={rowStyle} role="group" aria-label={f.t('detail.actions')}>
          <button type="button" onClick={() => setEditing(true)} disabled={editing} data-testid="card-edit">
            {f.t('terms.edit')}
          </button>
          <button type="button" onClick={() => setArchiving(true)} data-testid="card-archive">
            {f.t('archive.action')}
          </button>
        </div>
      ) : null}
      {archiving ? (
        <ConfirmPanel
          testId="archive-panel"
          title={f.t('archive.title', { name: card.name })}
          description={f.t('archive.description')}
          confirmLabel={f.t('archive.action')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void archive()}
          onCancel={() => setArchiving(false)}
        />
      ) : null}
      {editing ? (
        <TermsEditor ctx={ctx} f={f} card={card} onDone={changed} onCancel={() => setEditing(false)} />
      ) : null}
      <Tabs
        label={f.t('detail.tabsLabel')}
        idPrefix="card"
        initial={statementId ? 'estados' : 'resumen'}
        tabs={[
          { id: 'resumen', label: f.t('detail.tabs.overview'), content: <CardOverview card={card} f={f} /> },
          {
            id: 'estados',
            label: f.t('detail.tabs.statements'),
            content: (
              <StatementsPanel
                ctx={ctx}
                card={card}
                reloadKey={reloadKey}
                highlightId={statementId}
                onChanged={changed}
              />
            ),
          },
          {
            id: 'plan',
            label: f.t('detail.tabs.plan'),
            content: <PlanPanel ctx={ctx} card={card} accounts={accounts} onChanged={changed} />,
          },
          {
            id: 'cuotas',
            label: f.t('detail.tabs.installments'),
            content: <InstallmentsPanel ctx={ctx} card={card} onChanged={changed} />,
          },
          {
            id: 'futuros',
            label: f.t('detail.tabs.future'),
            content: <FuturePanel ctx={ctx} card={card} reloadKey={reloadKey} />,
          },
        ]}
      />
    </section>
  );
}
