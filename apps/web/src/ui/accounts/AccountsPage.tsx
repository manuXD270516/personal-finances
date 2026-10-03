'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import {
  ACCOUNT_TYPES,
  type Account,
  type AccountPage,
  type AccountStatus,
  type AccountType,
  type Institution,
} from '../common/types';
import { Field, inputStyle, pageStyle, rowStyle } from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { AccountsListView } from './AccountsListView';
import { useValuations } from './valuations';
import { accountsQuery, EMPTY_ACCOUNT_FILTERS, type AccountFilters, type AccountGroupBy } from './logic';

export function AccountsPage() {
  return <WithWorkspace>{(ctx) => <AccountsScreen ctx={ctx} />}</WithWorkspace>;
}

function AccountsScreen({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Accounts', ctx);
  const { t } = f;
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_ACCOUNT_FILTERS);
  const [groupBy, setGroupBy] = useState<AccountGroupBy>('type');
  const [accounts, setAccounts] = useState<readonly Account[] | undefined>();
  const [institutions, setInstitutions] = useState<readonly Institution[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const { api, base } = ctx;

  useEffect(() => {
    listAll<Institution>(api, `${base}/institutions`, new URLSearchParams({ includeArchived: 'true' }))
      .then(setInstitutions)
      .catch(() => setInstitutions([]));
  }, [api, base]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AccountPage>(`${base}/accounts?${accountsQuery(filters).toString()}`)
      .then((r) => {
        if (cancelled) return;
        setAccounts(r.data?.data ?? []);
        setProblem(undefined);
      })
      .catch((err: unknown) => !cancelled && setProblem(problemOf(err)));
    return () => {
      cancelled = true;
    };
  }, [api, base, filters]);

  const valuations = useValuations(ctx, accounts);
  const institutionMap = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);
  const enabledCurrencies = ctx.currencies.filter((c) => c.enabled).map((c) => c.code);

  return (
    <section aria-labelledby="accounts-title" style={pageStyle}>
      <h1 id="accounts-title">{t('title')}</h1>
      <nav aria-label={t('actions')} style={rowStyle}>
        {ctx.canEdit ? (
          <a href={ctx.href('/cuentas/nueva')} data-testid="new-account">
            {t('new')}
          </a>
        ) : null}
        <a href={ctx.href('/instituciones')}>{t('institutionsLink')}</a>
      </nav>
      <form
        aria-label={t('filters.title')}
        role="search"
        style={rowStyle}
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label={t('filters.type')}>
          {(p) => (
            <select
              {...p}
              name="type"
              style={inputStyle}
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value as AccountType | '' })}
            >
              <option value="">{t('filters.any')}</option>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.currency')}>
          {(p) => (
            <select
              {...p}
              name="currency"
              style={inputStyle}
              value={filters.currency}
              onChange={(e) => setFilters({ ...filters, currency: e.target.value })}
            >
              <option value="">{t('filters.any')}</option>
              {enabledCurrencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.status')}>
          {(p) => (
            <select
              {...p}
              name="status"
              style={inputStyle}
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as AccountStatus | '' })}
            >
              <option value="">{t('filters.defaultStatus')}</option>
              {(['ACTIVE', 'CLOSED', 'ARCHIVED'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.institution')}>
          {(p) => (
            <select
              {...p}
              name="institutionId"
              style={inputStyle}
              value={filters.institutionId}
              onChange={(e) => setFilters({ ...filters, institutionId: e.target.value })}
            >
              <option value="">{t('filters.any')}</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.groupBy')}>
          {(p) => (
            <select
              {...p}
              name="groupBy"
              style={inputStyle}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as AccountGroupBy)}
            >
              <option value="type">{t('filters.groupByType')}</option>
              <option value="institution">{t('filters.groupByInstitution')}</option>
              <option value="none">{t('filters.groupByNone')}</option>
            </select>
          )}
        </Field>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="includeArchived"
            checked={filters.includeArchived}
            onChange={(e) => setFilters({ ...filters, includeArchived: e.target.checked })}
          />
          {t('filters.showArchived')}
        </label>
      </form>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {accounts ? (
        <AccountsListView
          accounts={accounts}
          institutions={institutionMap}
          groupBy={groupBy}
          baseCurrency={ctx.ws.baseCurrency}
          ctx={f}
          href={ctx.href}
          valuations={valuations}
        />
      ) : (
        <p aria-busy="true">{t('loading')}</p>
      )}
    </section>
  );
}
