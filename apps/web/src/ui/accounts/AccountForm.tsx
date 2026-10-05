'use client';

import { useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import { parseAmount, scaleFor } from '../common/money';
import {
  ACCOUNT_TYPES,
  LIQUIDITIES,
  type Account,
  type AccountLiquidity,
  type AccountType,
  type Institution,
} from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { accountCurrencyOptions, defaultLiquidity, lastFourOf, maskedIdentifier, natureOf } from './logic';

interface FormState {
  name: string;
  type: AccountType;
  currency: string;
  institutionId: string;
  liquidity: AccountLiquidity;
  liquidityTouched: boolean;
  includeInNetWorth: boolean;
  /** Solo los últimos 4 caracteres: el valor completo se recorta al salir del campo y nunca se envía. */
  identifier: string;
  openingAmount: string;
  openingDate: string;
  cryptoNetwork: string;
  color: string;
  notes: string;
}

const initialState = (ctx: WorkspaceContext, account?: Account): FormState => ({
  name: account?.name ?? '',
  type: account?.type ?? 'BANK',
  currency: account?.currency ?? ctx.ws.baseCurrency,
  institutionId: account?.institutionId ?? '',
  liquidity: account?.liquidity ?? 'LIQUID',
  liquidityTouched: Boolean(account),
  includeInNetWorth: account?.includeInNetWorth ?? true,
  identifier: account?.accountNumberLast4 ?? '',
  openingAmount: '',
  openingDate: todayIn(ctx.timeZone),
  cryptoNetwork: account?.cryptoNetwork ?? '',
  color: account?.color ?? '',
  notes: account?.notes ?? '',
});

/**
 * Alta/edición de cuenta (add-accounts-management 7.2): tipo inmutable al editar, liquidez propuesta por tipo,
 * identificador recortado a 4 caracteres en el cliente, saldo inicial validado con la escala de la moneda (sin
 * redondeo) e `Idempotency-Key` por intento (un doble clic crea una sola cuenta y un solo asiento).
 */
export function AccountForm({
  ctx,
  account,
  institutions,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  account?: Account;
  institutions: readonly Institution[];
  onSaved: (account: Account) => void;
  onCancel?: () => void;
}) {
  const f = useFormat('Accounts', ctx);
  const { t } = f;
  const editing = Boolean(account);
  const [s, setS] = useState<FormState>(() => initialState(ctx, account));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);

  const currencyOptions = accountCurrencyOptions(ctx.currencies, {
    type: s.type,
    baseCurrency: ctx.ws.baseCurrency,
    ...(account ? { currentCurrency: account.currency } : {}),
  });
  const liability = natureOf(s.type) === 'LIABILITY';
  const set = (patch: Partial<FormState>) => setS((prev) => ({ ...prev, ...patch }));

  function setType(type: AccountType) {
    set({ type, ...(s.liquidityTouched ? {} : { liquidity: defaultLiquidity(type) }) });
  }

  function validate(): { ok: boolean; opening?: string; last4?: string | null } {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!s.name.trim()) next.name = t('errors.nameRequired');
    let last4: string | null | undefined;
    if (s.identifier.trim()) {
      last4 = lastFourOf(s.identifier);
      if (!last4) next.identifier = t('errors.identifierShort');
    } else last4 = editing && account?.accountNumberLast4 ? null : undefined;
    let opening: string | undefined;
    if (!editing && s.openingAmount.trim()) {
      const r = parseAmount(s.openingAmount, {
        locale: ctx.formatLocale,
        currency: s.currency,
        scale: scaleFor(s.currency, ctx.scales),
        allowZero: true,
      });
      if (r.ok) opening = r.value;
      else
        next.openingAmount = t(`errors.amount.${r.error}`, {
          scale: scaleFor(s.currency, ctx.scales),
          currency: s.currency,
        });
      if (!s.openingDate) next.openingDate = t('errors.dateRequired');
    }
    setErrors(next);
    return {
      ok: Object.keys(next).length === 0,
      ...(opening !== undefined ? { opening } : {}),
      ...(last4 !== undefined ? { last4 } : {}),
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const v = validate();
    if (!v.ok) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      if (!account) {
        const body = {
          name: s.name.trim(),
          type: s.type,
          currency: s.currency,
          liquidity: s.liquidity,
          includeInNetWorth: s.includeInNetWorth,
          ...(s.institutionId ? { institutionId: s.institutionId } : {}),
          ...(v.last4 ? { accountNumberLast4: v.last4 } : {}),
          ...(v.opening
            ? { openingBalance: { amount: { amount: v.opening, currency: s.currency }, date: s.openingDate } }
            : {}),
          ...(s.type === 'CRYPTO_WALLET' && s.cryptoNetwork.trim()
            ? { cryptoNetwork: s.cryptoNetwork.trim() }
            : {}),
          ...(s.color.trim() ? { color: s.color.trim() } : {}),
          ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        };
        const r = await ctx.api.command<Account>('POST', `${ctx.base}/accounts`, body, {
          idempotencyKey: attemptKey.current,
        });
        attemptKey.current = uuidv7();
        onSaved(r.data!);
      } else {
        const patch: Record<string, unknown> = {};
        if (s.name.trim() !== account.name) patch['name'] = s.name.trim();
        if (s.currency !== account.currency) patch['currency'] = s.currency;
        if ((s.institutionId || null) !== (account.institutionId ?? null))
          patch['institutionId'] = s.institutionId || null;
        if (s.liquidity !== account.liquidity) patch['liquidity'] = s.liquidity;
        if (s.includeInNetWorth !== account.includeInNetWorth)
          patch['includeInNetWorth'] = s.includeInNetWorth;
        if (v.last4 !== undefined && v.last4 !== (account.accountNumberLast4 ?? null))
          patch['accountNumberLast4'] = v.last4;
        if (
          account.type === 'CRYPTO_WALLET' &&
          (s.cryptoNetwork.trim() || null) !== (account.cryptoNetwork ?? null)
        )
          patch['cryptoNetwork'] = s.cryptoNetwork.trim() || null;
        if ((s.color.trim() || null) !== (account.color ?? null)) patch['color'] = s.color.trim() || null;
        if ((s.notes.trim() || null) !== (account.notes ?? null)) patch['notes'] = s.notes.trim() || null;
        if (Object.keys(patch).length === 0) {
          onSaved(account);
          return;
        }
        const r = await ctx.api.command<Account>('PATCH', `${ctx.base}/accounts/${account.id}`, patch, {
          ifMatch: account.version,
        });
        onSaved(r.data!);
      }
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const mask = maskedIdentifier(lastFourOf(s.identifier));

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="account-form-title"
      style={formStyle}
      noValidate
      data-testid="account-form"
    >
      <h2 id="account-form-title" style={{ margin: 0 }}>
        {editing ? t('form.editTitle') : t('form.createTitle')}
      </h2>
      <div style={rowStyle}>
        <Field label={t('form.name')} error={errors.name}>
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={100}
              style={inputStyle}
              value={s.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('form.type')} hint={editing ? t('form.typeImmutable') : undefined}>
          {(p) => (
            <select
              {...p}
              name="type"
              style={inputStyle}
              value={s.type}
              disabled={editing}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('form.currency')} hint={editing ? t('form.currencyHint') : undefined}>
          {(p) => (
            <select
              {...p}
              name="currency"
              style={inputStyle}
              value={s.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {currencyOptions.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field label={t('form.institution')}>
          {(p) => (
            <select
              {...p}
              name="institutionId"
              style={inputStyle}
              value={s.institutionId}
              onChange={(e) => set({ institutionId: e.target.value })}
            >
              <option value="">{t('form.noInstitution')}</option>
              {institutions
                .filter((i) => !i.archivedAt || i.id === s.institutionId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label={t('form.liquidity')} hint={t('form.liquidityHint')}>
          {(p) => (
            <select
              {...p}
              name="liquidity"
              style={inputStyle}
              value={s.liquidity}
              onChange={(e) => set({ liquidity: e.target.value as AccountLiquidity, liquidityTouched: true })}
            >
              {LIQUIDITIES.map((l) => (
                <option key={l} value={l}>
                  {t(`liquidity.${l}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t('form.identifier')}
          hint={mask ? t('form.identifierPreview', { mask }) : t('form.identifierHint')}
          error={errors.identifier}
        >
          {(p) => (
            <input
              {...p}
              name="identifier"
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
              value={s.identifier}
              onChange={(e) => set({ identifier: e.target.value })}
              // Recorte en el cliente: al salir del campo solo quedan los últimos 4 caracteres.
              onBlur={() => {
                const last4 = lastFourOf(s.identifier);
                if (last4) set({ identifier: last4 });
              }}
            />
          )}
        </Field>
      </div>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          name="includeInNetWorth"
          checked={s.includeInNetWorth}
          onChange={(e) => set({ includeInNetWorth: e.target.checked })}
        />
        {t('form.includeInNetWorth')}
      </label>
      {!editing ? (
        <fieldset style={{ ...rowStyle, border: '1px solid #d0d7de', padding: '0.5rem' }}>
          <legend>{t('form.openingTitle')}</legend>
          <Field
            label={t('form.openingAmount', { currency: s.currency })}
            hint={liability ? t('form.openingLiabilityHint') : t('form.openingHint')}
            error={errors.openingAmount}
          >
            {(p) => (
              <input
                {...p}
                name="openingAmount"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.openingAmount}
                onChange={(e) => set({ openingAmount: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.openingDate')} error={errors.openingDate}>
            {(p) => (
              <input
                {...p}
                type="date"
                name="openingDate"
                style={inputStyle}
                value={s.openingDate}
                onChange={(e) => set({ openingDate: e.target.value })}
              />
            )}
          </Field>
        </fieldset>
      ) : null}
      <div style={rowStyle}>
        {s.type === 'CRYPTO_WALLET' ? (
          <Field label={t('form.cryptoNetwork')}>
            {(p) => (
              <input
                {...p}
                name="cryptoNetwork"
                maxLength={20}
                style={inputStyle}
                value={s.cryptoNetwork}
                onChange={(e) => set({ cryptoNetwork: e.target.value })}
              />
            )}
          </Field>
        ) : null}
        <Field label={t('form.color')}>
          {(p) => (
            <input
              {...p}
              name="color"
              maxLength={20}
              style={inputStyle}
              value={s.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('form.notes')}>
          {(p) => (
            <input
              {...p}
              name="notes"
              maxLength={2000}
              style={inputStyle}
              value={s.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </Field>
      </div>
      <p style={mutedStyle}>{liability ? t('form.liabilityNote') : t('form.assetNote')}</p>
      <div style={rowStyle}>
        <button type="submit" disabled={busy}>
          {busy ? t('form.saving') : editing ? t('form.save') : t('form.create')}
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
