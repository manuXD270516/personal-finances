'use client';

import { useCallback, useState } from 'react';
import { type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import {
  cardStyle,
  cellStyle,
  Field,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { formatDecimal } from '../AuditHistory';
import { formatMoney, formatSignedMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { targetName, type TargetNames } from './BudgetLinesTable';
import { formatBusinessDate } from './logic';
import {
  ROUNDING_INCREMENTS,
  confirmBody,
  defaultParams,
  diffTone,
  isApplicable,
  lineKey,
  parseEdited,
  periodAction,
  requestBody,
  validateParams,
  withOverride,
  type Overrides,
  type SuggestionExplanation,
  type SuggestionLine,
  type SuggestionMethod,
  type SuggestionParams,
  type SuggestionPreview,
} from './suggestion-logic';

const STATUS_ICON: Record<string, string> = {
  OK: '✓',
  INSUFFICIENT_HISTORY: '⚠',
  NOT_APPLICABLE: '–',
};
const PERIOD_ICON: Record<string, string> = {
  USED: '✓',
  OUTLIER: '▲',
  INCOMPLETE: '◐',
  BEFORE_FIRST_ACTIVITY: '○',
  NO_RATE: '⚠',
  IN_PROGRESS: '…',
  USER_EXCLUDED: '✕',
};

/**
 * Explicación de una sugerencia (openspec add-historical-budgets 6.2): se arma SOLO desde códigos, montos y fechas del
 * servidor (es/en/pt); lista cada periodo con su real y su estado (texto + icono), si está cerrado, los valores usados,
 * el promedio, la mediana, el ajuste y el redondeo. Con `onPeriod`, permite excluir o reincluir periodos.
 */
export function ExplanationView({
  line,
  explanation,
  f,
  onPeriod,
}: {
  line: Pick<SuggestionLine, 'targetName' | 'currentAmount' | 'difference' | 'target'>;
  explanation: SuggestionExplanation;
  f: FormatContext;
  onPeriod?: ((periodId: string, action: 'exclude' | 'include' | 'clear') => void) | undefined;
}) {
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, f.locale);
  const code = explanation.suggested?.currency ?? line.currentAmount?.currency ?? 'BOB';
  const plain = (value: string | null | undefined) =>
    value === null || value === undefined ? '—' : formatMoney({ amount: value, currency: code }, f.locale);
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="suggestion-explanation">
      <p style={{ margin: 0 }}>
        {explanation.method === 'AVERAGE'
          ? f.t('explanation.method.AVERAGE', { n: explanation.periodsRequested })
          : f.t('explanation.method.SAME_PERIOD_LAST_YEAR')}{' '}
        <small style={mutedStyle}>{f.t('explanation.todayCategories')}</small>
      </p>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <caption style={{ ...mutedStyle, textAlign: 'left' }}>
            {f.t('explanation.periodsCaption', { name: line.targetName })}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('explanation.columns.period')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('explanation.columns.range')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('explanation.columns.actual')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('explanation.columns.status')}
              </th>
              {onPeriod ? (
                <th scope="col" style={cellStyle}>
                  {f.t('explanation.columns.action')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {explanation.periods.map((p) => {
              const action = periodAction(p);
              return (
                <tr key={p.label} data-testid="explanation-period" data-status={p.status}>
                  <th scope="row" style={cellStyle}>
                    {p.label}
                    <br />
                    <small style={mutedStyle}>
                      {p.closed ? f.t('explanation.closed') : f.t('explanation.notClosed')}
                    </small>
                  </th>
                  <td style={cellStyle}>
                    {f.t('explanation.range', {
                      start: formatBusinessDate(p.start),
                      end: formatBusinessDate(p.end),
                    })}
                  </td>
                  <td style={numCellStyle}>{p.actual ? money(p.actual) : '—'}</td>
                  <td style={cellStyle}>
                    <span aria-hidden="true">{PERIOD_ICON[p.status] ?? '•'}</span>{' '}
                    {f.has(`explanation.status.${p.status}`)
                      ? f.t(`explanation.status.${p.status}`)
                      : p.status}
                  </td>
                  {onPeriod ? (
                    <td style={cellStyle}>
                      {action && p.periodId ? (
                        <button
                          type="button"
                          onClick={() => onPeriod(p.periodId as string, action)}
                          aria-label={f.t(`explanation.action.${action}Label`, {
                            period: p.label,
                            name: line.targetName,
                          })}
                          data-testid={`period-${action}`}
                        >
                          {f.t(`explanation.action.${action}`)}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul style={{ margin: 0, paddingLeft: 'var(--pf-space-4)' }}>
        <li>{f.t('explanation.used', { used: explanation.usedCount, min: explanation.minValid })}</li>
        <li>
          {explanation.outlierRule === 'TUKEY_1_5_IQR'
            ? f.t('explanation.rule.TUKEY_1_5_IQR', { q1: plain(explanation.q1), q3: plain(explanation.q3) })
            : f.t('explanation.rule.NONE_SMALL_SAMPLE')}
        </li>
        {explanation.mean !== null ? (
          <li>
            {f.t('explanation.mean', { value: plain(explanation.mean) })}
            {' · '}
            {f.t('explanation.median', { value: plain(explanation.median) })}
          </li>
        ) : null}
        <li>
          {f.t('explanation.adjustment', {
            percent: formatDecimal(explanation.adjustmentPercent, f.locale),
          })}
          {' · '}
          {explanation.roundingIncrement === null
            ? f.t('explanation.noRounding')
            : f.t('explanation.rounding', { value: explanation.roundingIncrement })}
        </li>
        {explanation.suggested ? (
          <li>
            <strong>{f.t('explanation.suggested', { value: money(explanation.suggested) })}</strong>
          </li>
        ) : null}
        {line.currentAmount ? (
          <li>
            {f.t('explanation.current', { value: money(line.currentAmount) })}
            {line.difference ? (
              <>
                {' · '}
                {f.t('explanation.difference', { value: formatSignedMoney(line.difference, f.locale) })}
              </>
            ) : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * Tabla de la vista previa: monto vigente, sugerido (editable cuando la línea se elige), diferencia y estado (texto +
 * icono, nunca solo color), con la explicación desplegable. Presentacional: el estado vive en `SuggestionsPanel`.
 */
export function SuggestionsTable({
  preview,
  names,
  f,
  canConfirm,
  picked,
  amounts,
  invalid,
  onPick,
  onAmount,
  onPeriod,
}: {
  preview: SuggestionPreview;
  names: TargetNames;
  f: FormatContext;
  canConfirm: boolean;
  picked: ReadonlySet<string>;
  amounts: Readonly<Record<string, string>>;
  invalid: ReadonlySet<string>;
  onPick?: ((key: string, checked: boolean) => void) | undefined;
  onAmount?: ((key: string, value: string) => void) | undefined;
  onPeriod?: ((key: string, periodId: string, action: 'exclude' | 'include' | 'clear') => void) | undefined;
}) {
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, f.locale);
  if (preview.lines.length === 0) {
    return (
      <p style={mutedStyle} data-testid="suggestions-empty">
        {f.t('table.empty')}
      </p>
    );
  }
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="suggestions-table">
        <caption style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}>
          {f.t('table.caption')}
        </caption>
        <thead>
          <tr>
            {canConfirm ? (
              <th scope="col" style={cellStyle}>
                {f.t('table.columns.choose')}
              </th>
            ) : null}
            <th scope="col" style={cellStyle}>
              {f.t('table.columns.target')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('table.columns.current')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('table.columns.suggested')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('table.columns.difference')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('table.columns.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((line) => {
            const key = lineKey(line.target);
            const name = targetName(names, line.target.kind, line.target.id) || line.targetName;
            const applicable = isApplicable(line);
            const tone = diffTone(line);
            return (
              <tr
                key={key}
                data-testid="suggestion-line"
                data-target-id={line.target.id}
                data-status={line.status}
              >
                {canConfirm ? (
                  <td style={cellStyle}>
                    {applicable ? (
                      <input
                        type="checkbox"
                        checked={picked.has(key)}
                        onChange={(e) => onPick?.(key, e.target.checked)}
                        aria-label={f.t('table.chooseLabel', { name })}
                        data-testid="suggestion-pick"
                      />
                    ) : null}
                  </td>
                ) : null}
                <th scope="row" style={{ ...cellStyle, fontWeight: 600 }}>
                  {name}
                  <br />
                  <small style={{ ...mutedStyle, fontWeight: 400 }}>
                    {f.t(`kind.${line.kind}`)}
                    {line.existingLineId === null ? ` · ${f.t('table.newLine')}` : ''}
                  </small>
                  {line.explanation ? (
                    <details style={{ marginTop: 'var(--pf-space-1)', fontWeight: 400 }}>
                      <summary>{f.t('table.explain')}</summary>
                      <ExplanationView
                        line={{ ...line, targetName: name }}
                        explanation={line.explanation}
                        f={f}
                        onPeriod={
                          canConfirm && onPeriod
                            ? (periodId, action) => onPeriod(key, periodId, action)
                            : undefined
                        }
                      />
                    </details>
                  ) : null}
                </th>
                <td style={numCellStyle}>{line.currentAmount ? money(line.currentAmount) : '—'}</td>
                <td style={numCellStyle}>
                  {applicable && canConfirm && picked.has(key) ? (
                    <Field
                      label={f.t('table.amountLabel', { name })}
                      error={invalid.has(key) ? f.t('table.amountInvalid') : undefined}
                    >
                      {(p) => (
                        <input
                          {...p}
                          style={inputStyle}
                          inputMode="decimal"
                          value={amounts[key] ?? ''}
                          onChange={(e) => onAmount?.(key, e.target.value)}
                          data-testid="suggestion-amount"
                        />
                      )}
                    </Field>
                  ) : line.suggestedAmount ? (
                    money(line.suggestedAmount)
                  ) : (
                    '—'
                  )}
                </td>
                <td style={numCellStyle} data-tone={tone}>
                  {line.difference ? (
                    <>
                      <span aria-hidden="true">{tone === 'UP' ? '▲' : tone === 'DOWN' ? '▼' : '='}</span>{' '}
                      {formatSignedMoney(line.difference, f.locale)}
                      <br />
                      <small style={mutedStyle}>{f.t(`diff.${tone}`)}</small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={cellStyle}>
                  <span aria-hidden="true">{STATUS_ICON[line.status] ?? '•'}</span>{' '}
                  {f.has(`status.${line.status}`) ? f.t(`status.${line.status}`) : line.status}
                  {line.status === 'INSUFFICIENT_HISTORY' && line.explanation ? (
                    <>
                      <br />
                      <small style={mutedStyle}>
                        {f.t('table.insufficient', {
                          used: line.explanation.usedCount,
                          min: line.explanation.minValid,
                        })}
                      </small>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pantalla "Sugerir desde el historial" (openspec add-historical-budgets 6.1-6.3): elige método, N, ajuste y redondeo,
 * pide la vista previa (sin efectos), deja elegir líneas y editar montos y, al confirmar, aplica solo lo elegido. Si el
 * historial o el plan cambiaron (`BUDGET_SUGGESTION_STALE`) ofrece "volver a calcular". Nunca se aplica nada solo.
 */
export function SuggestionsPanel({
  ctx,
  periodId,
  names,
  canConfirm,
  onClose,
}: {
  ctx: WorkspaceContext;
  periodId: string;
  names: TargetNames;
  /** EDITOR u OWNER sobre un periodo abierto: puede elegir y confirmar; un VIEWER solo ve la vista previa. */
  canConfirm: boolean;
  /** `applied` = true cuando se confirmó (la pantalla recarga el plan). */
  onClose: (applied: boolean) => void;
}) {
  const f = useFormat('Suggestions', ctx);
  const [params, setParams] = useState<SuggestionParams>(defaultParams());
  const [paramErrors, setParamErrors] = useState<Partial<Record<'periods' | 'adjustment', 'invalid'>>>({});
  const [overrides, setOverrides] = useState<Overrides>(new Map());
  const [preview, setPreview] = useState<SuggestionPreview | undefined>();
  const [request, setRequest] = useState<unknown>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const compute = useCallback(
    async (nextOverrides: Overrides) => {
      const parsed = validateParams(params, ctx.formatLocale);
      if (!parsed.ok) {
        setParamErrors(parsed.errors);
        return;
      }
      setParamErrors({});
      setBusy(true);
      setProblem(undefined);
      setReviewing(false);
      const body = requestBody(periodId, parsed.body, nextOverrides);
      try {
        const r = await ctx.api.command<SuggestionPreview>(
          'POST',
          `${ctx.base}/budget-suggestions/preview`,
          body,
          { idempotent: false },
        );
        const next = r.data as SuggestionPreview;
        setPreview(next);
        setRequest(body);
        setOverrides(nextOverrides);
        // Nada se elige solo: el EDITOR marca lo que quiere aplicar.
        setPicked(new Set());
        setInvalid(new Set());
        setAmounts(
          Object.fromEntries(next.lines.map((l) => [lineKey(l.target), l.suggestedAmount?.amount ?? ''])),
        );
      } catch (err) {
        setProblem(problemOf(err));
      } finally {
        setBusy(false);
      }
    },
    [ctx, params, periodId],
  );

  const scale = scaleFor(preview?.currency ?? ctx.ws.baseCurrency, ctx.scales);
  const chosen = preview ? preview.lines.filter((l) => picked.has(lineKey(l.target))) : [];

  function resolvePicks() {
    if (!preview) return undefined;
    const bad = new Set<string>();
    const picks = chosen.map((line) => {
      const key = lineKey(line.target);
      const parsed = parseEdited(amounts[key] ?? '', line.suggestedAmount?.amount ?? '0', {
        locale: ctx.formatLocale,
        currency: preview.currency,
        scale,
      });
      if (!parsed.ok) bad.add(key);
      return { line, amount: parsed.ok ? parsed.value : '' };
    });
    setInvalid(bad);
    return bad.size === 0 ? picks : undefined;
  }

  async function confirm() {
    if (!preview) return;
    const picks = resolvePicks();
    if (!picks) {
      setReviewing(false);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/budget-suggestions/confirm`,
        confirmBody(preview, request, picks),
      );
      setDone(true);
    } catch (err) {
      setProblem(problemOf(err));
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  }

  const stale = problem?.code === 'BUDGET_SUGGESTION_STALE';
  const picksForSummary = reviewing && preview ? resolvePicksQuiet() : undefined;
  function resolvePicksQuiet() {
    if (!preview) return undefined;
    return chosen.map((line) => {
      const key = lineKey(line.target);
      const parsed = parseEdited(amounts[key] ?? '', line.suggestedAmount?.amount ?? '0', {
        locale: ctx.formatLocale,
        currency: preview.currency,
        scale,
      });
      return { line, amount: parsed.ok ? parsed.value : (line.suggestedAmount?.amount ?? '') };
    });
  }

  return (
    <section
      aria-labelledby="suggestions-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="suggestions-panel"
    >
      <h3 id="suggestions-title" style={{ margin: 0 }}>
        {f.t('title')}
      </h3>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {!canConfirm ? <p style={mutedStyle}>{f.t('viewerNote')}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {done ? (
        <>
          <p role="status" data-testid="suggestions-done">
            {f.t('confirm.done')}
          </p>
          <div style={rowStyle}>
            <button type="button" onClick={() => onClose(true)} data-testid="suggestions-close">
              {f.t('confirm.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          <form
            style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
            aria-label={f.t('params.title')}
            onSubmit={(e) => {
              e.preventDefault();
              void compute(overrides);
            }}
          >
            <div style={rowStyle}>
              <Field label={f.t('params.method')}>
                {(p) => (
                  <select
                    {...p}
                    value={params.method}
                    onChange={(e) => setParams({ ...params, method: e.target.value as SuggestionMethod })}
                    data-testid="suggestions-method"
                  >
                    <option value="AVERAGE">{f.t('params.methodAVERAGE')}</option>
                    <option value="SAME_PERIOD_LAST_YEAR">{f.t('params.methodSAME_PERIOD_LAST_YEAR')}</option>
                  </select>
                )}
              </Field>
              {params.method === 'AVERAGE' ? (
                <Field
                  label={f.t('params.periods')}
                  error={paramErrors.periods ? f.t('params.periodsInvalid') : undefined}
                >
                  {(p) => (
                    <input
                      {...p}
                      style={{ ...inputStyle, width: '5rem' }}
                      inputMode="numeric"
                      value={params.periods}
                      onChange={(e) => setParams({ ...params, periods: e.target.value })}
                      data-testid="suggestions-periods"
                    />
                  )}
                </Field>
              ) : null}
              <Field
                label={f.t('params.adjustment')}
                hint={f.t('params.adjustmentHint')}
                error={paramErrors.adjustment ? f.t('params.adjustmentInvalid') : undefined}
              >
                {(p) => (
                  <input
                    {...p}
                    style={{ ...inputStyle, width: '7rem' }}
                    inputMode="decimal"
                    value={params.adjustment}
                    onChange={(e) => setParams({ ...params, adjustment: e.target.value })}
                    data-testid="suggestions-adjustment"
                  />
                )}
              </Field>
              <Field label={f.t('params.rounding')}>
                {(p) => (
                  <select
                    {...p}
                    value={params.rounding}
                    onChange={(e) => setParams({ ...params, rounding: e.target.value })}
                    data-testid="suggestions-rounding"
                  >
                    <option value="">{f.t('params.roundingNone')}</option>
                    {ROUNDING_INCREMENTS.map((v) => (
                      <option key={v} value={String(v)}>
                        {f.t('params.roundingValue', { value: v })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div style={rowStyle}>
              <button type="submit" disabled={busy} data-testid="suggestions-calculate">
                {preview ? f.t('params.recalculate') : f.t('params.calculate')}
              </button>
              <button
                type="button"
                onClick={() => onClose(false)}
                disabled={busy}
                data-testid="suggestions-cancel"
              >
                {f.t('confirm.cancel')}
              </button>
            </div>
          </form>
          {busy && !preview ? <p aria-busy="true">{f.t('loading')}</p> : null}
          {preview ? (
            <>
              <p style={mutedStyle} data-testid="suggestions-window">
                {f.t('window.title', {
                  periods: preview.window.map((w) => w.label).join(', ') || '—',
                })}
                {preview.window.some((w) => !w.closed) ? ` ${f.t('window.notFrozen')}` : ''}
              </p>
              {preview.budgetId === null ? (
                <p style={mutedStyle} data-testid="suggestions-no-plan">
                  {f.t('window.noPlan')}
                </p>
              ) : null}
              <SuggestionsTable
                preview={preview}
                names={names}
                f={f}
                canConfirm={canConfirm}
                picked={picked}
                amounts={amounts}
                invalid={invalid}
                onPick={(key, checked) => {
                  const next = new Set(picked);
                  if (checked) next.add(key);
                  else next.delete(key);
                  setPicked(next);
                  setReviewing(false);
                }}
                onAmount={(key, value) => setAmounts({ ...amounts, [key]: value })}
                onPeriod={(key, periodId2, action) =>
                  void compute(withOverride(overrides, key, periodId2, action))
                }
              />
              {canConfirm && preview.lines.some(isApplicable) ? (
                <div style={rowStyle}>
                  <button
                    type="button"
                    onClick={() =>
                      setPicked(new Set(preview.lines.filter(isApplicable).map((l) => lineKey(l.target))))
                    }
                    data-testid="suggestions-pick-all"
                  >
                    {f.t('table.pickAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicked(new Set())}
                    data-testid="suggestions-pick-none"
                  >
                    {f.t('table.pickNone')}
                  </button>
                </div>
              ) : null}
              {reviewing && picksForSummary ? (
                <div role="group" aria-label={f.t('confirm.summaryTitle')} data-testid="suggestions-summary">
                  <p style={{ margin: 0 }}>
                    <strong>{f.t('confirm.summaryTitle', { count: picksForSummary.length })}</strong>
                  </p>
                  {preview.budgetId === null ? <p style={mutedStyle}>{f.t('window.noPlanCreate')}</p> : null}
                  <ul>
                    {picksForSummary.map(({ line, amount }) => (
                      <li key={lineKey(line.target)}>
                        {f.t(line.existingLineId === null ? 'confirm.addLine' : 'confirm.changeLine', {
                          name: targetName(names, line.target.kind, line.target.id) || line.targetName,
                          from: line.currentAmount ? formatMoney(line.currentAmount, f.locale) : '—',
                          to: formatMoney({ amount, currency: preview.currency }, f.locale),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div style={rowStyle}>
                {stale ? (
                  <button
                    type="button"
                    onClick={() => void compute(overrides)}
                    data-testid="suggestions-reload"
                  >
                    {f.t('confirm.recalculate')}
                  </button>
                ) : canConfirm && !reviewing ? (
                  <button
                    type="button"
                    disabled={busy || chosen.length === 0}
                    onClick={() => {
                      if (resolvePicks()) setReviewing(true);
                    }}
                    data-testid="suggestions-review"
                  >
                    {f.t('confirm.review', { count: chosen.length })}
                  </button>
                ) : canConfirm && reviewing ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void confirm()}
                      data-testid="suggestions-confirm"
                    >
                      {f.t('confirm.apply')}
                    </button>
                    <button type="button" onClick={() => setReviewing(false)} disabled={busy}>
                      {f.t('confirm.back')}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Entrada al flujo desde el plan (o desde un periodo sin plan): el botón "Sugerir desde el historial" abre el panel y,
 * al confirmar, recarga el plan. Un VIEWER ve la vista previa pero no puede elegir ni confirmar.
 */
export function PlanSuggestions({
  ctx,
  f,
  periodId,
  names,
  canConfirm,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  periodId: string;
  names: TargetNames;
  canConfirm: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <SuggestionsPanel
        ctx={ctx}
        periodId={periodId}
        names={names}
        canConfirm={canConfirm}
        onClose={(applied) => {
          setOpen(false);
          if (applied) onChanged();
        }}
      />
    );
  }
  return (
    <div style={rowStyle}>
      <button type="button" onClick={() => setOpen(true)} data-testid="suggest-open">
        {f.t('suggest.open')}
      </button>
    </div>
  );
}
