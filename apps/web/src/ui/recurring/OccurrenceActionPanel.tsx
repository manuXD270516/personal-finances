'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import type { Page, Transaction } from '../common/types';
import { ConfirmPanel, Field, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { formatExpected } from './Badges';
import {
  buildEditBody,
  buildMaterializeBody,
  currencyOfAmount,
  editDefaults,
  linkCandidates,
  linkMismatchReasons,
  linkSearchQuery,
  materializeDefaults,
  notifyRecurringChanged,
  type EditOccurrenceForm,
  type FormErrors,
  type MaterializeForm,
  type OccurrenceAction,
} from './logic';
import type { RecurringOccurrence } from './types';

interface PanelProps {
  ctx: WorkspaceContext;
  f: FormatContext;
  occurrence: RecurringOccurrence;
  /** Moneda de una cuenta (el monto de una ocurrencia `VARIABLE` no la trae). */
  currencyOf: (accountId: string) => string | undefined;
  today: string;
  onDone: (updated: RecurringOccurrence | undefined, message: string) => void;
  onCancel: () => void;
}

/** Texto de un código de error de campo del formulario (`errors.<code>` del namespace Recurring). */
const fieldError = (f: FormatContext, errors: FormErrors, field: string): string | undefined => {
  const code = errors[field];
  return code ? f.t(`errors.${code}`) : undefined;
};

/**
 * Panel de una acción sobre una ocurrencia (Aprobar, Vincular, Omitir, Editar), como región `alertdialog` con el foco al
 * abrirse y Escape para cancelar (`ConfirmPanel`). La API valida todo (la UI solo ayuda); los errores se muestran por `code`.
 */
export function OccurrenceActionPanel(props: PanelProps & { action: OccurrenceAction }) {
  switch (props.action) {
    case 'approve':
      return <ApprovePanel {...props} />;
    case 'link':
      return <LinkPanel {...props} />;
    case 'skip':
      return <SkipPanel {...props} />;
    case 'edit':
      return <EditPanel {...props} />;
  }
}

function usePending(ctx: WorkspaceContext) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  return { ctx, busy, setBusy, problem, setProblem };
}

