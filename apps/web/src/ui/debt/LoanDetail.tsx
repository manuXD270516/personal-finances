'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemMessage } from '../../errors/error-messages';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import { cardStyle, mutedStyle, pageStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatDecimal } from '../AuditHistory';
import { formatMoney, isNegative } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { formatBusinessDate } from '../planning/logic';
import { useCatalogs } from '../transactions/catalogs';
import { DisbursePanel, EditPanel, PaymentPanel, ReasonPanel } from './LoanPanels';
import { InstallmentsTable, LoanStatusBadge, PaymentsTable, SchedulePreviewTable, debtText } from './Tables';
import { fractionToPercent, debtHref, emptyPaymentForm, loanPath } from './logic';
import type { LoanDetail, LoanInstallment, LoanPayment } from './types';

export interface PaymentPrefill {
  readonly open: boolean;
  readonly installmentNo?: number | undefined;
  readonly date?: string | undefined;
}

export function LoanDetailPage({ loanId, prefill }: { loanId: string; prefill: PaymentPrefill }) {
  return <WithWorkspace>{(ctx) => <Detail ctx={ctx} loanId={loanId} prefill={prefill} />}</WithWorkspace>;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | {
      readonly status: 'ready';
      readonly loan: LoanDetail;
      readonly installments: readonly LoanInstallment[];
      readonly payments: readonly LoanPayment[];
    };

type Panel = 'pay' | 'disburse' | 'cancel' | 'void' | 'edit';

/** Resumen de condiciones, saldos y acumulados (presentacional). */
export function LoanSummary({
  loan,
  f,
  href,
  accountName,
}: {
  loan: LoanDetail;
  f: FormatContext;
  href: (path: string) => string;
  accountName: (id: string) => string | undefined;
}) {
  const { locale } = f;
  const currency = loan.principal.currency;
  const rows: [string, ReactNode][] = [
    [f.t('summary.lender'), loan.lenderName ?? '—'],
    [
      f.t('summary.account'),
      <a key="a" href={href(`/cuentas/${loan.accountId}`)}>
        {accountName(loan.accountId) ?? '…'}
      </a>,
    ],
    [f.t('summary.paymentAccount'), accountName(loan.paymentAccountId) ?? '—'],
    [
      loan.origin === 'EXISTING' ? f.t('summary.outstandingAtStart') : f.t('summary.principal'),
      formatMoney(loan.principal, locale),
    ],
    [f.t('summary.rate'), `${formatDecimal(fractionToPercent(loan.annualRate), locale)} %`],
    [f.t('summary.dayCount'), f.t(`dayCount.${loan.dayCount}`)],
    [f.t('summary.frequency'), f.t(`frequency.${loan.frequency}`)],
    [f.t('summary.term'), String(loan.termInstallments)],
    [
      f.t('summary.installment'),
      loan.installmentAmount
        ? formatMoney(loan.installmentAmount, locale)
        : loan.preview
          ? formatMoney({ amount: loan.preview.installmentAmount, currency }, locale)
          : '—',
    ],
    [f.t('summary.disbursement'), loan.disbursementDate ? formatBusinessDate(loan.disbursementDate) : '—'],
    [f.t('summary.firstDue'), formatBusinessDate(loan.firstDueDate)],
  ];
  for (const k of ['fees', 'insurance', 'taxes'] as const) {
    const c = loan.charges[k];
    if (c)
      rows.push([
        f.t(`components.${k}`),
        c.mode === 'FIXED'
          ? f.t('summary.chargeFixed', { amount: formatMoney({ amount: c.value, currency }, locale) })
          : f.t('summary.chargeRate', { rate: formatDecimal(fractionToPercent(c.value, 4), locale) }),
      ]);
  }
  if (!loan.retainedFee.amount.match(/^0*(\.0*)?$/))
    rows.push([f.t('summary.retainedFee'), formatMoney(loan.retainedFee, locale)]);
  if (loan.cancelledReason) rows.push([f.t('summary.cancelledReason'), loan.cancelledReason]);
  return (
    <dl
      style={{
        ...cardStyle,
        display: 'grid',
        gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
        gap: 'var(--pf-space-1) var(--pf-space-4)',
        margin: 0,
      }}
      data-testid="loan-summary"
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt style={mutedStyle}>{label}</dt>
          <dd style={{ margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Principal pendiente (según el cronograma) frente al saldo de la cuenta y la diferencia no registrada. */
export function LoanBalances({ loan, f }: { loan: LoanDetail; f: FormatContext }) {
  const { locale } = f;
  const diff = loan.unreconciledDifference;
  const different = diff !== null && !/^[-+]?0*(\.0*)?$/.test(diff.amount);
  return (
    <section aria-labelledby="loan-balances-title" style={cardStyle} data-testid="loan-balances">
      <h2 id="loan-balances-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('balances.title')}
      </h2>
      <dl
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-2) var(--pf-space-6)', margin: 0 }}
      >
        <div>
          <dt style={mutedStyle}>{f.t('balances.outstanding')}</dt>
          <dd style={{ margin: 0, fontSize: '1.25rem' }} data-testid="loan-outstanding-principal">
            {loan.outstandingPrincipal ? debtText(f, loan.outstandingPrincipal) : '—'}
          </dd>
        </div>
        <div>
          <dt style={mutedStyle}>{f.t('balances.account')}</dt>
          <dd style={{ margin: 0, fontSize: '1.25rem' }} data-testid="loan-account-balance">
            {debtText(
              f,
              isNegative(loan.accountBalance.amount)
                ? { ...loan.accountBalance, amount: loan.accountBalance.amount.slice(1) }
                : loan.accountBalance,
            )}
          </dd>
        </div>
        <div>
          <dt style={mutedStyle}>{f.t('balances.difference')}</dt>
          <dd style={{ margin: 0, fontSize: '1.25rem' }} data-testid="loan-unreconciled">
            {diff ? formatMoney(diff, locale) : '—'}
          </dd>
        </div>
      </dl>
      {different ? (
        <p
          role="note"
          style={{ ...warningStyle, margin: 'var(--pf-space-2) 0 0' }}
          data-testid="loan-unreconciled-note"
        >
          <span aria-hidden="true">⚠</span> {f.t('balances.differenceNote')}
        </p>
      ) : null}
      <h3 style={{ fontSize: '0.9375rem', marginBottom: 'var(--pf-space-1)' }}>
        {f.t('balances.paidTotals')}
      </h3>
      <dl
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1) var(--pf-space-4)', margin: 0 }}
        data-testid="loan-paid-totals"
      >
        {(['principal', 'interest', 'fees', 'insurance', 'taxes'] as const).map((k) => (
          <div key={k}>
            <dt style={mutedStyle}>{f.t(`components.${k}`)}</dt>
            <dd style={{ margin: 0 }} data-component={k}>
              {formatMoney(loan.paidTotals[k], locale)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Próxima cuota y cuotas atrasadas. */
export function NextInstallments({ loan, f }: { loan: LoanDetail; f: FormatContext }) {
  if (!loan.nextInstallment && loan.overdueInstallments.length === 0) return null;
  const n = loan.nextInstallment;
  return (
    <section aria-labelledby="loan-next-title" style={cardStyle} data-testid="loan-next-installment">
      <h2 id="loan-next-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('next.title')}
      </h2>
      {n ? (
        <p style={{ margin: 0 }}>
          {f.t('next.value', {
            n: n.n,
            date: formatBusinessDate(n.dueDate),
            amount: formatMoney(n.outstanding, f.locale),
          })}
        </p>
      ) : null}
      {loan.overdueInstallments.length > 0 ? (
        <>
          <h3 style={{ fontSize: '0.9375rem', color: 'var(--pf-error)' }}>
            <span aria-hidden="true">⚠</span>{' '}
            {f.t('next.overdue', { count: loan.overdueInstallments.length })}
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="loan-overdue-list">
            {loan.overdueInstallments.map((o) => (
              <li key={o.n}>
                {f.t('next.overdueItem', {
                  n: o.n,
                  date: formatBusinessDate(o.dueDate),
                  amount: formatMoney(o.outstanding, f.locale),
                  days: o.overdueDays,
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Detail({
  ctx,
  loanId,
  prefill,
}: {
  ctx: WorkspaceContext;
  loanId: string;
  prefill: PaymentPrefill;
}) {
  const f = useFormat('Debt', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [panel, setPanel] = useState<Panel | undefined>(prefill.open ? 'pay' : undefined);
  const [voidTarget, setVoidTarget] = useState<LoanPayment | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const d = (await ctx.api.get<LoanDetail>(loanPath(ctx.base, loanId))).data!;
      const live = d.status === 'ACTIVE' || d.status === 'PAID_OFF';
      const [inst, pay] = await Promise.all([
        live
          ? ctx.api
              .get<{ data: LoanInstallment[] }>(`${loanPath(ctx.base, loanId)}/installments`)
              .then((r) => r.data?.data ?? [])
              .catch(() => [] as LoanInstallment[])
          : Promise.resolve([] as LoanInstallment[]),
        ctx.api
          .get<{ data: LoanPayment[] }>(`${loanPath(ctx.base, loanId)}/payments`)
          .then((r) => r.data?.data ?? [])
          .catch(() => [] as LoanPayment[]),
      ]);
      setLoaded({ status: 'ready', loan: d, installments: inst, payments: pay });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    }
  }, [ctx.api, ctx.base, loanId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p data-testid="loan-loading">{f.t('loading')}</p>
      </section>
    );
  if (loaded.status !== 'ready')
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        {loaded.status === 'notFound' ? (
          <p role="alert" data-error-code="RESOURCE_NOT_FOUND" data-testid="loan-not-found">
            {f.t('notFound')}
          </p>
        ) : (
          <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        )}
        <p>
          <a href={ctx.href('/debts')}>{f.t('back')}</a>
        </p>
      </section>
    );

  const { loan, installments, payments } = loaded;
  const accountName = (id: string) => catalogs.names.account(id);
  const done = (message: string) => {
    setPanel(undefined);
    setVoidTarget(undefined);
    setStatus(message);
    void load();
  };
  const close = () => {
    setPanel(undefined);
    setVoidTarget(undefined);
  };
  const active = loan.status === 'ACTIVE';
  const panelProps = { ctx, f, loan, onCancel: close, onDone: done };
  // Prefill del pago: cuota indicada (o la próxima) y su pendiente.
  const prefNo = prefill.installmentNo ?? loan.nextInstallment?.n;
  const prefInstallment = installments.find((i) => i.n === prefNo);
  const prefAmount = prefInstallment?.pendingTotal ?? loan.nextInstallment?.outstanding.amount;

  return (
    <section
      aria-labelledby="loan-title"
      style={pageStyle}
      data-testid="loan-detail"
      data-status={loan.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/debts')}>{f.t('back')}</a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="loan-title" style={{ margin: 0 }}>
          {loan.name}
        </h1>
        <LoanStatusBadge status={loan.status} f={f} />
      </div>
      {status ? (
        <p role="status" data-testid="loan-status-message">
          {status}
        </p>
      ) : null}
      {ctx.canEdit ? (
        <div style={rowStyle} role="group" aria-label={f.t('actions.label')}>
          {active ? (
            <button
              type="button"
              data-testid="loan-pay"
              onClick={() => setPanel('pay')}
              disabled={panel === 'pay'}
            >
              {f.t('actions.pay')}
            </button>
          ) : null}
          {loan.status === 'DRAFT' ? (
            <button type="button" data-testid="loan-disburse" onClick={() => setPanel('disburse')}>
              {f.t('actions.disburse')}
            </button>
          ) : null}
          {loan.status === 'DRAFT' || loan.status === 'ACTIVE' ? (
            <>
              <button type="button" data-testid="loan-edit" onClick={() => setPanel('edit')}>
                {f.t('actions.edit')}
              </button>
              <button type="button" data-testid="loan-cancel" onClick={() => setPanel('cancel')}>
                {f.t('actions.cancel')}
              </button>
            </>
          ) : null}
          {loan.status !== 'CANCELLED' ? (
            <a href={ctx.href(debtHref(loan.id, '/comparar'))} data-testid="loan-compare">
              {f.t('actions.compare')}
            </a>
          ) : null}
        </div>
      ) : null}
      {panel === 'pay' && active ? (
        <PaymentPanel
          {...panelProps}
          accounts={catalogs.accounts}
          initial={emptyPaymentForm({
            businessDate: prefill.date ?? today,
            accountId: loan.paymentAccountId,
            ...(prefNo !== undefined ? { installmentNo: prefNo } : {}),
            ...(prefAmount !== undefined ? { amount: prefAmount } : {}),
          })}
        />
      ) : null}
      {panel === 'disburse' ? <DisbursePanel {...panelProps} /> : null}
      {panel === 'cancel' ? <ReasonPanel {...panelProps} kind="cancel" /> : null}
      {panel === 'void' && voidTarget ? (
        <ReasonPanel {...panelProps} kind="void" paymentId={voidTarget.id} />
      ) : null}
      {panel === 'edit' ? (
        <EditPanel {...panelProps} accounts={catalogs.accounts} counterparties={catalogs.counterparties} />
      ) : null}
      <Tabs
        idPrefix="loan"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }}>
                {loan.status === 'ACTIVE' || loan.status === 'PAID_OFF' ? (
                  <LoanBalances loan={loan} f={f} />
                ) : null}
                <NextInstallments loan={loan} f={f} />
                <LoanSummary loan={loan} f={f} href={ctx.href} accountName={accountName} />
                {active ? (
                  <p style={{ ...mutedStyle, margin: 0 }} data-testid="loan-terms-note">
                    {problemMessage({ code: 'LOAN_TERMS_LOCKED' }, ctx.uiLocale)}
                  </p>
                ) : null}
                {loan.status === 'DRAFT' && loan.preview ? (
                  <section aria-labelledby="loan-schedule-title">
                    <h2 id="loan-schedule-title" style={{ fontSize: '1.125rem' }}>
                      {f.t('schedule.draftTitle')}
                    </h2>
                    <SchedulePreviewTable f={f} preview={loan.preview} />
                  </section>
                ) : null}
                {installments.length > 0 ? (
                  <section aria-labelledby="loan-schedule-title">
                    <h2 id="loan-schedule-title" style={{ fontSize: '1.125rem' }}>
                      {f.t('schedule.title')}
                    </h2>
                    <InstallmentsTable
                      f={f}
                      items={installments}
                      currency={loan.principal.currency}
                      loanId={loan.id}
                      canPay={ctx.canEdit && active}
                    />
                  </section>
                ) : null}
                {loan.status !== 'DRAFT' ? (
                  <section aria-labelledby="loan-payments-title">
                    <h2 id="loan-payments-title" style={{ fontSize: '1.125rem' }}>
                      {f.t('payments.title')}
                    </h2>
                    <PaymentsTable
                      f={f}
                      items={payments}
                      accountName={accountName}
                      canVoid={ctx.canEdit}
                      busy={panel === 'void'}
                      onVoid={(p) => {
                        setVoidTarget(p);
                        setPanel('void');
                      }}
                    />
                  </section>
                ) : null}
              </div>
            ),
          },
          {
            id: 'lifecycle',
            label: lf.t('tabs.lifecycle'),
            content: (
              <LifecycleTab
                ctx={ctx}
                path={`loans/${loan.id}`}
                refreshKey={loan.version}
                stateLabel={(code) => (f.has(`status.${code}`) ? f.t(`status.${code}`) : code)}
                accountName={accountName}
                idPrefix="loan-lifecycle"
              />
            ),
          },
        ]}
      />
    </section>
  );
}
