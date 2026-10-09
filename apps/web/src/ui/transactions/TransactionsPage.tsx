'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { auditHref } from '../audit/logic';
import { Field, inputStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { useCustomFields } from '../custom-fields/CustomFieldInputs';
import { supportsRange } from '../custom-fields/logic';
import { BULK_EDIT_MAX_ITEMS } from './bulk-edit-logic';
import { BulkEditPanel, type BulkFocus, type BulkTarget } from './BulkEditPanel';
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

export function TransactionsPage({
  accountId,
  kind,
  withoutStatement,
}: {
  accountId?: string;
  kind?: string;
  withoutStatement?: boolean;
}) {
  const k = KINDS.find((x) => x === kind);
  return (
    <WithWorkspace>
      {(ctx) => (
        <Register
          ctx={ctx}
          {...(accountId ? { accountId } : {})}
          {...(k ? { kind: k } : {})}
          {...(withoutStatement ? { withoutStatement: true } : {})}
        />
      )}
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
  withoutStatement,
}: {
  ctx: WorkspaceContext;
  accountId?: string;
  kind?: TransactionKind;
  withoutStatement?: boolean;
}) {
  const f = useFormat('Transactions', ctx);
  const { t } = f;
  const catalogs = useCatalogs(ctx);
  const cf = useFormat('CustomFields', ctx);
  const customFields = useCustomFields(ctx);
  const filterable = customFields.active('TRANSACTION');
  const [filters, setFilters] = useState<TransactionFilters>({
    ...EMPTY_TRANSACTION_FILTERS,
    accountId: accountId ?? '',
    kind: kind ?? '',
    withoutStatement: withoutStatement ?? false,
  });
  const [draftQ, setDraftQ] = useState('');
  const [items, setItems] = useState<readonly Transaction[] | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [bulkAudit, setBulkAudit] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Panel de edición masiva (add-bulk-edit): sobre lo seleccionado o sobre todo lo filtrado (≤ 500).
  const [bulk, setBulk] = useState<{ target: BulkTarget; focus: BulkFocus } | undefined>();
  // Consulta (sin cursor) cuyos resultados se muestran; difiere de `query` mientras la recarga está en curso.
  const [shownQuery, setShownQuery] = useState<string | undefined>();
  // Solo la última petición escribe la lista: una respuesta tardía de filtros anteriores se descarta.
  const latest = useRef(0);
  const customDef = customFields.definitions.find(
    (d) => d.key === filters.customField.key && d.target === 'TRANSACTION' && !d.archivedAt,
  );
  const custom = { definition: customDef, locale: ctx.formatLocale };
  const query = transactionsQuery(filters, undefined, custom).toString();

  const load = useCallback(
    (append?: string | null) => {
      const seq = (latest.current += 1);
      const shown = transactionsQuery(filters, undefined, {
        definition: customDef,
        locale: ctx.formatLocale,
      }).toString();
      ctx.api
        .get<Page<Transaction>>(
          `${ctx.base}/transactions?${transactionsQuery(filters, append, { definition: customDef, locale: ctx.formatLocale }).toString()}`,
        )
        .then((r) => {
          if (seq !== latest.current) return;
          const data = r.data?.data ?? [];
          setItems((prev) => (append ? [...(prev ?? []), ...data] : data));
          setCursor(r.data?.page.hasMore ? r.data.page.nextCursor : null);
          setShownQuery(shown);
          setProblem(undefined);
        })
        .catch((err: unknown) => {
          if (seq === latest.current) setProblem(problemOf(err));
        });
    },
    [ctx.api, ctx.base, ctx.formatLocale, filters, customDef],
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

  const known = useMemo(() => new Map((items ?? []).map((x) => [x.id, x] as const)), [items]);
  const openBulk = (focus: BulkFocus, scope: 'selection' | 'filter' = 'selection') =>
    setBulk({
      focus,
      target: scope === 'filter' ? { kind: 'filter' } : { kind: 'items', ids: [...selected] },
    });

  const setFilter = (patch: Partial<TransactionFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <section
      aria-labelledby="transactions-title"
      style={pageStyle}
      data-testid="transactions-register"
      data-shown-query={shownQuery}
      aria-busy={shownQuery !== query}
    >
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
        <Field label={t('filters.withoutStatement')} hint={t('filters.withoutStatementHint')}>
          {(p) => (
            <select
              {...p}
              name="withoutStatement"
              style={inputStyle}
              value={filters.withoutStatement ? 'yes' : ''}
              onChange={(e) => setFilter({ withoutStatement: e.target.value === 'yes' })}
            >
              <option value="">{t('filters.any')}</option>
              <option value="yes">{t('filters.withoutStatementOnly')}</option>
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
        {filterable.length > 0 ? (
          <>
            <Field label={cf.t('filter.field')}>
              {(p) => (
                <select
                  {...p}
                  name="customFieldKey"
                  style={inputStyle}
                  value={filters.customField.key}
                  onChange={(e) =>
                    setFilter({ customField: { key: e.target.value, eq: '', from: '', to: '' } })
                  }
                >
                  <option value="">{t('filters.any')}</option>
                  {filterable.map((d) => (
                    <option key={d.id} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {customDef && supportsRange(customDef.dataType) ? (
              <>
                <Field label={cf.t('filter.from', { name: customDef.label })}>
                  {(p) => (
                    <input
                      {...p}
                      name="customFieldFrom"
                      type={customDef.dataType === 'DATE' ? 'date' : 'text'}
                      inputMode={customDef.dataType === 'DECIMAL' ? 'decimal' : 'numeric'}
                      style={inputStyle}
                      value={filters.customField.from}
                      onChange={(e) =>
                        setFilter({ customField: { ...filters.customField, from: e.target.value } })
                      }
                    />
                  )}
                </Field>
                <Field label={cf.t('filter.to', { name: customDef.label })}>
                  {(p) => (
                    <input
                      {...p}
                      name="customFieldTo"
                      type={customDef.dataType === 'DATE' ? 'date' : 'text'}
                      inputMode={customDef.dataType === 'DECIMAL' ? 'decimal' : 'numeric'}
                      style={inputStyle}
                      value={filters.customField.to}
                      onChange={(e) =>
                        setFilter({ customField: { ...filters.customField, to: e.target.value } })
                      }
                    />
                  )}
                </Field>
              </>
            ) : customDef ? (
              <Field label={cf.t('filter.value', { name: customDef.label })}>
                {(p) =>
                  customDef.dataType === 'SELECT' || customDef.dataType === 'BOOLEAN' ? (
                    <select
                      {...p}
                      name="customFieldValue"
                      style={inputStyle}
                      value={filters.customField.eq}
                      onChange={(e) =>
                        setFilter({ customField: { ...filters.customField, eq: e.target.value } })
                      }
                    >
                      <option value="">{t('filters.any')}</option>
                      {customDef.dataType === 'SELECT' ? (
                        customDef.options.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="true">{cf.t('yes')}</option>
                          <option value="false">{cf.t('no')}</option>
                        </>
                      )}
                    </select>
                  ) : (
                    <input
                      {...p}
                      name="customFieldValue"
                      style={inputStyle}
                      value={filters.customField.eq}
                      onChange={(e) =>
                        setFilter({ customField: { ...filters.customField, eq: e.target.value } })
                      }
                    />
                  )
                }
              </Field>
            ) : null}
          </>
        ) : null}
      </form>
      {ctx.canEdit ? (
        <div style={rowStyle} aria-label={t('list.bulk')} role="group" data-testid="bulk-bar">
          <span data-testid="bulk-selected">{t('bulk.selected', { n: selected.size })}</span>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => openBulk('category')}>
            {t('bulk.recategorize')}
          </button>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => openBulk('tags')}>
            {t('bulk.tag')}
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => openBulk('counterparty')}
          >
            {t('bulk.counterpartyAction')}
          </button>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => openBulk('state')}>
            {t('bulk.stateAction')}
          </button>
          <button
            type="button"
            disabled={busy || !items || items.length === 0}
            onClick={() => openBulk('category', 'filter')}
            data-testid="bulk-select-filtered"
          >
            {t('bulk.selectFiltered', { max: BULK_EDIT_MAX_ITEMS })}
          </button>
          {selected.size > 0 ? (
            <button type="button" onClick={() => setSelected(new Set())}>
              {t('bulk.clearSelection')}
            </button>
          ) : null}
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
      {bulk && ctx.canEdit ? (
        <BulkEditPanel
          key={`${bulk.target.kind}-${bulk.focus}`}
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          target={bulk.target}
          filters={filters}
          customFilter={custom}
          known={known}
          focus={bulk.focus}
          onClose={() => setBulk(undefined)}
          onTargetChange={(ids) => setSelected(new Set(ids))}
          onApplied={(result) => {
            setStatus(t('bulk.result', { n: result.count, id: result.bulkOperationId }));
            setBulkAudit(result.bulkOperationId || undefined);
            setSelected(new Set());
            load();
          }}
        />
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {bulkAudit ? (
        <p>
          <a href={ctx.href(auditHref({ correlationId: bulkAudit }))} data-testid="bulk-audit-link-list">
            {t('bulk.auditLink')}
          </a>
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items ? (
        <TransactionsListView
          transactions={items}
          names={catalogs.names}
          f={f}
          href={ctx.href}
          {...(filters.accountId ? { accountId: filters.accountId } : {})}
          selectable={ctx.canEdit}
          customFields={{ definitions: customFields.definitions, cf }}
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
