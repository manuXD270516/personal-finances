'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatInstant } from '../dashboard/format';
import { BFF_API } from '../session-context';
import {
  ComparisonSummaryView,
  ComparisonTable,
  ExplainPanel,
  ManualRows,
  MappingForm,
  ReferenceErrors,
} from './CompareParts';
import {
  autoMapping,
  buildManualRows,
  buildReferenceInput,
  comparisonPath,
  emptyManualRow,
  guessDateFormat,
  guessDecimal,
  loanPath,
  MAX_REFERENCE_BYTES,
  missingMapping,
  readTextFile,
  referenceRowErrors,
  referencePath,
  type LoanFormErrors,
  type ManualRowForm,
  type ReferenceFormState,
} from './logic';
import type {
  Delimiter,
  LoanDetail,
  ReferencePreview,
  ReferenceRowError,
  ReferenceSchedule,
  ReferenceUploadResult,
  ScheduleComparison,
} from './types';

export function ComparePageView({ loanId }: { loanId: string }) {
  return <WithWorkspace>{(ctx) => <Compare ctx={ctx} loanId={loanId} />}</WithWorkspace>;
}

type Source = 'PASTE' | 'CSV' | 'MANUAL';

const DEFAULT_STATE: ReferenceFormState = {
  delimiter: ';',
  mapping: {},
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: ',',
};

/**
 * Comparar con la tabla del banco (exit criterion de Phase 4): pegar texto, subir un CSV (se lee en el navegador como UTF-8
 * y viaja como `text`) o ingresar fila por fila; confirmar separador y columnas; reporte por cuota, sugerencias, explicación
 * y exportación CSV. Nunca cambia el cronograma del préstamo.
 */
