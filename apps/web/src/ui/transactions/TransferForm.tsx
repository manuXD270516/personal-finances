'use client';

import { useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatMoney, isNegative } from '../dashboard/format';
import { todayIn } from '../common/dates';
import { parseAmount, scaleFor } from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod, type Transaction } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { CardPaymentHint } from '../debt/cards/CardPaymentHint';
import { paymentSuggestions } from '../debt/cards/logic';
import { useCardOfAccount } from '../debt/cards/useCardLookup';
import { useCatalogs } from './catalogs';

export function NewTransferPage(props: {
  cardPayment?: boolean;
  fromAccountId?: string;
  toAccountId?: string;
}) {
  return <WithWorkspace>{(ctx) => <TransferForm ctx={ctx} {...props} />}</WithWorkspace>;
}

/** Enlace al formulario de conversión con origen, destino y monto prellenados (transferencia entre monedas). */
export const conversionHref = (
  href: (p: string) => string,
  from: string,
  to: string,
  amount: string,
): string => {
  const q = new URLSearchParams();
  if (from) q.set('origen', from);
  if (to) q.set('destino', to);
  if (amount.trim()) q.set('monto', amount.trim());
  return href(`/fx/conversiones/nueva?${q.toString()}`);
};

/**
 * Transferencia entre cuentas propias (add-transfers 6.1): comisión opcional pagada desde el origen, medio de pago
 * (incluido QR) y atajo "Pagar tarjeta" (activo → pasivo de la tarjeta; no es gasto). Si las monedas difieren se
 * orienta a una conversión prellenada, también ante `TRANSFER_CURRENCY_MISMATCH` de la API.
 */
