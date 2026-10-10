'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { PAYMENT_METHODS } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { categoryOptions, type Catalogs } from '../transactions/catalogs';
import {
  allowsAutoCreate,
  buildCreateBody,
  buildRevisionBody,
  CADENCES_WITH_MONTH_DAY,
  notifyRecurringChanged,
  previewOf,
  type DefinitionForm as FormState,
  type FormErrors,
} from './logic';
import { SchedulePreview } from './SchedulePreview';
import {
  AMOUNT_TYPES,
  CADENCES,
  MATERIALIZATION_MODES,
  OFFERED_KINDS,
  WEEKEND_ADJUSTMENTS,
  type RecurringDefinition,
  type RecurringRevisionResult,
} from './types';

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/**
 * Formulario de definición. `create`: alta (`POST /recurring`, `Idempotency-Key` del intento). `revise`: "Cambiar esta y las
 * siguientes" (`POST …/revisions`, solo lo que cambió, desde una fecha efectiva): el tipo no cambia y la fecha de inicio
 * es la de la definición. La vista previa de las próximas 6 fechas y el aviso de fin de mes se calculan en el cliente.
 */
export function DefinitionFormView({
  ctx,
  f,
  catalogs,
  today,
  mode,
  initial,
  definition,
  defaultEffectiveFrom,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  today: string;
  mode: 'create' | 'revise';
  initial: FormState;
  /** Solo en `revise`: la definición que se cambia. */
  definition?: RecurringDefinition;
  defaultEffectiveFrom?: string;
  onSaved: (saved: { definition: RecurringDefinition; revision?: RecurringRevisionResult }) => void;
  onCancel: () => void;
}) {
  const revising = mode === 'revise';
  const [s, setS] = useState<FormState>(initial);
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom ?? today);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);
  const set = (patch: Partial<FormState>) => setS((prev) => ({ ...prev, ...patch }));

  const account = catalogs.accounts.find((a) => a.id === s.accountId);
  const toAccount = catalogs.accounts.find((a) => a.id === s.toAccountId);
  const currency = account?.currency;
  const scale = scaleFor(currency ?? 'BOB', ctx.scales);
  const env = { locale: ctx.formatLocale, currency, scale, toCurrency: toAccount?.currency };
  const transfer = s.kind === 'TRANSFER';

  const accountOptions = catalogs.accounts.filter((a) => a.status === 'ACTIVE' || a.id === s.accountId);
  const toOptions = catalogs.accounts.filter(
    (a) =>
      (a.status === 'ACTIVE' || a.id === s.toAccountId) &&
      a.id !== s.accountId &&
      (!currency || a.currency === currency),
  );
  const groups = useMemo(
    () => (s.kind === 'TRANSFER' ? [] : categoryOptions(catalogs.categories, catalogs.groups, s.kind)),
    [catalogs.categories, catalogs.groups, s.kind],
  );

  const preview = useMemo(
    () =>
      previewOf(
        s,
        revising && definition
          ? {
              today,
              // Una cadencia, intervalo o día nuevos reinician el ancla en la fecha efectiva (RecurringSchedulePatch).
              dtstart:
                s.cadence !== initial.cadence ||
                s.interval !== initial.interval ||
                s.monthDay !== initial.monthDay ||
                s.monthDay2 !== initial.monthDay2 ||
                s.rrule !== initial.rrule
                  ? effectiveFrom
                  : s.startDate,
              from: effectiveFrom,
            }
          : { today },
      ),
    [s, initial, revising, definition, effectiveFrom, today],
  );

  const err = (field: string): string | undefined => {
    const code = errors[field];
    return code ? f.t(`errors.${code}`) : undefined;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setProblem(undefined);
    const built = revising ? buildRevisionBody(initial, s, effectiveFrom, env) : buildCreateBody(s, env);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      if (revising && definition) {
        const r = await ctx.api.command<RecurringRevisionResult>(
          'POST',
          `${ctx.base}/recurring/${definition.id}/revisions`,
          built.body,
          { ifMatch: definition.version, idempotencyKey: attemptKey.current },
        );
        attemptKey.current = uuidv7();
        notifyRecurringChanged();
        if (r.data) onSaved({ definition: r.data.definition, revision: r.data });
      } else {
        const r = await ctx.api.command<RecurringDefinition>('POST', `${ctx.base}/recurring`, built.body, {
          idempotencyKey: attemptKey.current,
        });
        attemptKey.current = uuidv7();
        notifyRecurringChanged();
        if (r.data) onSaved({ definition: r.data });
      }
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const monthDaySelect = (field: 'monthDay' | 'monthDay2', label: string, opts: { blank: string | null }) => (
    <Field label={label} error={field === 'monthDay' ? err('monthDay') : undefined}>
      {(p) => (
        <select
          {...p}
          name={field}
          style={inputStyle}
          value={s[field]}
          onChange={(ev) => set({ [field]: ev.target.value })}
        >
          {opts.blank !== null ? (
            <option value="">{opts.blank}</option>
          ) : (
            <option value="">{f.t('form.chooseDay')}</option>
          )}
          {MONTH_DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="-1">{f.t('form.lastDay')}</option>
        </select>
      )}
    </Field>
  );

  const title = revising ? f.t('form.reviseTitle') : f.t('form.createTitle');
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="definition-form-title"
      style={formStyle}
      data-testid="definition-form"
      noValidate
    >
      <h2 id="definition-form-title" style={{ margin: 0 }}>
        {title}
      </h2>
      {revising ? <p style={mutedStyle}>{f.t('form.reviseNote')}</p> : null}

      {revising ? (
        <Field
          label={f.t('form.effectiveFrom')}
          hint={f.t('form.effectiveFromHint')}
          error={err('effectiveFrom')}
        >
          {(p) => (
            <input
              {...p}
              type="date"
              name="effectiveFrom"
              style={inputStyle}
              value={effectiveFrom}
              onChange={(ev) => setEffectiveFrom(ev.target.value)}
            />
          )}
        </Field>
      ) : (
        <>
          <div style={rowStyle}>
            <Field label={f.t('form.name')} error={err('name')}>
              {(p) => (
                <input
                  {...p}
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="off"
                  style={inputStyle}
                  value={s.name}
                  onChange={(ev) => set({ name: ev.target.value })}
                />
              )}
            </Field>
            <Field label={f.t('form.description')}>
              {(p) => (
                <input
                  {...p}
                  name="description"
                  maxLength={1000}
                  autoComplete="off"
                  style={inputStyle}
                  value={s.description}
                  onChange={(ev) => set({ description: ev.target.value })}
                />
              )}
            </Field>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{f.t('form.kind')}</legend>
            <div role="radiogroup" aria-label={f.t('form.kind')} style={rowStyle}>
              {OFFERED_KINDS.map((k) => (
                <label key={k} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={s.kind === k}
                    onChange={() => set({ kind: k, categoryId: '', toAccountId: '', counterpartyId: '' })}
                  />
                  {f.t(`kinds.${k}`)}
                </label>
              ))}
            </div>
            <small style={mutedStyle}>{f.t('form.kindHint')}</small>
          </fieldset>
        </>
      )}

      <div style={rowStyle}>
        <Field label={transfer ? f.t('form.fromAccount') : f.t('form.account')} error={err('accountId')}>
          {(p) => (
            <select
              {...p}
              name="accountId"
              style={inputStyle}
              value={s.accountId}
              onChange={(ev) => set({ accountId: ev.target.value, toAccountId: '' })}
            >
              <option value="">{f.t('form.chooseAccount')}</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
        {transfer ? (
          <Field label={f.t('form.toAccount')} error={err('toAccountId')}>
            {(p) => (
              <select
                {...p}
                name="toAccountId"
                style={inputStyle}
                value={s.toAccountId}
                onChange={(ev) => set({ toAccountId: ev.target.value })}
              >
                <option value="">{f.t('form.chooseAccount')}</option>
                {toOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {!transfer ? (
          <Field label={f.t('form.category')}>
            {(p) => (
              <select
                {...p}
                name="categoryId"
                style={inputStyle}
                value={s.categoryId}
                onChange={(ev) => set({ categoryId: ev.target.value })}
              >
                <option value="">{f.t('form.noCategory')}</option>
                {groups.map((g) => (
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
        ) : null}
        {!transfer ? (
          <Field label={f.t('form.counterparty')}>
            {(p) => (
              <select
                {...p}
                name="counterpartyId"
                style={inputStyle}
                value={s.counterpartyId}
                onChange={(ev) => set({ counterpartyId: ev.target.value })}
              >
                <option value="">{f.t('form.noCounterparty')}</option>
                {catalogs.counterparties
                  .filter((c) => !c.archivedAt || c.id === s.counterpartyId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label={f.t('form.paymentMethod')}>
          {(p) => (
            <select
              {...p}
              name="paymentMethod"
              style={inputStyle}
              value={s.paymentMethod}
              onChange={(ev) => set({ paymentMethod: ev.target.value as FormState['paymentMethod'] })}
            >
              <option value="">{f.t('form.noPaymentMethod')}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {f.t(`paymentMethods.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {catalogs.tags.filter((t) => !t.archivedAt || s.tagIds.includes(t.id)).length > 0 ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{f.t('form.tags')}</legend>
          <div style={rowStyle}>
            {catalogs.tags
              .filter((t) => !t.archivedAt || s.tagIds.includes(t.id))
              .map((t) => (
                <label key={t.id} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    name="tagIds"
                    value={t.id}
                    checked={s.tagIds.includes(t.id)}
                    onChange={(ev) =>
                      set({
                        tagIds: ev.target.checked ? [...s.tagIds, t.id] : s.tagIds.filter((x) => x !== t.id),
                      })
                    }
                  />
                  {t.name}
                </label>
              ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.amountLegend')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.amountType')}>
            {(p) => (
              <select
                {...p}
                name="amountType"
                style={inputStyle}
                value={s.amountType}
                onChange={(ev) => {
                  const amountType = ev.target.value as FormState['amountType'];
                  set({
                    amountType,
                    ...(s.mode === 'AUTO_CREATE' && !allowsAutoCreate(amountType)
                      ? { mode: 'PENDING_APPROVAL' as const }
                      : {}),
                  });
                }}
              >
                {AMOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {f.t(`amountTypes.${t}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {s.amountType === 'MIN_MAX' ? (
            <>
              <Field label={f.t('form.min', { currency: currency ?? '' })} error={err('min')}>
                {(p) => (
                  <input
                    {...p}
                    name="min"
                    inputMode="decimal"
                    autoComplete="off"
                    style={inputStyle}
                    value={s.min}
                    onChange={(ev) => set({ min: ev.target.value })}
                  />
                )}
              </Field>
              <Field label={f.t('form.max', { currency: currency ?? '' })} error={err('max')}>
                {(p) => (
                  <input
                    {...p}
                    name="max"
                    inputMode="decimal"
                    autoComplete="off"
                    style={inputStyle}
                    value={s.max}
                    onChange={(ev) => set({ max: ev.target.value })}
                  />
                )}
              </Field>
            </>
          ) : s.amountType === 'VARIABLE' ? null : (
            <Field label={f.t('form.amount', { currency: currency ?? '' })} error={err('amount')}>
              {(p) => (
                <input
                  {...p}
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  style={inputStyle}
                  value={s.amount}
                  onChange={(ev) => set({ amount: ev.target.value })}
                />
              )}
            </Field>
          )}
        </div>
        <small style={mutedStyle}>{f.t(`form.amountHint.${s.amountType}`)}</small>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.scheduleLegend')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.cadence')}>
            {(p) => (
              <select
                {...p}
                name="cadence"
                style={inputStyle}
                value={s.cadence}
                onChange={(ev) =>
                  set({ cadence: ev.target.value as FormState['cadence'], monthDay: '', monthDay2: '' })
                }
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {f.t(`cadences.${c}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {s.cadence !== 'CUSTOM' ? (
            <Field label={f.t('form.interval')} hint={f.t('form.intervalHint')} error={err('interval')}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  name="interval"
                  min={1}
                  max={120}
                  inputMode="numeric"
                  style={inputStyle}
                  value={s.interval}
                  onChange={(ev) => set({ interval: ev.target.value })}
                />
              )}
            </Field>
          ) : null}
          {s.cadence === 'SEMIMONTHLY' ? (
            <>
              {monthDaySelect('monthDay', f.t('form.firstDay'), { blank: null })}
              {monthDaySelect('monthDay2', f.t('form.secondDay'), { blank: null })}
            </>
          ) : CADENCES_WITH_MONTH_DAY.includes(s.cadence) ? (
            monthDaySelect('monthDay', f.t('form.monthDay'), { blank: f.t('form.sameAsStart') })
          ) : null}
          <Field label={f.t('form.weekendAdjustment')}>
            {(p) => (
              <select
                {...p}
                name="weekendAdjustment"
                style={inputStyle}
                value={s.weekendAdjustment}
                onChange={(ev) =>
                  set({ weekendAdjustment: ev.target.value as FormState['weekendAdjustment'] })
                }
              >
                {WEEKEND_ADJUSTMENTS.map((w) => (
                  <option key={w} value={w}>
                    {f.t(`weekend.${w}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {s.cadence === 'CUSTOM' ? (
          <Field label={f.t('form.rrule')} hint={f.t('form.rruleHint')} error={err('rrule')}>
            {(p) => (
              <input
                {...p}
                name="rrule"
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
                style={{ ...inputStyle, fontFamily: 'var(--pf-font-mono)' }}
                value={s.rrule}
                placeholder="FREQ=MONTHLY;BYDAY=1MO"
                onChange={(ev) => set({ rrule: ev.target.value })}
              />
            )}
          </Field>
        ) : null}
        {errors['schedule'] ? (
          <p role="alert" style={{ margin: 0, color: 'var(--pf-error)' }}>
            {f.t(`errors.${errors['schedule']}`)}
          </p>
        ) : null}
        <div style={rowStyle}>
          {!revising ? (
            <Field label={f.t('form.startDate')} error={err('startDate')}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  name="startDate"
                  style={inputStyle}
                  value={s.startDate}
                  onChange={(ev) => set({ startDate: ev.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field label={f.t('form.endMode')}>
            {(p) => (
              <select
                {...p}
                name="endMode"
                style={inputStyle}
                value={s.endMode}
                onChange={(ev) => set({ endMode: ev.target.value as FormState['endMode'] })}
              >
                <option value="NONE">{f.t('form.endNone')}</option>
                <option value="DATE">{f.t('form.endDateOption')}</option>
                <option value="COUNT">{f.t('form.endCountOption')}</option>
              </select>
            )}
          </Field>
          {s.endMode === 'DATE' ? (
            <Field label={f.t('form.endDate')} error={err('endDate')}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  name="endDate"
                  style={inputStyle}
                  value={s.endDate}
                  onChange={(ev) => set({ endDate: ev.target.value })}
                />
              )}
            </Field>
          ) : null}
          {s.endMode === 'COUNT' ? (
            <Field label={f.t('form.maxOccurrences')} error={err('maxOccurrences')}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  name="maxOccurrences"
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  style={inputStyle}
                  value={s.maxOccurrences}
                  onChange={(ev) => set({ maxOccurrences: ev.target.value })}
                />
              )}
            </Field>
          ) : null}
        </div>
      </fieldset>

      <SchedulePreview preview={preview} f={f} />

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.modeLegend')}</legend>
        <div
          role="radiogroup"
          aria-label={f.t('form.modeLegend')}
          style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
        >
          {MATERIALIZATION_MODES.map((m) => {
            const disabled = m === 'AUTO_CREATE' && !allowsAutoCreate(s.amountType);
            return (
              <label key={m} style={{ display: 'flex', gap: '0.5rem', alignItems: 'start' }}>
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={s.mode === m}
                  disabled={disabled}
                  onChange={() => set({ mode: m })}
                />
                <span>
                  {f.t(`modes.${m}`)}
                  <small style={{ ...mutedStyle, display: 'block' }}>
                    {f.t(`form.modeHint.${m}`)}
                    {disabled ? ` ${f.t('form.autoNeedsAmount')}` : ''}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
        <div style={rowStyle}>
          {s.mode === 'AUTO_CREATE' ? (
            <Field label={f.t('form.autoCreateStatus')}>
              {(p) => (
                <select
                  {...p}
                  name="autoCreateStatus"
                  style={inputStyle}
                  value={s.autoCreateStatus}
                  onChange={(ev) =>
                    set({ autoCreateStatus: ev.target.value as FormState['autoCreateStatus'] })
                  }
                >
                  <option value="PENDING">{f.t('form.statusPending')}</option>
                  <option value="POSTED">{f.t('form.statusPosted')}</option>
                </select>
              )}
            </Field>
          ) : null}
          <Field label={f.t('form.leadDays')} hint={f.t('form.leadDaysHint')} error={err('leadDays')}>
            {(p) => (
              <input
                {...p}
                type="number"
                name="leadDays"
                min={0}
                max={60}
                inputMode="numeric"
                style={inputStyle}
                value={s.leadDays}
                onChange={(ev) => set({ leadDays: ev.target.value })}
              />
            )}
          </Field>
        </div>
        {errors['mode'] ? (
          <p role="alert" style={{ margin: 0, color: 'var(--pf-error)' }}>
            {f.t(`errors.${errors['mode']}`)}
          </p>
        ) : null}
      </fieldset>

      {errors['form'] ? (
        <p role="alert" style={{ margin: 0, color: 'var(--pf-error)' }} data-testid="form-error">
          {f.t(`errors.${errors['form']}`)}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="definition-submit">
          {busy ? f.t('form.saving') : revising ? f.t('form.reviseSubmit') : f.t('form.create')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}
