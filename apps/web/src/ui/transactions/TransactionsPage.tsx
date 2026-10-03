'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  type Page,
  type PaymentMethod,
  type Transaction,
  type TransactionKind,
  type TransactionStatus,
} from '../common/types';
import { Field, inputStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { categoryOptions, useCatalogs } from './catalogs';
import { EMPTY_TRANSACTION_FILTERS, transactionsQuery, type TransactionFilters } from './logic';
import { TransactionsListView } from './TransactionsListView';

const KINDS: readonly TransactionKind[] = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'CONVERSION',
  'REFUND',
  'ADJUSTMENT',
  'OPENING_BALANCE',
];

export function TransactionsPage({ accountId, kind }: { accountId?: string; kind?: string }) {
  const k = KINDS.find((x) => x === kind);
  return (
    <WithWorkspace>
      {(ctx) => <Register ctx={ctx} {...(accountId ? { accountId } : {})} {...(k ? { kind: k } : {})} />}
    </WithWorkspace>
  );
}

/**
 * Registro de transacciones (6.2): filtros (texto, cuenta, tipo, estado, medio de pago, categoría, fechas), carga
 * paginada y marcado `cleared` individual o en lote (todo o nada, cada ítem con su `version`).
 */
function Register({
  ctx,
  accountId,
  kind,
}: {
  ctx: WorkspaceContext;
  accountId?: string;
  kind?: TransactionKind;
}) {
  const f = useFormat('Transactions', ctx);
  const { t } = f;
  const catalogs = useCatalogs(ctx);
  const [filters, setFilters] = useState<TransactionFilters>({
    ...EMPTY_TRANSACTION_FILTERS,
    accountId: accountId ?? '',
    kind: kind ?? '',
  });
  const [draftQ, setDraftQ] = useState('');
  const [items, setItems] = useState<readonly Transaction[] | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (append?: string | null) => {
      ctx.api
        .get<Page<Transaction>>(`${ctx.base}/transactions?${transactionsQuery(filters, append).toString()}`)
        .then((r) => {
          const data = r.data?.data ?? [];
          setItems((prev) => (append ? [...(prev ?? []), ...data] : data));
          setCursor(r.data?.page.hasMore ? r.data.page.nextCursor : null);
          setProblem(undefined);
        })
        .catch((err: unknown) => setProblem(problemOf(err)));
    },
    [ctx.api, ctx.base, filters],
  );

  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  const cats = useMemo(
    () => [
      ...categoryOptions(catalogs.categories, catalogs.groups, 'EXPENSE'),
      ...categoryOptions(catalogs.categories, catalogs.groups, 'INCOME'),
    ],
    [catalogs.categories, catalogs.groups],
  );

  async function markCleared(cleared: boolean) {
    if (!items || selected.size === 0) return;
    const chosen = items.filter((x) => selected.has(x.id));
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/transactions/mark-cleared`, {
        items: chosen.map((x) => ({ id: x.id, version: x.version })),
        cleared,
      });
      setStatus(t(cleared ? 'list.markedCleared' : 'list.markedUncleared', { n: chosen.length }));
      setSelected(new Set());
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const setFilter = (patch: Partial<TransactionFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <section aria-labelledby="transactions-title" style={pageStyle}>
      <h1 id="transactions-title">{t('list.title')}</h1>
      {ctx.canEdit ? (
        <nav aria-label={t('list.newActions')} style={rowStyle}>
          <a
            href={ctx.href(`/transacciones/nueva${filters.accountId ? `?cuenta=${filters.accountId}` : ''}`)}
            data-testid="new-transaction"
          >
            {t('list.new')}
          </a>
          <a href={ctx.href('/transferencias/nueva')}>{t('list.newTransfer')}</a>
          <a href={ctx.href('/transferencias/nueva?pagoTarjeta=1')}>{t('list.payCard')}</a>
          <a href={ctx.href('/fx/conversiones/nueva')}>{t('list.newConversion')}</a>
        </nav>
      ) : null}
      <form
        role="search"
        aria-label={t('filters.title')}
        style={rowStyle}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ q: draftQ });
        }}
      >
        <Field label={t('filters.q')}>
          {(p) => (
            <input
              {...p}
              type="search"
              name="q"
              style={inputStyle}
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
          )}
        </Field>
        <button type="submit">{t('filters.search')}</button>
        <Field label={t('filters.account')}>
          {(p) => (
            <select
              {...p}
              name="accountId"
              style={inputStyle}
              value={filters.accountId}
              onChange={(e) => setFilter({ accountId: e.target.value })}
            >
              <option value="">{t('filters.any')}</option>
              {catalogs.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.kind')}>
          {(p) => (
            <select
              {...p}
              name="kind"
              style={inputStyle}
              value={filters.kind}
              onChange={(e) => setFilter({ kind: e.target.value as TransactionKind | '' })}
            >
              <option value="">{t('filters.any')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
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
              onChange={(e) => setFilter({ status: e.target.value as TransactionStatus | '' })}
            >
              <option value="">{t('filters.any')}</option>
              {TRANSACTION_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(`status.${st}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.paymentMethod')}>
          {(p) => (
            <select
              {...p}
              name="paymentMethod"
              style={inputStyle}
              value={filters.paymentMethod}
              onChange={(e) => setFilter({ paymentMethod: e.target.value as PaymentMethod | '' })}
            >
              <option value="">{t('filters.any')}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`paymentMethods.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.category')}>
          {(p) => (
            <select
              {...p}
              name="categoryId"
              style={inputStyle}
              value={filters.categoryId}
              onChange={(e) => setFilter({ categoryId: e.target.value })}
            >
              <option value="">{t('filters.any')}</option>
              {cats.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('filters.dateFrom')}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="dateFrom"
              style={inputStyle}
              value={filters.dateFrom}
              onChange={(e) => setFilter({ dateFrom: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('filters.dateTo')}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="dateTo"
              style={inputStyle}
              value={filters.dateTo}
              onChange={(e) => setFilter({ dateTo: e.target.value })}
            />
          )}
        </Field>
      </form>
      {ctx.canEdit ? (
        <div style={rowStyle} aria-label={t('list.bulk')} role="group">
          <button type="button" disabled={busy || selected.size === 0} onClick={() => void markCleared(true)}>
            {t('list.markCleared', { n: selected.size })}
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => void markCleared(false)}
          >
            {t('list.markUncleared', { n: selected.size })}
          </button>
        </div>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items ? (
        <TransactionsListView
          transactions={items}
          names={catalogs.names}
          f={f}
          href={ctx.href}
          {...(filters.accountId ? { accountId: filters.accountId } : {})}
          selectable={ctx.canEdit}
          selected={selected}
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      ) : (
        <p aria-busy="true">{t('list.loading')}</p>
      )}
      {cursor ? (
        <button type="button" onClick={() => load(cursor)}>
          {t('list.more')}
        </button>
      ) : null}
    </section>
  );
}
