'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import { isZeroAmount } from '../../common/money';
import type { Category, Page, Transaction } from '../../common/types';
import {
  ConfirmDialog,
  Field,
  cellStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../../common/workspace';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import {
  CHARGE_COMPONENTS,
  buildChargeInput,
  chargeTotal,
  emptyChargeForm,
  possibleDuplicates,
  type ChargeForm,
  type ChargeFormErrors,
} from './charges-logic';
import { cardPath } from './logic';
import type { CardCharge, CardStatement, CreditCard } from './types';

/** Etiqueta de un componente del cargo ("Intereses (BOB)"). */
const componentLabel = (f: FormatContext, key: (typeof CHARGE_COMPONENTS)[number], currency: string) =>
  f.t(`charges.fields.${key}`, { currency });

/**
 * Formulario «Registrar intereses y cargos» (tarea 6.1): fecha (por omisión el cierre del estado de cuenta), componentes
 * y total en vivo. Con `adoptTransactionId` declara un gasto existente como cargo (sin fecha propia). Avisa si hay un
 * gasto del ciclo en «Intereses pagados» o «Comisiones» sin adoptar (posible doble registro).
 */
export function ChargeFormPanel({
  ctx,
  f,
  card,
  accountId,
  currency,
  initial,
  adoptTransactionId,
  duplicates,
  onDone,
  onCancel,
  testId = 'charge-form',
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  card: CreditCard;
  accountId: string;
  currency: string;
  initial: ChargeForm;
  adoptTransactionId?: string;
  duplicates?: readonly Transaction[];
  onDone: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const [form, setForm] = useState<ChargeForm>(initial);
  const [errors, setErrors] = useState<ChargeFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const opts = { locale: ctx.formatLocale, scales: ctx.scales };
  const total = useMemo(
    () => chargeTotal(form, currency, opts),
    [form, currency, ctx.formatLocale, ctx.scales],
  );

  async function save() {
    setProblem(undefined);
    const built = buildChargeInput(form, {
      ...opts,
      accountId,
      currency,
      ...(adoptTransactionId ? { adoptTransactionId } : {}),
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await ctx.api.command('POST', `${cardPath(ctx.base, card.id)}/charges`, built.input, {
        idempotencyKey: key.current,
        contentType: 'application/json',
      });
      key.current = uuidv7();
      onDone();
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const message = (e: ChargeFormErrors[keyof ChargeFormErrors]) =>
    e ? f.t(`charges.errors.${e}`) : undefined;
  return (
    <form
      style={{ ...formStyle, margin: 0 }}
      noValidate
      data-testid={testId}
      aria-label={f.t('charges.register')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <strong>{adoptTransactionId ? f.t('charges.adopt.title') : f.t('charges.register')}</strong>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {adoptTransactionId ? f.t('charges.adopt.hint') : f.t('charges.hint')}
      </p>
      {duplicates && duplicates.length > 0 && !adoptTransactionId ? (
        <p role="note" style={warningStyle} data-testid="charge-duplicate-warning">
          <span aria-hidden="true">⚠</span> {f.t('charges.duplicateWarning', { count: duplicates.length })}{' '}
          {duplicates.map((t) => (
            <a key={t.id} href={ctx.href(`/transacciones/${t.id}`)} data-testid="charge-duplicate-link">
              {formatBusinessDate(t.transactionDate)}
            </a>
          ))}
        </p>
      ) : null}
      {adoptTransactionId ? null : (
        <Field label={f.t('charges.fields.date')} error={message(errors.businessDate)}>
          {(p) => (
            <input
              {...p}
              type="date"
              style={inputStyle}
              value={form.businessDate}
              data-testid="charge-date"
              onChange={(e) => setForm({ ...form, businessDate: e.target.value })}
            />
          )}
        </Field>
      )}
      <div style={rowStyle}>
        {CHARGE_COMPONENTS.map((k) => (
          <Field key={k} label={componentLabel(f, k, currency)} error={message(errors[k])}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form[k]}
                data-testid={`charge-${k}`}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      {errors.form ? (
        <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }} data-testid="charge-form-error">
          {f.t(`charges.errors.${errors.form}`)}
        </p>
      ) : null}
      <p style={{ margin: 0 }} aria-live="polite" data-testid="charge-total">
        {total ? f.t('charges.total', { amount: formatMoney(total, f.locale) }) : f.t('charges.totalPending')}
      </p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="charge-save">
          {adoptTransactionId ? f.t('charges.adopt.save') : f.t('charges.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} data-testid="charge-cancel">
          {f.t('charges.cancel')}
        </button>
      </div>
    </form>
  );
}

/** Categorías de sistema «Intereses pagados» y «Comisiones» y los gastos del ciclo que las usan sin ser cargo. */
function useDuplicates(
  ctx: WorkspaceContext,
  accountId: string,
  from: string,
  to: string,
  enabled: boolean,
): readonly Transaction[] {
  const [found, setFound] = useState<readonly Transaction[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const cats = await ctx.api.get<Page<Category>>(
          `${ctx.base}/categories?limit=200&includeArchived=true`,
        );
        const ids = new Set(
          (cats.data?.data ?? [])
            .filter((c) => c.systemCode === 'INTEREST' || c.systemCode === 'FEES')
            .map((c) => c.id),
        );
        if (ids.size === 0) return;
        const q = new URLSearchParams({
          accountId,
          kind: 'EXPENSE',
          dateFrom: from,
          dateTo: to,
          limit: '200',
        });
        const txs = await ctx.api.get<Page<Transaction>>(`${ctx.base}/transactions?${q.toString()}`);
        if (!cancelled) setFound(possibleDuplicates(txs.data?.data ?? [], ids));
      } catch {
        // El aviso es una ayuda: sin él el formulario sigue funcionando.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, accountId, from, to, enabled]);
  return found;
}

/**
 * Cargos de un estado de cuenta: lista con sus componentes y anulación (con motivo), propuesta desde la diferencia con el
 * banco y el formulario de registro. Solo EDITOR y OWNER registran o anulan; el VIEWER los ve.
 */
export function ChargesSection({
  ctx,
  card,
  statement,
  onChanged,
}: {
  ctx: WorkspaceContext;
  card: CreditCard;
  statement: CardStatement;
  onChanged: (message: string) => void;
}) {
  const f = useFormat('Cards', ctx);
  const [form, setForm] = useState<ChargeForm | undefined>();
  const [voiding, setVoiding] = useState<CardCharge | undefined>();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const charges = statement.charges ?? [];
  const editable = ctx.canEdit && card.status === 'ACTIVE';
  const duplicates = useDuplicates(
    ctx,
    statement.accountId,
    statement.cycleStart,
    statement.closingDate,
    !!form,
  );
  const proposal = statement.chargeProposal ?? null;

  async function voidCharge(charge: CardCharge) {
    setProblem(undefined);
    setBusy(true);
    try {
      await ctx.api.command(
        'POST',
        `${cardPath(ctx.base, card.id)}/charges/${charge.id}/void`,
        { reason: reason.trim() },
        { ifMatch: charge.version, idempotencyKey: key.current, contentType: 'application/json' },
      );
      key.current = uuidv7();
      setVoiding(undefined);
      setReason('');
      onChanged(f.t('charges.voided'));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`charges-${statement.cardAccountId}-${statement.closingDate}`}
      style={{ display: 'grid', gap: 'var(--pf-space-2)', minWidth: 0 }}
      data-testid="charges-section"
    >
      <h3 id={`charges-${statement.cardAccountId}-${statement.closingDate}`} style={{ margin: 0 }}>
        {f.t('charges.title')}
      </h3>
      {charges.length === 0 ? (
        <p style={mutedStyle} data-testid="charges-empty">
          {f.t('charges.empty')}
        </p>
      ) : (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('charges.title')}>
          <table style={tableStyle} data-testid="charges-table">
            <caption className="pf-sr-only">
              {f.t('charges.caption', { closing: formatBusinessDate(statement.closingDate) })}
            </caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('charges.fields.date')}
                </th>
                {CHARGE_COMPONENTS.map((k) => (
                  <th key={k} scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t(`charges.components.${k}`)}
                  </th>
                ))}
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('charges.totalShort')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('charges.originShort')}
                </th>
                {editable ? (
                  <th scope="col" style={cellStyle}>
                    <span className="pf-sr-only">{f.t('charges.actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} data-testid="charge-row" data-charge-id={c.id}>
                  <td style={cellStyle}>
                    <a href={ctx.href(`/transacciones/${c.transactionId}`)} data-testid="charge-tx-link">
                      {formatBusinessDate(c.businessDate)}
                    </a>
                  </td>
                  {CHARGE_COMPONENTS.map((k) => (
                    <td key={k} style={numCellStyle}>
                      {isZeroAmount(c[k].amount) ? '—' : formatMoney(c[k], f.locale)}
                    </td>
                  ))}
                  <td style={numCellStyle} data-testid="charge-row-total">
                    {formatMoney(c.total, f.locale)}
                  </td>
                  <td style={cellStyle}>{f.t(`charges.origin.${c.origin}`)}</td>
                  {editable ? (
                    <td style={cellStyle}>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiding(c);
                          setReason('');
                        }}
                        data-testid="charge-void"
                      >
                        {f.t('charges.void')}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {voiding ? (
        <ConfirmDialog
          testId="charge-void-panel"
          title={f.t('charges.voidTitle', { amount: formatMoney(voiding.total, f.locale) })}
          description={f.t('charges.voidDescription')}
          confirmLabel={f.t('charges.voidConfirm')}
          cancelLabel={f.t('charges.cancel')}
          busy={busy}
          confirmDisabled={reason.trim() === ''}
          onConfirm={() => void voidCharge(voiding)}
          onCancel={() => setVoiding(undefined)}
        >
          <Field label={f.t('charges.voidReason')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                maxLength={200}
                value={reason}
                data-testid="charge-void-reason"
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {editable && proposal && !form ? (
        <p role="note" style={warningStyle} data-testid="charge-proposal">
          {f.t('charges.proposal', { amount: formatMoney(proposal.total, f.locale) })}{' '}
          <button
            type="button"
            data-testid="charge-proposal-use"
            onClick={() => setForm(emptyChargeForm(proposal.businessDate, proposal.total.amount))}
          >
            {f.t('charges.useProposal')}
          </button>
        </p>
      ) : null}
      {editable && !form ? (
        <div>
          <button
            type="button"
            data-testid="charge-open"
            onClick={() => setForm(emptyChargeForm(statement.closingDate))}
          >
            {f.t('charges.register')}
          </button>
        </div>
      ) : null}
      {editable && form ? (
        <ChargeFormPanel
          ctx={ctx}
          f={f}
          card={card}
          accountId={statement.accountId}
          currency={statement.currency}
          initial={form}
          duplicates={duplicates}
          onCancel={() => setForm(undefined)}
          onDone={() => {
            setForm(undefined);
            onChanged(f.t('charges.saved'));
          }}
        />
      ) : null}
    </section>
  );
}
