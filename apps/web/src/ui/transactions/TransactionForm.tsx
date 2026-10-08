'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import { todayIn } from '../common/dates';
import { parseAmount, scaleFor } from '../common/money';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type Transaction,
  type TransactionStatus,
} from '../common/types';
import { errorStyle, Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { useCustomFields } from '../custom-fields/CustomFieldInputs';
import { buildFieldsPayload, type CustomFieldError } from '../custom-fields/logic';
import { categoryOptions, type Catalogs } from './catalogs';
import { CounterpartyPicker } from './CounterpartyPicker';
import { newSplitRow, summarizeSplits, type SplitRow } from './splits';
import { SplitsEditor } from './SplitsEditor';

export type RecordKind = 'EXPENSE' | 'INCOME' | 'REFUND' | 'ADJUSTMENT';
export const RECORD_KINDS: readonly RecordKind[] = ['EXPENSE', 'INCOME', 'REFUND', 'ADJUSTMENT'];

interface State {
  kind: RecordKind;
  accountId: string;
  amount: string;
  transactionDate: string;
  postingDate: string;
  description: string;
  notes: string;
  paymentMethod: PaymentMethod | '';
  counterpartyId: string;
  status: Exclude<TransactionStatus, 'RECONCILED' | 'VOIDED'>;
  refundOfTransactionId: string;
  confirmRefundExceedsOriginal: boolean;
  direction: 'INCREASE' | 'DECREASE';
  reason: string;
  splits: SplitRow[];
}

const fromTransaction = (tx: Transaction, today: string, duplicate: boolean): State => ({
  kind: (RECORD_KINDS as readonly string[]).includes(tx.kind) ? (tx.kind as RecordKind) : 'EXPENSE',
  accountId: tx.legs.find((l) => l.role === 'MAIN')?.accountId ?? tx.legs[0]?.accountId ?? '',
  amount: tx.amount.amount,
  transactionDate: duplicate ? today : tx.transactionDate,
  postingDate: duplicate ? '' : (tx.postingDate ?? ''),
  description: tx.description ?? '',
  notes: duplicate ? '' : (tx.notes ?? ''),
  paymentMethod: tx.paymentMethod ?? '',
  counterpartyId: tx.counterpartyId ?? '',
  status: duplicate
    ? 'POSTED'
    : tx.status === 'PENDING'
      ? 'PENDING'
      : tx.status === 'CLEARED'
        ? 'CLEARED'
        : 'POSTED',
  refundOfTransactionId: tx.refundOfTransactionId ?? '',
  confirmRefundExceedsOriginal: false,
  direction: tx.adjustmentDirection ?? 'DECREASE',
  reason: tx.adjustmentReason ?? '',
  splits: tx.splits.length
    ? tx.splits.map((s) =>
        // Un único split sigue al total (editar el monto no obliga a reescribirlo).
        newSplitRow({
          categoryId: s.categoryId,
          amount: tx.splits.length === 1 ? '' : s.amount.amount,
          tagIds: s.tagIds ?? [],
        }),
      )
    : [newSplitRow()],
});

/**
 * Formulario de transacción (add-transaction-recording 6.1): ingreso, gasto, reembolso y ajuste con montos
 * tolerantes al locale, splits con reparto exacto, contraparte con creación en línea, medio de pago (incluido QR),
 * aviso NO bloqueante de posibles duplicados e `Idempotency-Key` por intento. En edición (`PATCH` con `If-Match`),
 * cambiar monto, cuenta, fecha o montos de splits genera reversa y nuevo asiento; lo descriptivo no toca el ledger.
 */
export function TransactionForm({
  ctx,
  catalogs,
  original,
  duplicateOf,
  presetAccountId,
  presetKind,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  catalogs: Catalogs;
  original?: Transaction;
  duplicateOf?: Transaction;
  presetAccountId?: string;
  presetKind?: RecordKind;
  onSaved: (tx: Transaction) => void;
  onCancel?: () => void;
}) {
  const f = useFormat('Transactions', ctx);
  const cf = useFormat('CustomFields', ctx);
  const customFields = useCustomFields(ctx);
  const txFields = customFields.active('TRANSACTION');
  const [fieldErrors, setFieldErrors] = useState<Record<number, Record<string, CustomFieldError>>>({});
  const { t, locale } = f;
  const editing = Boolean(original);
  const today = todayIn(ctx.timeZone);
  const [s, setS] = useState<State>(() => {
    const src = original ?? duplicateOf;
    if (src) return fromTransaction(src, today, Boolean(duplicateOf));
    return {
      kind: presetKind ?? 'EXPENSE',
      accountId: presetAccountId ?? '',
      amount: '',
      transactionDate: today,
      postingDate: '',
      description: '',
      notes: '',
      paymentMethod: '',
      counterpartyId: '',
      status: 'POSTED',
      refundOfTransactionId: '',
      confirmRefundExceedsOriginal: false,
      direction: 'DECREASE',
      reason: '',
      splits: [newSplitRow()],
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<
    readonly {
      transactionId: string;
      transactionDate: string;
      amount: { amount: string; currency: string };
      description: string | null;
    }[]
  >([]);
  const [refundCandidates, setRefundCandidates] = useState<readonly Transaction[]>([]);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const accounts = catalogs.activeAccounts.length || !original ? catalogs.activeAccounts : catalogs.accounts;
  const account = catalogs.accounts.find((a) => a.id === s.accountId);
  const currency = account?.currency ?? ctx.ws.baseCurrency;
  const scale = scaleFor(currency, ctx.scales);
  const money = { locale, currency, scale };
  const parsedAmount = parseAmount(s.amount, money);
  const total = parsedAmount.ok ? parsedAmount.value : null;
  const categoryKind = s.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const cats = useMemo(
    () => categoryOptions(catalogs.categories, catalogs.groups, categoryKind),
    [catalogs.categories, catalogs.groups, categoryKind],
  );
  const usesSplits = s.kind !== 'ADJUSTMENT';

  // Aviso de posibles duplicados (no bloqueante): misma cuenta, mismo monto, fecha ±3 días.
  useEffect(() => {
    if (editing || !ctx.canEdit || !s.accountId || !total || !s.transactionDate) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      ctx.api
        .command<{ candidates: typeof duplicates }>(
          'POST',
          `${ctx.base}/transactions/duplicate-check`,
          {
            accountId: s.accountId,
            amount: { amount: total, currency },
            transactionDate: s.transactionDate,
            ...(s.description.trim() ? { description: s.description.trim() } : {}),
          },
          { idempotent: false },
        )
        .then((r) => !cancelled && setDuplicates(r.data?.candidates ?? []))
        .catch(() => !cancelled && setDuplicates([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    ctx.api,
    ctx.base,
    ctx.canEdit,
    editing,
    s.accountId,
    total,
    currency,
    s.transactionDate,
    s.description,
  ]);

  // Gastos de la cuenta que se pueden reembolsar.
  useEffect(() => {
    if (s.kind !== 'REFUND' || !s.accountId) return;
    const q = new URLSearchParams({ kind: 'EXPENSE', accountId: s.accountId, limit: '50' });
    ctx.api
      .get<{ data: Transaction[] }>(`${ctx.base}/transactions?${q.toString()}`)
      .then((r) => setRefundCandidates((r.data?.data ?? []).filter((x) => x.status !== 'VOIDED')))
      .catch(() => setRefundCandidates([]));
  }, [ctx.api, ctx.base, s.kind, s.accountId]);

  function uncategorizedId(): string | undefined {
    const code = s.kind === 'INCOME' ? 'UNCATEGORIZED_INCOME' : 'UNCATEGORIZED';
    return catalogs.categories.find((c) => c.systemCode === code)?.id;
  }

  function buildSplits(): {
    splits?: unknown[];
    error?: string;
    fieldErrors?: Record<number, Record<string, CustomFieldError>>;
  } {
    if (!usesSplits || !total) return {};
    const rows = s.splits;
    // Custom fields por split (add-custom-fields): al crear se exigen los obligatorios; al editar viajan solo los
    // cambios respecto del split de la misma posición (la API los combina con lo guardado).
    const payloads = rows.map((r, i) =>
      buildFieldsPayload(txFields, r.customFields, locale, {
        original: original?.splits[i]?.customFields,
        requireMandatory: !editing,
      }),
    );
    const failed = payloads.flatMap((p, i) =>
      Object.keys(p.errors).length > 0 ? [[i, p.errors] as const] : [],
    );
    if (failed.length > 0) return { fieldErrors: Object.fromEntries(failed) };
    const only = rows.length === 1 ? rows[0]! : undefined;
    if (
      only &&
      !only.categoryId &&
      only.tagIds.length === 0 &&
      only.amount.trim() === '' &&
      !payloads[0]?.values
    )
      return {};
    const summary = summarizeSplits(rows, total, money);
    if (!summary.balanced) return { error: t('errors.splitsNotBalanced') };
    const fallback = uncategorizedId();
    const splits = rows.map((r, i) => ({
      amount: { amount: summary.amounts[i]!, currency },
      categoryId: r.categoryId || fallback,
      ...(r.tagIds.length ? { tagIds: [...r.tagIds] } : {}),
      ...(payloads[i]?.values ? { customFields: payloads[i]!.values } : {}),
    }));
    if (splits.some((x) => !x.categoryId)) return { error: t('errors.categoryRequired') };
    return { splits };
  }

  function validate(): { ok: boolean; splits?: unknown[] } {
    const next: Record<string, string> = {};
    if (!s.accountId) next['accountId'] = t('errors.accountRequired');
    if (!parsedAmount.ok) next['amount'] = t(`errors.amount.${parsedAmount.error}`, { scale, currency });
    if (!s.transactionDate) next['transactionDate'] = t('errors.dateRequired');
    if (s.kind === 'ADJUSTMENT' && !s.reason.trim()) next['reason'] = t('errors.reasonRequired');
    const sp = buildSplits();
    if (sp.error) next['splits'] = sp.error;
    setFieldErrors(sp.fieldErrors ?? {});
    if (sp.fieldErrors) next['splits'] = t('errors.customFields');
    setErrors(next);
    return { ok: Object.keys(next).length === 0, ...(sp.splits ? { splits: sp.splits } : {}) };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const v = validate();
    if (!v.ok || !total) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      if (!original) {
        const body = {
          kind: s.kind,
          accountId: s.accountId,
          amount: { amount: total, currency },
          transactionDate: s.transactionDate,
          status: s.status,
          ...(s.postingDate ? { postingDate: s.postingDate } : {}),
          ...(s.description.trim() ? { description: s.description.trim() } : {}),
          ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
          ...(s.paymentMethod ? { paymentMethod: s.paymentMethod } : {}),
          ...(s.counterpartyId ? { counterpartyId: s.counterpartyId } : {}),
          ...(s.kind === 'REFUND' && s.refundOfTransactionId
            ? { refundOfTransactionId: s.refundOfTransactionId }
            : {}),
          ...(s.kind === 'REFUND' && s.confirmRefundExceedsOriginal
            ? { confirmRefundExceedsOriginal: true }
            : {}),
          ...(s.kind === 'ADJUSTMENT' ? { direction: s.direction, reason: s.reason.trim() } : {}),
          ...(v.splits ? { splits: v.splits } : {}),
        };
        const r = await ctx.api.command<Transaction>('POST', `${ctx.base}/transactions`, body, {
          idempotencyKey: attemptKey.current,
        });
        attemptKey.current = uuidv7();
        onSaved(r.data!);
      } else {
        const patch: Record<string, unknown> = {};
        const prevAccount =
          original.legs.find((l) => l.role === 'MAIN')?.accountId ?? original.legs[0]?.accountId;
        if (s.accountId !== prevAccount) patch['accountId'] = s.accountId;
        if (total !== original.amount.amount || currency !== original.amount.currency)
          patch['amount'] = { amount: total, currency };
        if (s.transactionDate !== original.transactionDate) patch['transactionDate'] = s.transactionDate;
        if ((s.postingDate || null) !== (original.postingDate ?? null))
          patch['postingDate'] = s.postingDate || null;
        if ((s.description.trim() || null) !== (original.description ?? null))
          patch['description'] = s.description.trim() || null;
        if ((s.notes.trim() || null) !== (original.notes ?? null)) patch['notes'] = s.notes.trim() || null;
        if ((s.paymentMethod || null) !== (original.paymentMethod ?? null))
          patch['paymentMethod'] = s.paymentMethod || null;
        if ((s.counterpartyId || null) !== (original.counterpartyId ?? null))
          patch['counterpartyId'] = s.counterpartyId || null;
        if (v.splits && JSON.stringify(v.splits) !== JSON.stringify(splitsOf(original)))
          patch['splits'] = v.splits;
        else if (!v.splits && patch['amount'] && original.splits.length === 1)
          patch['splits'] = [{ ...splitsOf(original)[0], amount: { amount: total, currency } }];
        if (Object.keys(patch).length === 0) {
          onSaved(original);
          return;
        }
        const r = await ctx.api.command<Transaction>(
          'PATCH',
          `${ctx.base}/transactions/${original.id}`,
          patch,
          {
            ifMatch: original.version,
          },
        );
        onSaved(r.data!);
      }
    } catch (err) {
      const p = problemOf(err);
      setProblem(p);
      if (err instanceof FinanceApiError && p.code === 'REFUND_EXCEEDS_ORIGINAL')
        setErrors({ refund: t('errors.refundExceeds') });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const accountLabel = (id: string) => catalogs.accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="tx-form-title"
      style={formStyle}
      noValidate
      data-testid="transaction-form"
    >
      <h2 id="tx-form-title" style={{ margin: 0 }}>
        {editing ? t('form.editTitle') : t('form.createTitle')}
      </h2>
      {editing ? <p style={mutedStyle}>{t('form.editNote')}</p> : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={editing}>
        <legend>{t('form.kind')}</legend>
        <div role="radiogroup" aria-label={t('form.kind')} style={rowStyle}>
          {RECORD_KINDS.map((k) => (
            <label key={k} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input
                type="radio"
                name="kind"
                value={k}
                checked={s.kind === k}
                onChange={() => set({ kind: k, splits: [newSplitRow()] })}
              />
              {t(`kinds.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div style={rowStyle}>
        <Field label={t('form.account')} error={errors['accountId']}>
          {(p) => (
            <select
              {...p}
              name="accountId"
              style={inputStyle}
              value={s.accountId}
              onChange={(e) => set({ accountId: e.target.value })}
            >
              <option value="">{t('form.chooseAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('form.amount', { currency })} error={errors['amount']}>
          {(p) => (
            <input
              {...p}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              style={inputStyle}
              value={s.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('form.date')} error={errors['transactionDate']}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="transactionDate"
              style={inputStyle}
              value={s.transactionDate}
              onChange={(e) => set({ transactionDate: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field label={t('form.description')}>
          {(p) => (
            <input
              {...p}
              name="description"
              maxLength={500}
              style={inputStyle}
              value={s.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('form.paymentMethod')}>
          {(p) => (
            <select
              {...p}
              name="paymentMethod"
              style={inputStyle}
              value={s.paymentMethod}
              onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod | '' })}
            >
              <option value="">{t('form.noPaymentMethod')}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`paymentMethods.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {!editing ? (
          <Field label={t('form.status')}>
            {(p) => (
              <select
                {...p}
                name="status"
                style={inputStyle}
                value={s.status}
                onChange={(e) => set({ status: e.target.value as State['status'] })}
              >
                {(['POSTED', 'PENDING', 'CLEARED'] as const).map((st) => (
                  <option key={st} value={st}>
                    {t(`status.${st}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
      <CounterpartyPicker
        ctx={ctx}
        f={f}
        counterparties={catalogs.counterparties}
        value={s.counterpartyId}
        onChange={(id) => set({ counterpartyId: id })}
        onCreated={catalogs.addCounterparty}
      />
      {s.kind === 'REFUND' && !editing ? (
        <div style={rowStyle}>
          <Field label={t('form.refundOf')} hint={t('form.refundOfHint')} error={errors['refund']}>
            {(p) => (
              <select
                {...p}
                name="refundOfTransactionId"
                style={inputStyle}
                value={s.refundOfTransactionId}
                onChange={(e) => set({ refundOfTransactionId: e.target.value })}
              >
                <option value="">{t('form.noRefundOf')}</option>
                {refundCandidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {formatLocalDate(x.transactionDate, locale)} · {x.description ?? t(`kinds.${x.kind}`)} ·{' '}
                    {formatMoney(x.amount, locale)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {problem?.code === 'REFUND_EXCEEDS_ORIGINAL' || s.confirmRefundExceedsOriginal ? (
            <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="confirmRefundExceedsOriginal"
                checked={s.confirmRefundExceedsOriginal}
                onChange={(e) => set({ confirmRefundExceedsOriginal: e.target.checked })}
              />
              {t('form.confirmRefundExceeds')}
            </label>
          ) : null}
        </div>
      ) : null}
      {s.kind === 'ADJUSTMENT' ? (
        <div style={rowStyle}>
          <Field label={t('form.direction')}>
            {(p) => (
              <select
                {...p}
                name="direction"
                style={inputStyle}
                value={s.direction}
                disabled={editing}
                onChange={(e) => set({ direction: e.target.value as State['direction'] })}
              >
                <option value="INCREASE">{t('direction.INCREASE')}</option>
                <option value="DECREASE">{t('direction.DECREASE')}</option>
              </select>
            )}
          </Field>
          <Field label={t('form.reason')} error={errors['reason']}>
            {(p) => (
              <input
                {...p}
                name="reason"
                maxLength={500}
                required
                style={inputStyle}
                value={s.reason}
                disabled={editing}
                onChange={(e) => set({ reason: e.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}
      {usesSplits ? (
        <SplitsEditor
          rows={s.splits}
          onChange={(rows) => set({ splits: rows })}
          total={total}
          money={money}
          categories={cats}
          tags={catalogs.tags}
          f={f}
          customFields={{
            fields: txFields,
            cf,
            errors: fieldErrors,
            originals: original?.splits.map((x) => x.customFields),
          }}
        />
      ) : null}
      {errors['splits'] ? (
        <p role="alert" style={errorStyle}>
          {errors['splits']}
        </p>
      ) : null}
      <details>
        <summary>{t('form.more')}</summary>
        <div style={rowStyle}>
          <Field label={t('form.postingDate')} hint={t('form.postingDateHint')}>
            {(p) => (
              <input
                {...p}
                type="date"
                name="postingDate"
                style={inputStyle}
                value={s.postingDate}
                onChange={(e) => set({ postingDate: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.notes')}>
            {(p) => (
              <input
                {...p}
                name="notes"
                maxLength={4000}
                style={inputStyle}
                value={s.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </Field>
        </div>
      </details>
      {duplicates.length > 0 ? (
        <div role="status" data-testid="duplicate-warning" style={warningStyle}>
          <p style={{ margin: 0 }}>{t('form.possibleDuplicate')}</p>
          <ul>
            {duplicates.map((d) => (
              <li key={d.transactionId}>
                <a
                  href={ctx.href(`/transacciones/${d.transactionId}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {formatLocalDate(d.transactionDate, locale)} · {d.description ?? accountLabel(s.accountId)}{' '}
                  · {formatMoney(d.amount, locale)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy}>
          {busy ? t('form.saving') : editing ? t('form.save') : t('form.record')}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={busy}>
            {t('form.cancel')}
          </button>
        ) : null}
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </form>
  );
}

/** Splits de una transacción existente en la forma de `SplitInput` (para comparar y reenviar). */
function splitsOf(tx: Transaction) {
  return tx.splits.map((s) => ({
    amount: { amount: s.amount.amount, currency: s.amount.currency },
    categoryId: s.categoryId,
    ...(s.tagIds?.length ? { tagIds: [...s.tagIds] } : {}),
  }));
}