function TransferForm({
  ctx,
  cardPayment,
  fromAccountId,
  toAccountId,
}: {
  ctx: WorkspaceContext;
  cardPayment?: boolean;
  fromAccountId?: string;
  toAccountId?: string;
}) {
  const f = useFormat('Transactions', ctx);
  const cf = useFormat('Cards', ctx);
  const { t, locale } = f;
  const catalogs = useCatalogs(ctx);
  const [s, setS] = useState({
    from: fromAccountId ?? '',
    to: toAccountId ?? '',
    amount: '',
    fee: '',
    transactionDate: todayIn(ctx.timeZone),
    paymentMethod: '' as PaymentMethod | '',
    description: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);
  const set = (patch: Partial<typeof s>) => setS((prev) => ({ ...prev, ...patch }));

  const accounts = catalogs.activeAccounts;
  const fromOptions = cardPayment ? accounts.filter((a) => a.classification === 'ASSET') : accounts;
  const toOptions = (cardPayment ? accounts.filter((a) => a.type === 'CREDIT_CARD') : accounts).filter(
    (a) => a.id !== s.from,
  );
  const from = accounts.find((a) => a.id === s.from);
  const to = accounts.find((a) => a.id === s.to);
  const mismatch = Boolean(from && to && from.currency !== to.currency);
  const currency = from?.currency ?? ctx.ws.baseCurrency;
  const money = { locale, currency, scale: scaleFor(currency, ctx.scales) };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || mismatch) return;
    const next: Record<string, string> = {};
    if (!from) next['from'] = t('errors.accountRequired');
    if (!to) next['to'] = t('errors.accountRequired');
    if (from && to && from.id === to.id) next['to'] = t('errors.sameAccount');
    const amount = parseAmount(s.amount, money);
    if (!amount.ok) next['amount'] = t(`errors.amount.${amount.error}`, { scale: money.scale, currency });
    const fee = s.fee.trim() ? parseAmount(s.fee, money) : undefined;
    if (fee && !fee.ok) next['fee'] = t(`errors.amount.${fee.error}`, { scale: money.scale, currency });
    setErrors(next);
    if (Object.keys(next).length || !amount.ok || !from || !to) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<Transaction>(
        'POST',
        `${ctx.base}/transfers`,
        {
          transactionDate: s.transactionDate,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: { amount: amount.value, currency },
          ...(fee && fee.ok ? { fee: { amount: { amount: fee.value, currency } } } : {}),
          ...(s.paymentMethod ? { paymentMethod: s.paymentMethod } : {}),
          ...(s.description.trim()
            ? { description: s.description.trim() }
            : cardPayment
              ? { description: t('transfer.cardPaymentDescription', { card: to.name }) }
              : {}),
        },
        { idempotencyKey: attemptKey.current },
      );
      attemptKey.current = uuidv7();
      window.location.assign(ctx.href(`/transacciones/${r.data!.id}?aviso=registrada`));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Destino = cuenta de una tarjeta registrada: rótulo "Pago de tarjeta" y sugerencias del último estado emitido.
  const card = useCardOfAccount(ctx.api, ctx.base, to?.type === 'CREDIT_CARD' ? to.id : undefined);
  const suggestions = to ? paymentSuggestions(card, to.id) : null;

  const owed =
    to && to.classification === 'LIABILITY' && !isNegative(to.balance.amount) ? to.balance : undefined;

  return (
    <section style={pageStyle}>
      <p>
        <a href={ctx.href('/transacciones')}>{t('backToList')}</a>
      </p>
      <form
        onSubmit={(e) => void submit(e)}
        aria-labelledby="transfer-title"
        style={formStyle}
        noValidate
        data-testid="transfer-form"
      >
        <h1 id="transfer-title" style={{ margin: 0, fontSize: '1.5rem' }}>
          {cardPayment ? t('transfer.cardTitle') : t('transfer.title')}
        </h1>
        <p style={mutedStyle}>{cardPayment ? t('transfer.cardIntro') : t('transfer.intro')}</p>
        <div style={rowStyle}>
          <Field label={t('transfer.from')} error={errors['from']}>
            {(p) => (
              <select
                {...p}
                name="fromAccountId"
                style={inputStyle}
                value={s.from}
                onChange={(e) => set({ from: e.target.value })}
              >
                <option value="">{t('form.chooseAccount')}</option>
                {fromOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={cardPayment ? t('transfer.card') : t('transfer.to')} error={errors['to']}>
            {(p) => (
              <select
                {...p}
                name="toAccountId"
                style={inputStyle}
                value={s.to}
                onChange={(e) => set({ to: e.target.value })}
              >
                <option value="">{t('form.chooseAccount')}</option>
                {toOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {owed ? (
          <p data-testid="card-owed">
            {t('transfer.owed', { amount: formatMoney(owed, locale) })}{' '}
            <button type="button" onClick={() => set({ amount: owed.amount })}>
              {t('transfer.payAll')}
            </button>
          </p>
        ) : null}
        {suggestions && to ? (
          <CardPaymentHint
            suggestions={suggestions}
            f={cf}
            href={ctx.href}
            mismatch={mismatch}
            onPick={(amount) => set({ amount })}
            conversionLink={conversionHref(ctx.href, from?.id ?? '', to.id, '')}
          />
        ) : null}
        {mismatch && from && to ? (
          <div role="alert" style={warningStyle} data-testid="transfer-mismatch">
            <p style={{ margin: 0 }}>{t('transfer.mismatch', { from: from.currency, to: to.currency })}</p>
            <a href={conversionHref(ctx.href, from.id, to.id, s.amount)} data-testid="open-conversion">
              {t('transfer.openConversion')}
            </a>
          </div>
        ) : null}
        <div style={rowStyle}>
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
          <Field label={t('transfer.fee', { currency })} hint={t('transfer.feeHint')} error={errors['fee']}>
            {(p) => (
              <input
                {...p}
                name="fee"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.fee}
                onChange={(e) => set({ fee: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.date')}>
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
        </div>
        <div>
          <button type="submit" disabled={busy || mismatch}>
            {busy ? t('form.saving') : cardPayment ? t('transfer.payCard') : t('transfer.record')}
          </button>
        </div>
        {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        {problem?.code === 'TRANSFER_CURRENCY_MISMATCH' && from && to ? (
          <a href={conversionHref(ctx.href, from.id, to.id, s.amount)}>{t('transfer.openConversion')}</a>
        ) : null}
      </form>
    </section>
  );
}
