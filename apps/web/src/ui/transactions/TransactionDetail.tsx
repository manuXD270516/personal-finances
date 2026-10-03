'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { AuditLogEntry, ConversionDetail, ConversionRevision, Page, Transaction } from '../common/types';
import {
  cardStyle,
  cellStyle,
  ConfirmPanel,
  Field,
  inputStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { ConversionDetailView } from '../fx/ConversionDetailView';
import { useCatalogs } from './catalogs';
import { availableActions } from './logic';
import { TransactionForm, type RecordKind } from './TransactionForm';
import { describe, SignedAmount, StatusBadge } from './TransactionsListView';
import { TransactionTimeline } from './TransactionTimeline';

export function TransactionDetailPage({ transactionId, notice }: { transactionId: string; notice?: string }) {
  return (
    <WithWorkspace>
      {(ctx) => <Detail ctx={ctx} transactionId={transactionId} {...(notice ? { notice } : {})} />}
    </WithWorkspace>
  );
}

export function NewTransactionPage({
  accountId,
  kind,
  duplicateOf,
}: {
  accountId?: string;
  kind?: string;
  duplicateOf?: string;
}) {
  return (
    <WithWorkspace>
      {(ctx) => (
        <NewTransaction
          ctx={ctx}
          {...(accountId ? { accountId } : {})}
          {...(kind ? { kind } : {})}
          {...(duplicateOf ? { duplicateOf } : {})}
        />
      )}
    </WithWorkspace>
  );
}

const RECORD = ['EXPENSE', 'INCOME', 'REFUND', 'ADJUSTMENT'];

function NewTransaction({
  ctx,
  accountId,
  kind,
  duplicateOf,
}: {
  ctx: WorkspaceContext;
  accountId?: string;
  kind?: string;
  duplicateOf?: string;
}) {
  const { t } = useFormat('Transactions', ctx);
  const catalogs = useCatalogs(ctx);
  const [source, setSource] = useState<Transaction | null | undefined>(duplicateOf ? undefined : null);
  useEffect(() => {
    if (!duplicateOf) return;
    ctx.api
      .get<Transaction>(`${ctx.base}/transactions/${duplicateOf}`)
      .then((r) => setSource(r.data ?? null))
      .catch(() => setSource(null));
  }, [ctx.api, ctx.base, duplicateOf]);
  if (!catalogs.loaded || source === undefined) return <p aria-busy="true">{t('list.loading')}</p>;
  return (
    <section style={pageStyle}>
      <p>
        <a href={ctx.href('/transacciones')}>{t('backToList')}</a>
      </p>
      {source ? <p style={mutedStyle}>{t('form.duplicating')}</p> : null}
      <TransactionForm
        ctx={ctx}
        catalogs={catalogs}
        {...(source ? { duplicateOf: source } : {})}
        {...(accountId ? { presetAccountId: accountId } : {})}
        {...(kind && RECORD.includes(kind) ? { presetKind: kind as RecordKind } : {})}
        onSaved={(tx) => {
          const warn = tx.warnings?.some((w) => w.code === 'POSSIBLE_DUPLICATE');
          window.location.assign(
            ctx.href(`/transacciones/${tx.id}?aviso=${warn ? 'duplicado' : 'registrada'}`),
          );
        }}
      />
    </section>
  );
}

type Pending = 'void' | 'unreconcile' | null;

/**
 * Detalle de transacción (6.2): datos, patas por cuenta, splits con categoría y tags, detalle de conversión,
 * acciones de estado (confirmar, reconciliar, contabilizar pendiente, des-reconciliar con motivo, anular con
 * motivo), edición, "Duplicar" y el historial como línea de tiempo del ciclo de vida (visible también para VIEWER).
 */
function Detail({
  ctx,
  transactionId,
  notice,
}: {
  ctx: WorkspaceContext;
  transactionId: string;
  notice?: string;
}) {
  const f = useFormat('Transactions', ctx);
  const fx = useFormat('Fx', ctx);
  const { t, locale } = f;
  const catalogs = useCatalogs(ctx);
  const [tx, setTx] = useState<Transaction | undefined>();
  const [history, setHistory] = useState<readonly AuditLogEntry[] | undefined>();
  const [revisions, setRevisions] = useState<readonly ConversionRevision[]>([]);
  const [conversion, setConversion] = useState<ConversionDetail | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [historyProblem, setHistoryProblem] = useState<ApiProblemBody | undefined>();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(
    notice === 'registrada' ? t('detail.recorded') : undefined,
  );

  const load = useCallback(() => {
    ctx.api
      .get<Transaction>(`${ctx.base}/transactions/${transactionId}`)
      .then((r) => {
        setTx(r.data);
        setProblem(undefined);
      })
      .catch((err: unknown) => setProblem(problemOf(err)));
    ctx.api
      .get<Page<AuditLogEntry>>(`${ctx.base}/transactions/${transactionId}/history?limit=200`)
      .then((r) => {
        setHistory(r.data?.data ?? []);
        setHistoryProblem(undefined);
      })
      .catch((err: unknown) => setHistoryProblem(problemOf(err)));
  }, [ctx.api, ctx.base, transactionId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (tx?.kind !== 'CONVERSION') return;
    ctx.api
      .get<{ data: ConversionRevision[] }>(`${ctx.base}/conversions/${tx.id}/revisions`)
      .then((r) => setRevisions(r.data?.data ?? []))
      .catch(() => setRevisions([]));
    // `getConversion` incluye el costo total (fees + spread) que el detalle inline de la transacción omite.
    ctx.api
      .get<Transaction>(`${ctx.base}/conversions/${tx.id}`)
      .then((r) => setConversion(r.data?.conversion ?? undefined))
      .catch(() => setConversion(undefined));
  }, [ctx.api, ctx.base, tx?.kind, tx?.id, tx?.version]);

  if (!tx)
    return problem ? (
      <ProblemMessage problem={problem} locale={ctx.uiLocale} />
    ) : (
      <p aria-busy="true">{t('list.loading')}</p>
    );
  const actions = availableActions(tx);

  async function act(run: () => Promise<{ data: Transaction | undefined }>, done: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await run();
      if (r.data) setTx(r.data);
      setStatus(done);
      setPending(null);
      setReason('');
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }
  const current = tx;
  const patchStatus = (next: 'POSTED' | 'CLEARED' | 'RECONCILED', done: string) =>
    act(
      () =>
        ctx.api.command<Transaction>(
          'PATCH',
          `${ctx.base}/transactions/${current.id}`,
          { status: next },
          { ifMatch: current.version },
        ),
      done,
    );

  const title = describe(tx, catalogs.names, f);
  const accountName = (id: string) => catalogs.names.account(id) ?? '…';

  return (
    <section
      aria-labelledby="tx-title"
      style={pageStyle}
      data-testid="transaction-detail"
      data-status={tx.status}
      data-kind={tx.kind}
    >
      <p>
        <a href={ctx.href('/transacciones')}>{t('backToList')}</a>
      </p>
      <h1 id="tx-title" style={{ marginBottom: 0 }}>
        {title}
      </h1>
      <p style={{ fontSize: '1.5rem', margin: 0 }}>
        <strong>
          <SignedAmount tx={tx} f={f} />
        </strong>{' '}
        <StatusBadge status={tx.status} f={f} />
      </p>
      {notice === 'duplicado' ? (
        <p role="status" style={warningStyle} data-testid="duplicate-notice">
          {t('detail.duplicateNotice')}
        </p>
      ) : null}
      <dl
        style={{
          ...cardStyle,
          display: 'grid',
          gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
          gap: '0.25rem 1rem',
          margin: 0,
        }}
      >
        <dt>{t('detail.kind')}</dt>
        <dd style={{ margin: 0 }}>{t(`kinds.${tx.kind}`)}</dd>
        <dt>{t('detail.date')}</dt>
        <dd style={{ margin: 0 }}>{formatLocalDate(tx.transactionDate, locale)}</dd>
        {tx.postingDate ? (
          <>
            <dt>{t('detail.postingDate')}</dt>
            <dd style={{ margin: 0 }}>{formatLocalDate(tx.postingDate, locale)}</dd>
          </>
        ) : null}
        <dt>{t('detail.paymentMethod')}</dt>
        <dd style={{ margin: 0 }} data-testid="detail-payment-method">
          {tx.paymentMethod ? t(`paymentMethods.${tx.paymentMethod}`) : t('detail.none')}
        </dd>
        <dt>{t('detail.counterparty')}</dt>
        <dd style={{ margin: 0 }} data-testid="detail-counterparty">
          {tx.counterpartyId ? (catalogs.names.counterparty(tx.counterpartyId) ?? '…') : t('detail.none')}
        </dd>
        {tx.adjustmentReason ? (
          <>
            <dt>{t('detail.adjustment')}</dt>
            <dd style={{ margin: 0 }}>
              {tx.adjustmentDirection ? t(`direction.${tx.adjustmentDirection}`) : ''} · {tx.adjustmentReason}
            </dd>
          </>
        ) : null}
        {tx.refundOfTransactionId ? (
          <>
            <dt>{t('detail.refundOf')}</dt>
            <dd style={{ margin: 0 }}>
              <a href={ctx.href(`/transacciones/${tx.refundOfTransactionId}`)}>{t('detail.viewOriginal')}</a>
            </dd>
          </>
        ) : null}
        {tx.notes ? (
          <>
            <dt>{t('detail.notes')}</dt>
            <dd style={{ margin: 0 }}>{tx.notes}</dd>
          </>
        ) : null}
        <dt>{t('detail.revision')}</dt>
        <dd style={{ margin: 0 }} data-testid="detail-revision">
          {tx.revision}
        </dd>
        {tx.voidReason ? (
          <>
            <dt>{t('detail.voidReason')}</dt>
            <dd style={{ margin: 0 }}>{tx.voidReason}</dd>
          </>
        ) : null}
      </dl>
      <section aria-labelledby="tx-legs-title" style={cardStyle}>
        <h2 id="tx-legs-title" style={{ fontSize: '1rem', marginTop: 0 }}>
          {t('detail.legs')}
        </h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {tx.legs.map((l, i) => (
            <li key={`${l.accountId}-${l.role}-${i}`} data-testid="tx-leg" data-role={l.role}>
              <a href={ctx.href(`/cuentas/${l.accountId}`)}>{accountName(l.accountId)}</a>:{' '}
              {formatMoney(l.amount, locale)} ({t(`legRoles.${l.role}`)})
            </li>
          ))}
        </ul>
      </section>
      {tx.splits.length > 0 ? (
        <section aria-labelledby="tx-splits-title" style={cardStyle}>
          <h2 id="tx-splits-title" style={{ fontSize: '1rem', marginTop: 0 }}>
            {t('splits.title')}
          </h2>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {t('detail.category')}
                  </th>
                  <th scope="col" style={cellStyle}>
                    {t('detail.tags')}
                  </th>
                  <th scope="col" style={numCellStyle}>
                    {t('detail.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tx.splits.map((s) => (
                  <tr key={s.id} data-testid="tx-split">
                    <td style={cellStyle}>{catalogs.names.category(s.categoryId) ?? '…'}</td>
                    <td style={cellStyle}>
                      {(s.tagIds ?? []).map((id) => catalogs.names.tag(id) ?? '…').join(', ')}
                    </td>
                    <td style={numCellStyle} data-testid="tx-split-amount">
                      {formatMoney(s.amount, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {tx.conversion ? (
        <ConversionDetailView
          detail={conversion ?? tx.conversion}
          revisions={revisions}
          legs={tx.legs}
          f={fx}
          accountName={accountName}
        />
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {ctx.canEdit ? (
        <div style={rowStyle} role="group" aria-label={t('detail.actions')}>
          {actions.edit && RECORD.includes(tx.kind) ? (
            <button type="button" onClick={() => setEditing(true)} disabled={editing || busy}>
              {t('detail.edit')}
            </button>
          ) : null}
          {actions.post ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    ctx.api.command<Transaction>(
                      'POST',
                      `${ctx.base}/transactions/${current.id}/post`,
                      undefined,
                      { ifMatch: current.version },
                    ),
                  t('detail.done.post'),
                )
              }
            >
              {t('detail.post')}
            </button>
          ) : null}
          {actions.clear ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus('CLEARED', t('detail.done.clear'))}
            >
              {t('detail.clear')}
            </button>
          ) : null}
          {actions.unclear ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus('POSTED', t('detail.done.unclear'))}
            >
              {t('detail.unclear')}
            </button>
          ) : null}
          {actions.reconcile ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus('RECONCILED', t('detail.done.reconcile'))}
            >
              {t('detail.reconcile')}
            </button>
          ) : null}
          {actions.unreconcile ? (
            <button type="button" disabled={busy} onClick={() => setPending('unreconcile')}>
              {t('detail.unreconcile')}
            </button>
          ) : null}
          {actions.void ? (
            <button type="button" disabled={busy} onClick={() => setPending('void')}>
              {t('detail.void')}
            </button>
          ) : null}
          {actions.duplicate ? (
            <a href={ctx.href(`/transacciones/nueva?duplicar=${tx.id}`)}>{t('detail.duplicate')}</a>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <ConfirmPanel
          title={t(`detail.confirm.${pending}.title`)}
          description={t(`detail.confirm.${pending}.description`)}
          confirmLabel={t(`detail.confirm.${pending}.confirm`)}
          cancelLabel={t('form.cancel')}
          busy={busy}
          confirmDisabled={!reason.trim()}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            void act(
              () =>
                pending === 'void'
                  ? ctx.api.command<Transaction>(
                      'POST',
                      `${ctx.base}/transactions/${current.id}/void`,
                      { reason: reason.trim() },
                      { ifMatch: current.version },
                    )
                  : ctx.api.command<Transaction>(
                      'POST',
                      `${ctx.base}/transactions/${current.id}/unreconcile`,
                      { reason: reason.trim() },
                      { ifMatch: current.version, idempotent: false },
                    ),
              t(`detail.done.${pending}`),
            )
          }
        >
          <Field label={t('detail.confirm.reason')}>
            {(p) => (
              <input
                {...p}
                name="reason"
                required
                maxLength={500}
                style={inputStyle}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </ConfirmPanel>
      ) : null}
      {editing && catalogs.loaded ? (
        <TransactionForm
          ctx={ctx}
          catalogs={catalogs}
          original={tx}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setTx(next);
            setEditing(false);
            setStatus(
              next.revision !== tx.revision
                ? t('detail.done.amended', { revision: next.revision })
                : t('detail.done.edited'),
            );
            load();
          }}
        />
      ) : null}
      {historyProblem ? (
        <ProblemMessage problem={historyProblem} locale={ctx.uiLocale} />
      ) : history ? (
        <TransactionTimeline entries={history} ctx={f} names={catalogs.names} currentUserId={ctx.me.id} />
      ) : null}
    </section>
  );
}