function ApprovePanel({ ctx, f, occurrence, currencyOf, today, onDone, onCancel }: PanelProps) {
  const [form, setForm] = useState<MaterializeForm>(() => materializeDefaults(occurrence, today));
  const [errors, setErrors] = useState<FormErrors>({});
  const { busy, setBusy, problem, setProblem } = usePending(ctx);
  const currency = currencyOf(occurrence.accountId) ?? currencyOfAmount(occurrence.expected) ?? 'BOB';
  const e = occurrence.expected;
  const hint =
    e.type === 'VARIABLE'
      ? f.t('approve.hintVariable')
      : e.type === 'MIN_MAX'
        ? f.t('approve.hintRange', { range: formatExpected(e, f) })
        : f.t('approve.hintExpected', { expected: formatExpected(e, f) });

  async function submit() {
    const built = buildMaterializeBody(occurrence, form, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
      currency,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<{ occurrence: RecurringOccurrence; transactionId: string }>(
        'POST',
        `${ctx.base}/recurring/occurrences/${occurrence.id}/materialize`,
        built.body,
      );
      notifyRecurringChanged();
      onDone(r.data?.occurrence, f.t('approve.done', { name: occurrence.definitionName }));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmPanel
      testId="approve-panel"
      title={f.t('approve.title', {
        name: occurrence.definitionName,
        date: formatBusinessDate(occurrence.dueDate),
      })}
      description={f.t('approve.description')}
      confirmLabel={busy ? f.t('approve.busy') : f.t('approve.confirm')}
      cancelLabel={f.t('cancel')}
      busy={busy}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <div style={rowStyle}>
        <Field
          label={f.t('approve.amount', { currency })}
          hint={hint}
          error={fieldError(f, errors, 'amount')}
        >
          {(p) => (
            <input
              {...p}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              style={inputStyle}
              value={form.amount}
              onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('approve.date')} error={fieldError(f, errors, 'date')}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="businessDate"
              style={inputStyle}
              value={form.date}
              onChange={(ev) => setForm({ ...form, date: ev.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('approve.status')}>
          {(p) => (
            <select
              {...p}
              name="status"
              style={inputStyle}
              value={form.status}
              onChange={(ev) => setForm({ ...form, status: ev.target.value as MaterializeForm['status'] })}
            >
              <option value="POSTED">{f.t('approve.statusPosted')}</option>
              <option value="PENDING">{f.t('approve.statusPending')}</option>
            </select>
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </ConfirmPanel>
  );
}

function SkipPanel({ ctx, f, occurrence, onDone, onCancel }: PanelProps) {
  const [reason, setReason] = useState('');
  const { busy, setBusy, problem, setProblem } = usePending(ctx);

  async function submit() {
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<RecurringOccurrence>(
        'POST',
        `${ctx.base}/recurring/occurrences/${occurrence.id}/skip`,
        { reason: reason.trim() || null },
      );
      notifyRecurringChanged();
      onDone(r.data, f.t('skip.done', { name: occurrence.definitionName }));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmPanel
      testId="skip-panel"
      title={f.t('skip.title', {
        name: occurrence.definitionName,
        date: formatBusinessDate(occurrence.dueDate),
      })}
      description={f.t('skip.description')}
      confirmLabel={busy ? f.t('skip.busy') : f.t('skip.confirm')}
      cancelLabel={f.t('cancel')}
      busy={busy}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <Field label={f.t('skip.reason')}>
        {(p) => (
          <input
            {...p}
            name="reason"
            maxLength={500}
            autoComplete="off"
            style={inputStyle}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
          />
        )}
      </Field>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </ConfirmPanel>
  );
}

function EditPanel({ ctx, f, occurrence, currencyOf, onDone, onCancel }: PanelProps) {
  const [form, setForm] = useState<EditOccurrenceForm>(() => editDefaults(occurrence));
  const [errors, setErrors] = useState<FormErrors>({});
  const { busy, setBusy, problem, setProblem } = usePending(ctx);
  const currency = currencyOf(occurrence.accountId) ?? currencyOfAmount(occurrence.expected) ?? 'BOB';
  const range = occurrence.expected.type === 'MIN_MAX';

  async function submit() {
    const built = buildEditBody(occurrence, form, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
      currency,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<RecurringOccurrence>(
        'PATCH',
        `${ctx.base}/recurring/occurrences/${occurrence.id}`,
        built.body,
        { ifMatch: occurrence.version },
      );
      notifyRecurringChanged();
      onDone(r.data, f.t('edit.done', { name: occurrence.definitionName }));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const amountField = (key: 'amount' | 'min' | 'max', label: string) => (
    <Field label={label} error={fieldError(f, errors, key)} key={key}>
      {(p) => (
        <input
          {...p}
          name={key}
          inputMode="decimal"
          autoComplete="off"
          style={inputStyle}
          value={form[key]}
          onChange={(ev) => setForm({ ...form, [key]: ev.target.value })}
        />
      )}
    </Field>
  );

  return (
    <ConfirmPanel
      testId="edit-panel"
      title={f.t('edit.title', {
        name: occurrence.definitionName,
        date: formatBusinessDate(occurrence.dueDate),
      })}
      description={f.t('edit.description')}
      confirmLabel={busy ? f.t('edit.busy') : f.t('edit.confirm')}
      cancelLabel={f.t('cancel')}
      busy={busy}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <div style={rowStyle}>
        {range ? (
          <>
            {amountField('min', f.t('edit.min', { currency }))}
            {amountField('max', f.t('edit.max', { currency }))}
          </>
        ) : (
          amountField('amount', f.t('edit.amount', { currency }))
        )}
        <Field label={f.t('edit.dueDate')} error={fieldError(f, errors, 'dueDate')}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="dueDate"
              style={inputStyle}
              value={form.dueDate}
              onChange={(ev) => setForm({ ...form, dueDate: ev.target.value })}
            />
          )}
        </Field>
      </div>
      {errors['form'] ? (
        <p role="alert" style={{ margin: 0 }}>
          {f.t(`errors.${errors['form']}`)}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </ConfirmPanel>
  );
}

function LinkPanel({ ctx, f, occurrence, onDone, onCancel }: PanelProps) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly Transaction[] | undefined>();
  const [selected, setSelected] = useState('');
  const { busy, setBusy, problem, setProblem } = usePending(ctx);
  const [searchProblem, setSearchProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    setFound(undefined);
    ctx.api
      .get<Page<Transaction>>(`${ctx.base}/transactions?${linkSearchQuery(occurrence, query).toString()}`)
      .then((r) => {
        if (cancelled) return;
        setFound(linkCandidates(occurrence, r.data?.data ?? []));
        setSearchProblem(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFound([]);
        setSearchProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, occurrence, query]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<RecurringOccurrence>(
        'POST',
        `${ctx.base}/recurring/occurrences/${occurrence.id}/link`,
        { transactionId: selected },
      );
      notifyRecurringChanged();
      onDone(r.data, f.t('link.done', { name: occurrence.definitionName }));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const reasons = problem?.code === 'OCCURRENCE_LINK_MISMATCH' ? linkMismatchReasons(problem) : [];
  return (
    <ConfirmPanel
      testId="link-panel"
      title={f.t('link.title', {
        name: occurrence.definitionName,
        date: formatBusinessDate(occurrence.dueDate),
      })}
      description={f.t('link.description')}
      confirmLabel={busy ? f.t('link.busy') : f.t('link.confirm')}
      cancelLabel={f.t('cancel')}
      busy={busy}
      confirmDisabled={!selected}
      onConfirm={() => void submit()}
      onCancel={onCancel}
    >
      <div style={rowStyle}>
        <Field label={f.t('link.search')}>
          {(p) => (
            <input
              {...p}
              type="search"
              name="q"
              autoComplete="off"
              style={inputStyle}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  setQuery(text);
                }
              }}
            />
          )}
        </Field>
        <button type="button" onClick={() => setQuery(text)}>
          {f.t('link.searchButton')}
        </button>
      </div>
      <p style={mutedStyle}>
        {f.t('link.filters', {
          from: formatBusinessDate(linkSearchQuery(occurrence).get('dateFrom') ?? occurrence.dueDate),
          to: formatBusinessDate(linkSearchQuery(occurrence).get('dateTo') ?? occurrence.dueDate),
        })}
      </p>
      {searchProblem ? <ProblemMessage problem={searchProblem} locale={ctx.uiLocale} /> : null}
      {found === undefined ? (
        <p aria-busy="true">{f.t('link.searching')}</p>
      ) : found.length === 0 ? (
        <p data-testid="link-empty">{f.t('link.empty')}</p>
      ) : (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} data-testid="link-results">
          <legend>{f.t('link.results')}</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-1)' }}>
            {found.map((tx) => (
              <li key={tx.id}>
                <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="transactionId"
                    value={tx.id}
                    checked={selected === tx.id}
                    onChange={() => setSelected(tx.id)}
                  />
                  <span>
                    {formatBusinessDate(tx.transactionDate)} · {tx.description || f.t(`kinds.${tx.kind}`)} ·{' '}
                    {formatMoney(tx.amount, f.locale)} · {f.t(`txStatus.${tx.status}`)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {problem ? (
        <>
          <ProblemMessage problem={problem} locale={ctx.uiLocale} />
          {reasons.length > 0 ? (
            <ul data-testid="link-reasons" style={{ margin: 0 }}>
              {reasons.map((r) => (
                <li key={r}>{f.has(`link.reasons.${r}`) ? f.t(`link.reasons.${r}`) : r}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </ConfirmPanel>
  );
}
