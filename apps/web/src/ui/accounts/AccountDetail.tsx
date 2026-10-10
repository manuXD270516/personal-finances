'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { AuditHistory } from '../AuditHistory';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import { todayIn } from '../common/dates';
import type { Account, Institution } from '../common/types';
import { ConfirmPanel, Field, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { Tabs } from '../common/Tabs';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { useCustomFields } from '../custom-fields/CustomFieldInputs';
import { CustomFieldValuesView } from '../custom-fields/CustomFieldValuesView';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import type { ReconciliationStatus } from '../reconciliation/logic';
import { ReconciliationIndicator } from '../reconciliation/ReconciliationView';
import { AccountForm } from './AccountForm';
import { AccountStatusBadge, BalanceText, BaseEquivalent } from './AccountsListView';
import { maskedIdentifier } from './logic';

export function NewAccountPage() {
  return <WithWorkspace>{(ctx) => <NewAccount ctx={ctx} />}</WithWorkspace>;
}

function useInstitutions(ctx: WorkspaceContext): readonly Institution[] {
  const [list, setList] = useState<readonly Institution[]>([]);
  useEffect(() => {
    listAll<Institution>(ctx.api, `${ctx.base}/institutions`)
      .then(setList)
      .catch(() => setList([]));
  }, [ctx.api, ctx.base]);
  return list;
}

function NewAccount({ ctx }: { ctx: WorkspaceContext }) {
  const institutions = useInstitutions(ctx);
  const { t } = useFormat('Accounts', ctx);
  return (
    <section style={pageStyle}>
      <p>
        <a href={ctx.href('/cuentas')}>{t('backToList')}</a>
      </p>
      <AccountForm
        ctx={ctx}
        institutions={institutions}
        onSaved={(a) => window.location.assign(ctx.href(`/cuentas/${a.id}?creada=1`))}
      />
    </section>
  );
}

export function AccountDetailPage({ accountId, created }: { accountId: string; created?: boolean }) {
  return (
    <WithWorkspace>
      {(ctx) => <AccountDetail ctx={ctx} accountId={accountId} created={Boolean(created)} />}
    </WithWorkspace>
  );
}

type Pending = 'archive' | 'close' | 'reactivate' | null;

/**
 * Detalle de cuenta: saldo (pasivos como "Adeuda"), equivalente en moneda base, acciones archivar/cerrar/reactivar
 * con confirmación, edición (tipo inmutable); pestañas "Detalle" | "Recorrido" (add-lifecycle-timeline; VIEWER+) |
 * "Historial de cambios" (add-audit-trail; OWNER/EDITOR).
 */
function AccountDetail({
  ctx,
  accountId,
  created,
}: {
  ctx: WorkspaceContext;
  accountId: string;
  created: boolean;
}) {
  const f = useFormat('Accounts', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const cf = useFormat('CustomFields', ctx);
  const rf = useFormat('Reconciliation', ctx);
  const customFields = useCustomFields(ctx);
  const { t, locale } = f;
  const institutions = useInstitutions(ctx);
  const [account, setAccount] = useState<Account | undefined>();
  const [reconciliation, setReconciliation] = useState<ReconciliationStatus | undefined>();
  const today = todayIn(ctx.timeZone);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [closedOn, setClosedOn] = useState(todayIn(ctx.timeZone));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(created ? t('created') : undefined);

  const load = useCallback(() => {
    ctx.api
      .get<Account>(`${ctx.base}/accounts/${accountId}`)
      .then((r) => {
        setAccount(r.data);
        setProblem(undefined);
      })
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base, accountId]);

  useEffect(load, [load]);

  // Estado de reconciliación al corte de hoy (zona del workspace); visible para todo miembro (VIEWER incluido).
  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<ReconciliationStatus>(`${ctx.base}/accounts/${accountId}/reconciliation-status?asOf=${today}`)
      .then((r) => {
        if (!cancelled) setReconciliation(r.data);
      })
      .catch(() => {
        if (!cancelled) setReconciliation(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, accountId, today, account?.version]);

  if (!account) return problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null;

  async function run(action: Exclude<Pending, null>) {
    if (!account) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const body =
        action === 'close'
          ? { closedOn, ...(reason.trim() ? { reason: reason.trim() } : {}) }
          : action === 'archive'
            ? {}
            : undefined;
      const r = await ctx.api.command<Account>('POST', `${ctx.base}/accounts/${account.id}/${action}`, body, {
        ifMatch: account.version,
        idempotent: false,
      });
      setAccount(r.data);
      setStatus(t(`done.${action}`));
      setPending(null);
      setReason('');
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const institution = institutions.find((i) => i.id === account.institutionId);
  const mask = maskedIdentifier(account.accountNumberLast4);

  return (
    <section
      aria-labelledby="account-title"
      style={pageStyle}
      data-testid="account-detail"
      data-status={account.status}
    >
      <p>
        <a href={ctx.href('/cuentas')}>{t('backToList')}</a>
      </p>
      <h1 id="account-title" style={{ marginBottom: 0 }}>
        {account.name} <AccountStatusBadge account={account} ctx={f} />
      </h1>
      <p style={mutedStyle}>
        {t(`types.${account.type}`)} · {account.currency} · {t(`liquidity.${account.liquidity}`)}
        {institution ? ` · ${institution.name}` : ''}
        {mask ? (
          <>
            {' · '}
            <span data-testid="account-mask">{mask}</span>
          </>
        ) : null}
      </p>
      <p>
        <strong data-testid="account-balance" style={{ fontSize: '1.5rem' }}>
          <BalanceText account={account} ctx={f} />
        </strong>{' '}
        <BaseEquivalent account={account} baseCurrency={ctx.ws.baseCurrency} ctx={f} />
      </p>
      <Tabs
        idPrefix="account"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <>
                {account.pendingAmount && !/^-?0*(\.0*)?$/.test(account.pendingAmount.amount) ? (
                  <p style={mutedStyle}>
                    {t('pending', { amount: formatMoney(account.pendingAmount, locale) })}
                  </p>
                ) : null}
                <p style={mutedStyle}>
                  {account.includeInNetWorth ? t('includedInNetWorth') : t('excludedFromNetWorth')}
                  {account.openedOn
                    ? ` · ${t('openedOn', { date: formatLocalDate(account.openedOn, locale) })}`
                    : ''}
                  {account.closedOn
                    ? ` · ${t('closedOn', { date: formatLocalDate(account.closedOn, locale) })}`
                    : ''}
                </p>
                <CustomFieldValuesView
                  definitions={customFields.definitions}
                  values={account.customFields}
                  f={cf}
                  testId="account-custom-field-values"
                />
                {reconciliation ? (
                  <ReconciliationIndicator
                    status={reconciliation}
                    f={rf}
                    through={today}
                    withoutStatementHref={ctx.href(`/transacciones?cuenta=${account.id}&sinExtracto=1`)}
                  />
                ) : null}
                <nav aria-label={t('actions')} style={rowStyle}>
                  <a href={ctx.href(`/cuentas/${account.id}/reconciliar`)} data-testid="reconcile-account">
                    {ctx.canEdit && account.status === 'ACTIVE' ? t('reconcile') : t('reconciliations')}
                  </a>
                  <a href={ctx.href(`/transacciones?cuenta=${account.id}`)}>{t('viewTransactions')}</a>
                  {ctx.canEdit && account.status === 'ACTIVE' ? (
                    <a href={ctx.href(`/transacciones/nueva?cuenta=${account.id}`)}>{t('recordMovement')}</a>
                  ) : null}
                  {ctx.canEdit && account.status === 'ACTIVE' ? (
                    <a href={ctx.href(`/imports/nueva?cuenta=${account.id}`)} data-testid="import-csv">
                      {t('importCsv')}
                    </a>
                  ) : null}
                </nav>
                {status ? <p role="status">{status}</p> : null}
                {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
                {ctx.canEdit ? (
                  <div style={rowStyle}>
                    <button type="button" onClick={() => setEditing(true)} disabled={editing}>
                      {t('edit')}
                    </button>
                    {account.status === 'ACTIVE' ? (
                      <>
                        <button type="button" onClick={() => setPending('archive')}>
                          {t('archive')}
                        </button>
                        <button type="button" onClick={() => setPending('close')}>
                          {t('close')}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setPending('reactivate')}>
                        {t('reactivate')}
                      </button>
                    )}
                  </div>
                ) : null}
                {pending ? (
                  <ConfirmPanel
                    title={t(`confirm.${pending}.title`, { name: account.name })}
                    description={t(`confirm.${pending}.description`)}
                    confirmLabel={t(`confirm.${pending}.confirm`)}
                    cancelLabel={t('form.cancel')}
                    busy={busy}
                    onConfirm={() => void run(pending)}
                    onCancel={() => setPending(null)}
                  >
                    {pending === 'close' ? (
                      <div style={rowStyle}>
                        <Field label={t('confirm.close.date')}>
                          {(p) => (
                            <input
                              {...p}
                              type="date"
                              name="closedOn"
                              style={inputStyle}
                              value={closedOn}
                              onChange={(e) => setClosedOn(e.target.value)}
                            />
                          )}
                        </Field>
                        <Field label={t('confirm.reason')}>
                          {(p) => (
                            <input
                              {...p}
                              name="reason"
                              maxLength={500}
                              style={inputStyle}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          )}
                        </Field>
                      </div>
                    ) : null}
                  </ConfirmPanel>
                ) : null}
                {editing ? (
                  <AccountForm
                    ctx={ctx}
                    account={account}
                    institutions={institutions}
                    onCancel={() => setEditing(false)}
                    onSaved={(a) => {
                      setAccount(a);
                      setEditing(false);
                      setStatus(t('saved'));
                    }}
                  />
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
                path={`accounts/${account.id}`}
                refreshKey={account.version}
                stateLabel={(code) => (f.has(`status.${code}`) ? t(`status.${code}`) : code)}
                idPrefix="account-lifecycle"
              />
            ),
          },
          // El log de auditoría solo lo leen OWNER/EDITOR (D28): VIEWER no tiene esta pestaña.
          ...(ctx.canEdit
            ? [
                {
                  id: 'history',
                  label: lf.t('tabs.history'),
                  content: (
                    <AuditHistory
                      workspaceId={ctx.ws.id}
                      aggregateType="Account"
                      aggregateId={account.id}
                      role={ctx.ws.role}
                      locale={ctx.formatLocale}
                      timeZone={ctx.timeZone}
                      refreshKey={account.version}
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