function Compare({ ctx, loanId }: { ctx: WorkspaceContext; loanId: string }) {
  const f = useFormat('Debt', ctx);
  const [loan, setLoan] = useState<LoanDetail | undefined>();
  const [refs, setRefs] = useState<readonly ReferenceSchedule[]>([]);
  const [source, setSource] = useState<Source>('PASTE');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [preview, setPreview] = useState<ReferencePreview | undefined>();
  const [state, setState] = useState<ReferenceFormState>(DEFAULT_STATE);
  const [manual, setManual] = useState<readonly ManualRowForm[]>([emptyManualRow(1)]);
  const [manualErrors, setManualErrors] = useState<LoanFormErrors>({});
  const [rowErrors, setRowErrors] = useState<readonly ReferenceRowError[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [comparison, setComparison] = useState<ScheduleComparison | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const errorsRef = useRef<HTMLDivElement>(null);
  const rowErrorsRef = useRef<HTMLDivElement>(null);
  const attempt = useRef(uuidv7());

  const loadRefs = useCallback(async () => {
    const r = await ctx.api
      .get<{ data: ReferenceSchedule[] }>(referencePath(ctx.base, loanId))
      .then((x) => x.data?.data ?? [])
      .catch(() => [] as ReferenceSchedule[]);
    setRefs(r);
    return r;
  }, [ctx.api, ctx.base, loanId]);

  const openComparison = useCallback(
    async (referenceId: string) => {
      setBusy(true);
      setProblem(undefined);
      try {
        const r = await ctx.api.get<ScheduleComparison>(comparisonPath(ctx.base, loanId, referenceId));
        setComparison(r.data);
      } catch (err) {
        setProblem(problemOf(err));
      } finally {
        setBusy(false);
      }
    },
    [ctx.api, ctx.base, loanId],
  );

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<LoanDetail>(loanPath(ctx.base, loanId))
      .then((r) => {
        if (!cancelled) setLoan(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    void loadRefs().then((r) => {
      const latest = r[0];
      if (!cancelled && latest) void openComparison(latest.id);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, loanId, loadRefs, openComparison]);

  // El foco va al primer error por fila (si hay) o al contenedor de mensajes.
  // El foco se aplica tras el render que muestra los errores (un `setTimeout` puede ganarle a React).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) (rowErrorsRef.current ?? errorsRef.current)?.focus();
  }, [focusTick]);
  const focusErrors = () => setFocusTick((n) => n + 1);

  /** Detecta separador y columnas (`previewLoanReferenceSchedule`); con `delimiter` se re-lee con el separador elegido. */
  async function detect(content: string, delimiter?: Delimiter) {
    setBusy(true);
    setProblem(undefined);
    setRowErrors([]);
    setNotice(undefined);
    try {
      const r = await ctx.api.command<ReferencePreview>(
        'POST',
        referencePath(ctx.base, loanId, '/preview'),
        { text: content, hasHeader: true, ...(delimiter ? { delimiter } : {}) },
        { idempotent: false },
      );
      const p = r.data!;
      const d = (delimiter ?? p.delimiter) as Delimiter;
      const mapping = autoMapping(p.headers);
      const dateIndex = mapping.dueDate ? p.headers.indexOf(mapping.dueDate) : -1;
      setPreview(p);
      setState((prev) => ({
        delimiter: d,
        mapping: delimiter ? prev.mapping : mapping,
        dateFormat: delimiter
          ? prev.dateFormat
          : guessDateFormat(dateIndex >= 0 ? p.preview[0]?.[dateIndex] : undefined),
        decimalSeparator: delimiter ? prev.decimalSeparator : guessDecimal(d),
      }));
      setShowMissing(false);
    } catch (err) {
      setPreview(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(input: unknown) {
    setBusy(true);
    setProblem(undefined);
    setRowErrors([]);
    try {
      const r = await ctx.api.command<ReferenceUploadResult>('POST', referencePath(ctx.base, loanId), input, {
        idempotencyKey: attempt.current,
      });
      attempt.current = uuidv7();
      setComparison(r.data!.comparison);
      setNotice(f.t('compare.loaded', { version: r.data!.referenceVersion }));
      setPreview(undefined);
      await loadRefs();
    } catch (err) {
      attempt.current = uuidv7();
      const p = problemOf(err);
      const rows = p.code === 'LOAN_REFERENCE_INVALID' ? referenceRowErrors(p) : [];
      setRowErrors(rows);
      setProblem(p);
      focusErrors();
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_REFERENCE_BYTES) {
      setProblem({ code: 'UPLOAD_TOO_LARGE' });
      return;
    }
    const content = await readTextFile(file);
    setFileName(file.name);
    setText(content);
    await detect(content);
  }

  function applyMapping() {
    const missing = missingMapping(state.mapping);
    setShowMissing(true);
    if (missing.length > 0) {
      focusErrors();
      return;
    }
    void upload(buildReferenceInput(source === 'CSV' ? 'CSV' : 'PASTE', text, state));
  }

  function applyManual() {
    const scale = scaleFor(loan?.principal.currency ?? ctx.ws.baseCurrency, ctx.scales);
    const built = buildManualRows(manual, {
      locale: ctx.formatLocale,
      scale,
      currency: loan?.principal.currency ?? ctx.ws.baseCurrency,
    });
    if (!built.ok) {
      setManualErrors(built.errors);
      setProblem(undefined);
      focusErrors();
      return;
    }
    setManualErrors({});
    void upload(built.input);
  }

  async function explain(explanation: string) {
    if (!comparison) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ScheduleComparison>(
        'POST',
        comparisonPath(ctx.base, loanId, comparison.referenceId, '/explanation'),
        { explanation },
        { idempotent: false },
      );
      setComparison(r.data);
      setNotice(f.t('compare.explain.done'));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const currency = loan?.principal.currency ?? ctx.ws.baseCurrency;
  const missing = showMissing ? missingMapping(state.mapping) : [];
  const nonRowProblem = problem && rowErrors.length === 0 ? problem : undefined;

  return (
    <section aria-labelledby="compare-title" style={pageStyle} data-testid="compare-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href(`/debts/${loanId}`)}>{f.t('compare.backToLoan')}</a>
      </p>
      <h1 id="compare-title">{loan ? f.t('compare.titleFor', { name: loan.name }) : f.t('compare.title')}</h1>
      <p style={mutedStyle}>{f.t('compare.intro')}</p>
      {notice ? (
        <p role="status" data-testid="compare-notice">
          {notice}
        </p>
      ) : null}
      <div
        ref={errorsRef}
        tabIndex={-1}
        data-testid="compare-errors"
        style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
      >
        <ReferenceErrors ref={rowErrorsRef} f={f} errors={rowErrors} />
        {nonRowProblem ? <ProblemMessage problem={nonRowProblem} locale={ctx.uiLocale} /> : null}
        {Object.keys(manualErrors).length > 0 && source === 'MANUAL' ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {f.t('form.fixErrors', { count: Object.keys(manualErrors).length })}
          </p>
        ) : null}
        {missing.length > 0 ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }} data-testid="mapping-missing">
            {f.t('compare.mappingMissing', {
              fields: missing.map((m) => f.t(`compare.fields.${m}`)).join(', '),
            })}
          </p>
        ) : null}
      </div>

      {ctx.canEdit ? (
        <section aria-labelledby="compare-load-title" style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
          <h2 id="compare-load-title" style={{ fontSize: '1.125rem', margin: 0 }}>
            {f.t('compare.load')}
          </h2>
          <div role="radiogroup" aria-label={f.t('compare.source')} style={rowStyle}>
            {(['PASTE', 'CSV', 'MANUAL'] as const).map((s) => (
              <label key={s} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="reference-source"
                  checked={source === s}
                  data-testid={`reference-source-${s}`}
                  onChange={() => {
                    setSource(s);
                    setPreview(undefined);
                    setRowErrors([]);
                  }}
                />
                {f.t(`compare.sources.${s}`)}
              </label>
            ))}
          </div>
          {source === 'PASTE' ? (
            <form
              style={formStyle}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void detect(text);
              }}
            >
              <Field label={f.t('compare.pasteLabel')} hint={f.t('compare.pasteHint')}>
                {(p) => (
                  <textarea
                    {...p}
                    rows={8}
                    style={{ ...inputStyle, width: '100%', fontFamily: 'var(--pf-font-mono, monospace)' }}
                    value={text}
                    data-testid="reference-text"
                    onChange={(e) => setText(e.target.value)}
                  />
                )}
              </Field>
              <div>
                <button type="submit" disabled={busy || text.trim() === ''} data-testid="reference-detect">
                  {f.t('compare.detect')}
                </button>
              </div>
            </form>
          ) : null}
          {source === 'CSV' ? (
            <div style={formStyle}>
              <Field label={f.t('compare.fileLabel')} hint={f.t('compare.fileHint')}>
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept=".csv,.txt,.tsv,text/csv,text/plain"
                    style={inputStyle}
                    disabled={busy}
                    data-testid="reference-file"
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                )}
              </Field>
              {fileName ? <p style={{ ...mutedStyle, margin: 0 }}>{fileName}</p> : null}
            </div>
          ) : null}
          {source !== 'MANUAL' && preview ? (
            <MappingForm
              f={f}
              preview={preview}
              state={state}
              set={(patch) => {
                setState((prev) => ({ ...prev, ...patch }));
                if (patch.delimiter && patch.delimiter !== state.delimiter)
                  void detect(text, patch.delimiter);
              }}
              missing={missing}
              busy={busy}
              onApply={applyMapping}
            />
          ) : null}
          {source === 'MANUAL' ? (
            <ManualRows
              f={f}
              rows={manual}
              errors={manualErrors}
              busy={busy}
              onChange={(i, patch) =>
                setManual((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
              }
              onAdd={() => setManual((rows) => [...rows, emptyManualRow(rows.length + 1)])}
              onRemove={(i) => setManual((rows) => rows.filter((_, k) => k !== i))}
              onApply={applyManual}
            />
          ) : null}
        </section>
      ) : (
        <p style={mutedStyle}>{f.t('viewerNotice')}</p>
      )}

      {refs.length > 1 ? (
        <Field label={f.t('compare.versions')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={comparison?.referenceId ?? ''}
              data-testid="reference-version"
              onChange={(e) => void openComparison(e.target.value)}
            >
              {refs.map((r) => (
                <option key={r.id} value={r.id}>
                  {f.t('compare.versionOption', {
                    version: r.referenceVersion,
                    source: f.t(`compare.sources.${r.source}`),
                    rows: r.rowCount,
                    date: formatInstant(r.createdAt, ctx.formatLocale, ctx.timeZone),
                  })}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {comparison ? (
        <div
          style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
          data-testid="comparison"
          data-status={comparison.status}
        >
          <ComparisonSummaryView f={f} comparison={comparison} />
          <p style={{ margin: 0 }}>
            <a
              href={`${BFF_API}${comparisonPath(ctx.base, loanId, comparison.referenceId, '/export')}`}
              download="comparison.csv"
              data-testid="comparison-export"
            >
              {f.t('compare.export')}
            </a>
          </p>
          <ComparisonTable f={f} comparison={comparison} />
          <ExplainPanel
            key={`${comparison.referenceId}-${comparison.status}`}
            f={f}
            comparison={comparison}
            canEdit={ctx.canEdit}
            busy={busy}
            onExplain={(t) => void explain(t)}
            explainedAt={
              comparison.explainedAt
                ? formatInstant(comparison.explainedAt, ctx.formatLocale, ctx.timeZone)
                : undefined
            }
          />
        </div>
      ) : refs.length === 0 ? (
        <p style={mutedStyle} data-testid="compare-empty">
          {f.t('compare.empty', { currency })}
        </p>
      ) : null}
    </section>
  );
}
