'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import { formatForecastMoney } from '../forecasts/logic';
import { problemMessage } from '../../errors/error-messages';
import { useNotices } from '../common/notices';
import { todayIn } from '../common/dates';
import { nextFieldError, useDirtyFields, withFieldError } from '../common/forms';
import { parseAmount, scaleFor } from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod, type Transaction } from '../common/types';
import { errorStyle, Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { useCustomFields } from '../custom-fields/CustomFieldInputs';
import { buildFieldsPayload, type CustomFieldError } from '../custom-fields/logic';
import { SuggestionChip } from '../category-suggestions/SuggestionChip';
import { useCategorySuggestion } from '../category-suggestions/useCategorySuggestion';
import {
  chipCategoryId,
  feedbackPath,
  type ChipSuggestion,
  type SuggestionKind,
} from '../category-suggestions/logic';
import { categoryOptions, type Catalogs } from './catalogs';
import { CounterpartyPicker } from './CounterpartyPicker';
import { newSplitRow, summarizeSplits } from './splits';
import { SplitsEditor } from './SplitsEditor';
import { writeLastAccount } from './last-account';
import { resetAfterSave, type FormState as State, type RecordKind } from './form-state';

export type { RecordKind };
export const RECORD_KINDS: readonly RecordKind[] = ['EXPENSE', 'INCOME', 'REFUND', 'ADJUSTMENT'];

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
  afterSave = 'detail',
  autoFocusAmount = false,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  catalogs: Catalogs;
  original?: Transaction;
  duplicateOf?: Transaction;
  presetAccountId?: string;
  presetKind?: RecordKind;
  /**
   * Qué pasa tras registrar un movimiento nuevo (add-quick-capture, D502): `'stay'` publica un aviso con «Deshacer» y «Ver»
   * y deja el formulario listo para el siguiente; `'detail'` llama a `onSaved` (la página navega al detalle).
   */
  afterSave?: 'stay' | 'detail';
  /** Foco en el monto al montar el alta (solo desde `/transacciones/nueva`). */
  autoFocusAmount?: boolean;
  onSaved: (tx: Transaction) => void;
  onCancel?: () => void;
}) {
  const f = useFormat('Transactions', ctx);
  const cf = useFormat('CustomFields', ctx);
  const sf = useFormat('CategorySuggestions', ctx);
  const customFields = useCustomFields(ctx);
  const txFields = customFields.active('TRANSACTION');
  const [fieldErrors, setFieldErrors] = useState<Record<number, Record<string, CustomFieldError>>>({});
  // add-rule-engine: las reglas con disparador de creación manual completan los campos vacíos salvo que se pida no aplicarlas.
  const [applyRules, setApplyRules] = useState(true);
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
  const amountRef = useRef<HTMLInputElement>(null);
  const [focusAmountTick, setFocusAmountTick] = useState(0);
  const notices = useNotices();
  // «Deshacer» en curso por transacción: un segundo clic no envía otra anulación (el botón además queda deshabilitado).
  const undoing = useRef(new Set<string>());
  // add-category-suggestions: la sugerencia aceptada o descartada y la última por historial mostrada (para la tasa).
  const [acceptedChip, setAcceptedChip] = useState<ChipSuggestion | null>(null);
  const [dismissedChip, setDismissedChip] = useState(false);
  const lastHistoryChip = useRef<Extract<ChipSuggestion, { source: 'HISTORY' }> | null>(null);
  // Tras registrar y seguir, el foco vuelve al monto (después del render que vació el formulario).
  useEffect(() => {
    if (focusAmountTick > 0) amountRef.current?.focus();
  }, [focusAmountTick]);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const accounts = catalogs.activeAccounts.length || !original ? catalogs.activeAccounts : catalogs.accounts;
  const account = catalogs.accounts.find((a) => a.id === s.accountId);
  const currency = account?.currency ?? ctx.ws.baseCurrency;
  const scale = scaleFor(currency, ctx.scales);
  const money = { locale, currency, scale };
  const parsedAmount = parseAmount(s.amount, money);
  const total = parsedAmount.ok ? parsedAmount.value : null;
  // Validación del monto al salir del campo (decisión 4 del change): el error aparece al salir de un campo modificado y se limpia al corregir.
  const { isDirty, markDirty, resetDirty } = useDirtyFields();
  const validateAmountField = (event: 'blur' | 'input', raw: string) =>
    setErrors((prev) => {
      const parsed = parseAmount(raw, money);
      const computed = parsed.ok ? undefined : t(`errors.amount.${parsed.error}`, { scale, currency });
      return withFieldError(
        prev,
        'amount',
        nextFieldError(event, { dirty: isDirty('amount'), current: prev['amount'], computed }),
      );
    });
  const categoryKind = s.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const cats = useMemo(
    () => categoryOptions(catalogs.categories, catalogs.groups, categoryKind),
    [catalogs.categories, catalogs.groups, categoryKind],
  );
  const usesSplits = s.kind !== 'ADJUSTMENT';
  // Sugerencia de categoría (add-category-suggestions): solo mientras la categoría está vacía y nunca se asigna sola.
  const categoryEmpty = usesSplits && !editing && s.splits.length === 1 && !s.splits[0]?.categoryId;
  const chip = useCategorySuggestion(ctx, {
    enabled: categoryEmpty && ctx.canEdit,
    kind: (s.kind === 'ADJUSTMENT' ? 'EXPENSE' : s.kind) as SuggestionKind,
    description: s.description,
    counterpartyId: s.counterpartyId,
    accountId: s.accountId,
    date: s.transactionDate,
  });
  useEffect(() => {
    if (chip?.source === 'HISTORY') lastHistoryChip.current = chip;
    // Sin sugerencia vigente y con la categoría aún vacía no hay nada que medir (con la categoría ya elegida se conserva
    // la última mostrada: aceptada o corregida).
    else if (chip === null && categoryEmpty) lastHistoryChip.current = null;
  }, [chip, categoryEmpty]);
  // Un texto o una contraparte nuevos pueden traer otra sugerencia: se vuelve a ofrecer.
  useEffect(() => {
    setDismissedChip(false);
  }, [s.description, s.counterpartyId, s.kind]);
  const categoryNameOf = (id: string) => catalogs.categories.find((c) => c.id === id)?.name ?? id;
  const counterpartyNameOf = (id: string | null) =>
    id === null ? undefined : catalogs.counterparties.find((c) => c.id === id)?.name;

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
    // «Registrar e ir al detalle» envía `intent=detail`; Enter y «Registrar» se quedan en el formulario (modo `stay`).
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const goToDetail = afterSave === 'detail' || (submitter as HTMLButtonElement | null)?.value === 'detail';
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
          ...(s.kind !== 'ADJUSTMENT' && !applyRules ? { applyRules: false } : {}),
        };
        const r = await ctx.api.command<Transaction>('POST', `${ctx.base}/transactions`, body, {
          idempotencyKey: attemptKey.current,
        });
        attemptKey.current = uuidv7();
        recordSuggestionOutcome(r.data!);
        writeLastAccount(ctx.me.id, ctx.ws.id, s.accountId);
        if (goToDetail) onSaved(r.data!);
        else recorded(r.data!);
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

  /** Acciones del aviso de registro: «Deshacer» (mientras no se anuló ni está en curso) y «Ver» (enlace al detalle). */
  function noticeActions(tx: Transaction, noticeId: () => string, state: 'ready' | 'busy' | 'done') {
    const view = { key: 'view', label: t('quick.view'), href: ctx.href(`/transacciones/${tx.id}`) };
    if (state === 'done') return [view];
    return [
      {
        key: 'undo',
        label: t('quick.undo'),
        disabled: state === 'busy',
        onAction: () => void undo(tx, noticeId),
      },
      view,
    ];
  }

  /** «Deshacer» = anular con el comando existente (reversa, auditoría y evento como desde el detalle; D508). */
  async function undo(tx: Transaction, noticeId: () => string) {
    if (undoing.current.has(tx.id)) return;
    undoing.current.add(tx.id);
    const id = noticeId();
    notices.update(id, { actions: noticeActions(tx, noticeId, 'busy') });
    try {
      await ctx.api.command<Transaction>(
        'POST',
        `${ctx.base}/transactions/${tx.id}/void`,
        { reason: t('quick.undoReason') },
        { ifMatch: tx.version, idempotencyKey: uuidv7() },
      );
      notices.update(id, {
        text: t('quick.voided'),
        tone: 'info',
        actions: noticeActions(tx, noticeId, 'done'),
      });
    } catch (err) {
      notices.update(id, {
        text: problemMessage(problemOf(err), ctx.uiLocale),
        tone: 'error',
        actions: noticeActions(tx, noticeId, 'done'),
      });
    }
  }

  /** Registrar y seguir (D502): aviso persistente, formulario limpio con tipo, cuenta, fecha y estado, y foco al monto. */
  function recorded(tx: Transaction) {
    let noticeId = '';
    noticeId = notices.push({
      text: t(`quick.saved.${s.kind}`, { amount: formatForecastMoney(tx.amount, ctx.formatLocale) }),
      tone: 'success',
      actions: noticeActions(tx, () => noticeId, 'ready'),
    });
    resetDirty();
    setErrors({});
    setFieldErrors({});
    setDuplicates([]);
    setAcceptedChip(null);
    setDismissedChip(false);
    lastHistoryChip.current = null;
    setS((prev) => resetAfterSave(prev));
    setFocusAmountTick((n) => n + 1);
  }

  /**
   * Tasa de aceptación (add-category-suggestions): si se mostró una sugerencia por historial, informa con qué categoría se
   * guardó el movimiento (aceptada, corregida o sin categoría). Sin descripciones ni montos; si la llamada se pierde, solo
   * se pierde un dato de la métrica, nunca uno financiero.
   */
  function recordSuggestionOutcome(tx: Transaction) {
    const shown = lastHistoryChip.current;
    if (!shown) return;
    const saved = tx.splits[0]?.categoryId ?? null;
    const system = catalogs.categories.find((c) => c.id === saved)?.systemCode ?? '';
    void ctx.api
      .command('POST', feedbackPath(ctx.base), {
        surface: 'MANUAL_ENTRY',
        level: shown.suggestion.level,
        suggestedCategoryId: shown.suggestion.categoryId,
        chosenCategoryId: saved === null || system.startsWith('UNCATEGORIZED') ? null : saved,
        transactionId: tx.id,
      })
      .catch(() => undefined);
    lastHistoryChip.current = null;
  }

  const accountLabel = (id: string) => catalogs.accounts.find((a) => a.id === id)?.name ?? id;

  const accountField = (
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
  );
  const amountField = (
    <Field label={t('form.amount', { currency })} error={errors['amount']}>
      {(p) => (
        <input
          {...p}
          ref={amountRef}
          name="amount"
          inputMode="decimal"
          enterKeyHint="next"
          autoFocus={autoFocusAmount && !editing}
          autoComplete="off"
          style={inputStyle}
          value={s.amount}
          onChange={(e) => {
            markDirty('amount');
            set({ amount: e.target.value });
            validateAmountField('input', e.target.value);
          }}
          onBlur={() => validateAmountField('blur', s.amount)}
        />
      )}
    </Field>
  );
  const dateField = (
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
  );
  const descriptionRow = (
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
  );
  const counterpartyPicker = (
    <CounterpartyPicker
      ctx={ctx}
      f={f}
      counterparties={catalogs.counterparties}
      value={s.counterpartyId}
      onChange={(id) => set({ counterpartyId: id })}
      onCreated={catalogs.addCounterparty}
    />
  );
  const refundBlock = (
    <>
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
    </>
  );
  const adjustmentBlock = (
    <>
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
    </>
  );
  const categoryBlock = (
    <>
      {acceptedChip && s.splits[0]?.categoryId === chipCategoryId(acceptedChip) ? (
        <SuggestionChip
          f={sf}
          chip={acceptedChip}
          kind={s.kind as SuggestionKind}
          categoryName={categoryNameOf}
          counterpartyName={counterpartyNameOf}
          accepted
          onAccept={() => undefined}
          onOther={() => undefined}
        />
      ) : chip && categoryEmpty && !dismissedChip && !(chip.source === 'RULE_APPLIES' && !applyRules) ? (
        <SuggestionChip
          f={sf}
          chip={chip}
          kind={s.kind as SuggestionKind}
          categoryName={categoryNameOf}
          counterpartyName={counterpartyNameOf}
          accepted={false}
          onAccept={() => {
            const id = chipCategoryId(chip);
            if (id === null) return;
            setAcceptedChip(chip);
            set({ splits: [{ ...s.splits[0]!, categoryId: id }] });
          }}
          onOther={() => setDismissedChip(true)}
        />
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
    </>
  );

  const kindFieldset = (
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
  );

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
      {editing ? kindFieldset : null}
      {editing ? (
        <div style={rowStyle}>
          {accountField}
          {amountField}
          {dateField}
        </div>
      ) : (
        <>
          {amountField}
          {kindFieldset}
          {categoryBlock}
          <div style={rowStyle}>
            {accountField}
            {dateField}
          </div>
          {refundBlock}
          {adjustmentBlock}
        </>
      )}
      {descriptionRow}
      {counterpartyPicker}
      {editing ? refundBlock : null}
      {editing ? adjustmentBlock : null}
      {editing ? categoryBlock : null}
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
      {!editing && s.kind !== 'ADJUSTMENT' ? (
        <div>
          <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={applyRules}
              data-testid="tx-apply-rules"
              onChange={(e) => setApplyRules(e.target.checked)}
            />
            {t('form.applyRules')}
          </label>
          <small style={mutedStyle}>{t('form.applyRulesHint')}</small>
        </div>
      ) : null}
      <div style={rowStyle}>
        <button type="submit" name="intent" value="stay" disabled={busy}>
          {busy ? t('form.saving') : editing ? t('form.save') : t('form.record')}
        </button>
        {!editing && afterSave === 'stay' ? (
          <button type="submit" name="intent" value="detail" className="pf-button-secondary" disabled={busy}>
            {t('quick.recordAndDetail')}
          </button>
        ) : null}
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
