'use client';

import { forwardRef, useState, type CSSProperties } from 'react';
import {
  Field,
  cardStyle,
  cellStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { formatDecimal } from '../AuditHistory';
import { formatSignedDecimal } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { Badge } from '../recurring/Badges';
import { isDifferent, type LoanFormErrors, type ManualRowForm } from './logic';
import {
  COMPARED,
  DATE_FORMATS,
  DELIMITERS,
  MAPPING_FIELDS,
  REQUIRED_MAPPING,
  type ComparedRow,
  type ComparedRowStatus,
  type ComparisonStatus,
  type ReferencePreview,
  type ReferenceRowError,
  type ScheduleComparison,
  type Suggestion,
} from './types';
import type { ReferenceFormState } from './logic';

const diffStyle: CSSProperties = { color: 'var(--pf-error)', fontWeight: 600 };

const ROW_PRESENTATION: Readonly<
  Record<ComparedRowStatus, { icon: string; tone: 'ok' | 'danger' | 'warn' }>
> = {
  MATCH: { icon: '✓', tone: 'ok' },
  DIFFERENT: { icon: '≠', tone: 'danger' },
  ONLY_REFERENCE: { icon: '⊕', tone: 'warn' },
  ONLY_SYSTEM: { icon: '⊖', tone: 'warn' },
};

const STATUS_PRESENTATION: Readonly<
  Record<ComparisonStatus, { icon: string; tone: 'ok' | 'danger' | 'warn' }>
> = {
  MATCH: { icon: '✓', tone: 'ok' },
  EXPLAINED: { icon: 'ℹ', tone: 'warn' },
  UNEXPLAINED: { icon: '⚠', tone: 'danger' },
};

/** Errores de carga por fila (`LOAN_REFERENCE_INVALID`): el foco va al primero (accesibilidad). */
export const ReferenceErrors = forwardRef<
  HTMLDivElement,
  { f: FormatContext; errors: readonly ReferenceRowError[] }
>(function ReferenceErrors({ f, errors }, ref) {
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" style={warningStyle} data-testid="reference-errors">
      <strong>{f.t('compare.errors.title', { count: errors.length })}</strong>
      <ul style={{ margin: 'var(--pf-space-1) 0 0', paddingLeft: '1.25rem' }}>
        {errors.map((e, i) => (
          <li
            key={`${e.row}-${e.field}-${i}`}
            data-testid="reference-error"
            data-row={e.row}
            data-field={e.field}
          >
            {f.t('compare.errors.item', {
              row: e.row,
              field: f.has(`compare.fields.${e.field}`) ? f.t(`compare.fields.${e.field}`) : e.field,
            })}
            {' — '}
            {f.has(`compare.errors.codes.${e.code}`) ? f.t(`compare.errors.codes.${e.code}`) : e.message}
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Delimitador detectado (se confirma o cambia), columnas del encabezado, mapeo por nombre, formato de fecha y decimal. */
export function MappingForm({
  f,
  preview,
  state,
  set,
  missing,
  busy,
  onApply,
}: {
  f: FormatContext;
  preview: ReferencePreview;
  state: ReferenceFormState;
  set: (patch: Partial<ReferenceFormState>) => void;
  missing: readonly string[];
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <form
      style={formStyle}
      noValidate
      data-testid="reference-mapping"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <p style={{ margin: 0 }} data-testid="reference-detected" aria-live="polite">
        {f.t('compare.detected', { rows: preview.rowCount, columns: preview.headers.length })}
      </p>
      <div style={rowStyle}>
        <Field label={f.t('compare.delimiter')} hint={f.t('compare.delimiterHint')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={state.delimiter}
              data-testid="reference-delimiter"
              onChange={(e) => set({ delimiter: e.target.value as ReferenceFormState['delimiter'] })}
            >
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {f.t(`compare.delimiters.${d === '\t' ? 'tab' : d === ';' ? 'semicolon' : 'comma'}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('compare.dateFormat')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={state.dateFormat}
              data-testid="reference-date-format"
              onChange={(e) => set({ dateFormat: e.target.value as ReferenceFormState['dateFormat'] })}
            >
              {DATE_FORMATS.map((d) => (
                <option key={d} value={d}>
                  {f.t(`compare.dateFormats.${d}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('compare.decimal')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={state.decimalSeparator}
              data-testid="reference-decimal"
              onChange={(e) => set({ decimalSeparator: e.target.value as ',' | '.' })}
            >
              <option value=",">{f.t('compare.decimals.comma')}</option>
              <option value=".">{f.t('compare.decimals.dot')}</option>
            </select>
          )}
        </Field>
      </div>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('compare.sampleRegion')}>
        <table style={tableStyle} data-testid="reference-sample">
          <caption className="pf-sr-only">{f.t('compare.sampleCaption')}</caption>
          <thead>
            <tr>
              {preview.headers.map((h, i) => (
                <th key={`${h}-${i}`} scope="col" style={cellStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.preview.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={cellStyle}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset style={{ ...cardStyle, margin: 0 }} disabled={busy}>
        <legend>{f.t('compare.mapping')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('compare.mappingHint')}</p>
        <div style={rowStyle}>
          {MAPPING_FIELDS.map((field) => (
            <Field
              key={field}
              label={`${f.t(`compare.fields.${field}`)}${REQUIRED_MAPPING.includes(field) ? ' *' : ''}`}
              error={missing.includes(field) ? f.t('errors.REQUIRED') : undefined}
            >
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={state.mapping[field] ?? ''}
                  data-testid={`reference-map-${field}`}
                  onChange={(e) => set({ mapping: { ...state.mapping, [field]: e.target.value } })}
                >
                  <option value="">{f.t('compare.noColumn')}</option>
                  {preview.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <div>
        <button type="submit" disabled={busy} data-testid="reference-upload">
          {busy ? f.t('compare.loading') : f.t('compare.upload')}
        </button>
      </div>
    </form>
  );
}

/** Ingreso fila por fila (`source: MANUAL`). */
export function ManualRows({
  f,
  rows,
  errors,
  onChange,
  onAdd,
  onRemove,
  busy,
  onApply,
}: {
  f: FormatContext;
  rows: readonly ManualRowForm[];
  errors: LoanFormErrors;
  onChange: (index: number, patch: Partial<ManualRowForm>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  busy: boolean;
  onApply: () => void;
}) {
  const cols = ['n', 'dueDate', 'principal', 'interest', 'fees', 'insurance', 'taxes', 'total'] as const;
  return (
    <form
      style={formStyle}
      noValidate
      data-testid="reference-manual"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('compare.manualHint')}</p>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('compare.manualRegion')}>
        <table style={tableStyle}>
          <caption className="pf-sr-only">{f.t('compare.manualCaption')}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col" style={cellStyle}>
                  {f.t(`compare.manualCols.${c}`)}
                </th>
              ))}
              <th scope="col" style={cellStyle}>
                <span className="pf-sr-only">{f.t('compare.manualActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} data-testid="manual-row">
                {cols.map((c) => {
                  const error = errors[`${i}.${c}`];
                  return (
                    <td key={c} style={cellStyle}>
                      <input
                        type={c === 'dueDate' ? 'date' : 'text'}
                        inputMode={c === 'n' ? 'numeric' : c === 'dueDate' ? undefined : 'decimal'}
                        aria-label={f.t('compare.manualCell', {
                          row: i + 1,
                          col: f.t(`compare.manualCols.${c}`),
                        })}
                        aria-invalid={error ? true : undefined}
                        title={error ? f.t(`errors.${error}`) : undefined}
                        style={{
                          ...inputStyle,
                          width: c === 'dueDate' ? '9.5rem' : c === 'n' ? '4rem' : '7rem',
                        }}
                        value={row[c]}
                        data-testid={`manual-${c}`}
                        onChange={(e) => onChange(i, { [c]: e.target.value } as Partial<ManualRowForm>)}
                      />
                      {error ? (
                        <small
                          style={{ color: 'var(--pf-error)', display: 'block' }}
                          data-testid="field-error"
                        >
                          {f.t(`errors.${error}`)}
                        </small>
                      ) : null}
                    </td>
                  );
                })}
                <td style={cellStyle}>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      aria-label={f.t('compare.manualRemove', { row: i + 1 })}
                    >
                      {f.t('compare.manualRemoveShort')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={rowStyle}>
        <button type="button" onClick={onAdd} disabled={busy || rows.length >= 600} data-testid="manual-add">
          {f.t('compare.manualAdd')}
        </button>
        <button type="submit" disabled={busy} data-testid="reference-upload">
          {busy ? f.t('compare.loading') : f.t('compare.upload')}
        </button>
      </div>
    </form>
  );
}

function SuggestionItem({ s, f }: { s: Suggestion; f: FormatContext }) {
  switch (s.kind) {
    case 'CONVENTION':
      return (
        <li data-testid="suggestion" data-kind={s.kind}>
          {f.t(s.current ? 'compare.suggestions.conventionCurrent' : 'compare.suggestions.convention', {
            dayCount: f.t(`dayCount.${s.dayCount}`),
            matching: s.matchingInstallments,
            total: s.totalRows,
            interest: s.interestMatchingInstallments,
          })}
          {s.betterThanCurrent ? <strong> {f.t('compare.suggestions.better')}</strong> : null}
        </li>
      );
    case 'ONLY_LAST_INSTALLMENT':
      return (
        <li data-testid="suggestion" data-kind={s.kind}>
          {f.t('compare.suggestions.ONLY_LAST_INSTALLMENT', {
            tolerance: formatDecimal(s.tolerance, f.locale),
          })}
        </li>
      );
    case 'PRINCIPAL_SUM_DIFFERS':
      return (
        <li data-testid="suggestion" data-kind={s.kind}>
          {f.t('compare.suggestions.PRINCIPAL_SUM_DIFFERS', {
            difference: formatSignedDecimal(s.difference, f.locale),
          })}
        </li>
      );
    default:
      return (
        <li data-testid="suggestion" data-kind={s.kind}>
          {f.t(`compare.suggestions.${s.kind}`)}
        </li>
      );
  }
}

/** Resumen del reporte: coincidentes / total, primera diferencia, Σ de diferencias, Σ principal y cuotas huérfanas. */
export function ComparisonSummaryView({
  f,
  comparison,
}: {
  f: FormatContext;
  comparison: ScheduleComparison;
}) {
  const { summary } = comparison;
  const { locale } = f;
  const pres = STATUS_PRESENTATION[comparison.status];
  const principalDiffers = summary.referencePrincipal !== summary.loanPrincipal;
  return (
    <section
      aria-labelledby="cmp-summary-title"
      style={cardStyle}
      data-testid="comparison-summary"
      aria-live="polite"
    >
      <h2 id="cmp-summary-title" style={{ fontSize: '1.125rem', marginTop: 0 }}>
        {f.t('compare.summary.title')}
      </h2>
      <p style={{ margin: 0 }}>
        <Badge
          presentation={pres}
          label={f.t(`compare.status.${comparison.status}`)}
          status={comparison.status}
          testId="comparison-status"
        />
      </p>
      <p data-testid="comparison-matched">
        {f.t('compare.summary.matched', { matched: comparison.matched, total: comparison.totalRows })}
      </p>
      {comparison.firstDifferenceNo !== null ? (
        <p data-testid="comparison-first">
          {f.t('compare.summary.first', { n: comparison.firstDifferenceNo })}
        </p>
      ) : null}
      {summary.differingComponents.length > 0 ? (
        <>
          <h3 style={{ fontSize: '0.9375rem' }}>{f.t('compare.summary.sums')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="comparison-sums">
            {COMPARED.filter((c) => isDifferent(summary.sumDifferences[c])).map((c) => (
              <li key={c} data-component={c}>
                {f.t(`compare.components.${c}`)}:{' '}
                <span style={diffStyle}>{formatSignedDecimal(summary.sumDifferences[c], locale)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p data-testid="comparison-principal" style={principalDiffers ? diffStyle : undefined}>
        {f.t('compare.summary.principal', {
          bank: formatDecimal(summary.referencePrincipal, locale),
          loan: formatDecimal(summary.loanPrincipal, locale),
        })}
      </p>
      {summary.onlyReference.length > 0 ? (
        <p data-testid="comparison-only-reference">
          {f.t('compare.summary.onlyReference', { list: summary.onlyReference.join(', ') })}
        </p>
      ) : null}
      {summary.onlySystem.length > 0 ? (
        <p data-testid="comparison-only-system">
          {f.t('compare.summary.onlySystem', { list: summary.onlySystem.join(', ') })}
        </p>
      ) : null}
      {summary.dateMismatches.length > 0 ? (
        <p data-testid="comparison-dates">
          {f.t('compare.summary.dates', { list: summary.dateMismatches.join(', ') })}
        </p>
      ) : null}
      {comparison.suggestions.length > 0 ? (
        <>
          <h3 style={{ fontSize: '0.9375rem' }}>{f.t('compare.suggestions.title')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="comparison-suggestions">
            {comparison.suggestions.map((s, i) => (
              <SuggestionItem key={`${s.kind}-${i}`} s={s} f={f} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RowDetail({ row, f }: { row: ComparedRow; f: FormatContext }) {
  return (
    <details>
      <summary>
        {f.t('compare.table.detail')}
        <span className="pf-sr-only"> {row.n}</span>
      </summary>
      <table style={{ ...tableStyle, fontSize: '0.875rem' }}>
        <caption className="pf-sr-only">{f.t('compare.table.detailCaption', { n: row.n })}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('installments.component')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('compare.table.system')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('compare.table.bank')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('compare.table.diff')}
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARED.map((c) => (
            <tr key={c} data-component={c}>
              <th scope="row" style={cellStyle}>
                {f.t(`compare.components.${c}`)}
              </th>
              <td style={numCellStyle}>{row.system ? formatDecimal(row.system[c], f.locale) : '—'}</td>
              <td style={numCellStyle}>{row.reference ? formatDecimal(row.reference[c], f.locale) : '—'}</td>
              <td style={{ ...numCellStyle, ...(isDifferent(row.differences?.[c]) ? diffStyle : {}) }}>
                {row.differences ? formatSignedDecimal(row.differences[c], f.locale) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Reporte cuota por cuota: diferencia (banco − sistema) por componente al centavo, con las diferencias resaltadas. */
export function ComparisonTable({ f, comparison }: { f: FormatContext; comparison: ScheduleComparison }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const rows = onlyDiff ? comparison.rows.filter((r) => r.status !== 'MATCH') : comparison.rows;
  return (
    <section aria-labelledby="cmp-table-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h2 id="cmp-table-title" style={{ fontSize: '1.125rem', margin: 0 }}>
        {f.t('compare.table.title')}
      </h2>
      <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={onlyDiff}
          data-testid="comparison-only-diff"
          onChange={(e) => setOnlyDiff(e.target.checked)}
        />
        {f.t('compare.table.onlyDiff')}
      </label>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('compare.table.region')}>
        <table style={tableStyle} data-testid="comparison-table">
          <caption className="pf-sr-only">{f.t('compare.table.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('columns.n')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.state')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.due')}
              </th>
              {COMPARED.map((c) => (
                <th key={c} scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('compare.table.diffOf', { component: f.t(`compare.components.${c}`) })}
                </th>
              ))}
              <th scope="col" style={cellStyle}>
                {f.t('installments.detail')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} data-testid="comparison-row" data-n={r.n} data-status={r.status}>
                <th scope="row" style={cellStyle}>
                  {r.n}
                </th>
                <td style={cellStyle}>
                  <Badge
                    presentation={{ ...ROW_PRESENTATION[r.status] }}
                    label={f.t(`compare.rowStatus.${r.status}`)}
                    status={r.status}
                    testId="comparison-row-status"
                  />
                </td>
                <td style={cellStyle}>
                  {r.system ? formatBusinessDate(r.system.dueDate) : '—'}
                  {r.datesMatch === false && r.reference ? (
                    <div style={diffStyle}>
                      <span aria-hidden="true">≠</span>{' '}
                      {f.t('compare.table.bankDate', { date: formatBusinessDate(r.reference.dueDate) })}
                    </div>
                  ) : null}
                  {r.system === null && r.reference ? formatBusinessDate(r.reference.dueDate) : null}
                </td>
                {COMPARED.map((c) => {
                  const d = r.differences?.[c];
                  return (
                    <td
                      key={c}
                      style={{ ...numCellStyle, ...(isDifferent(d) ? diffStyle : {}) }}
                      data-component={c}
                    >
                      {d === undefined ? '—' : formatSignedDecimal(d, f.locale)}
                    </td>
                  );
                })}
                <td style={cellStyle}>
                  <RowDetail row={r} f={f} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Explicación de la diferencia (≤ 1000): solo con diferencias; muestra autor y fecha cuando ya está explicada. */
export function ExplainPanel({
  f,
  comparison,
  canEdit,
  busy,
  onExplain,
  explainedAt,
}: {
  f: FormatContext;
  comparison: ScheduleComparison;
  canEdit: boolean;
  busy: boolean;
  onExplain: (text: string) => void;
  explainedAt?: string | undefined;
}) {
  const [text, setText] = useState(comparison.explanation ?? '');
  if (comparison.status === 'MATCH') return null;
  return (
    <section aria-labelledby="cmp-explain-title" style={formStyle} data-testid="comparison-explain">
      <h2 id="cmp-explain-title" style={{ fontSize: '1.125rem', margin: 0 }}>
        {f.t('compare.explain.title')}
      </h2>
      {comparison.status === 'EXPLAINED' ? (
        <p role="status" style={{ margin: 0 }} data-testid="comparison-explanation">
          {comparison.explanation}
          {explainedAt ? <span style={mutedStyle}> — {explainedAt}</span> : null}
        </p>
      ) : (
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('compare.explain.hint')}</p>
      )}
      {canEdit ? (
        <>
          <Field
            label={f.t('compare.explain.label')}
            hint={f.t('compare.explain.limit', { count: text.length })}
          >
            {(p) => (
              <textarea
                {...p}
                rows={3}
                maxLength={1000}
                style={inputStyle}
                value={text}
                data-testid="comparison-explain-text"
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Field>
          <div>
            <button
              type="button"
              disabled={busy || text.trim() === ''}
              data-testid="comparison-explain-submit"
              onClick={() => onExplain(text.trim())}
            >
              {comparison.status === 'EXPLAINED'
                ? f.t('compare.explain.update')
                : f.t('compare.explain.submit')}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
