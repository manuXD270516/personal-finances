'use client';

import { useState } from 'react';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { Field, cardStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import type { Category, CategoryGroup } from '../common/types';
import { categoryOptions } from '../transactions/catalogs';
import { formatBusinessDate } from '../planning/logic';
import { differenceIsZero, hasClosingBalance, type ReviewFilter } from './pipeline-logic';
import type { DuplicateConfidence, ImportJob, ImportPreviewSummary } from './types';

/** Filtros adicionales de la revisión: sin categoría, confianza del candidato y regla (opciones de las filas cargadas). */
export function AdvancedFilters({
  f,
  value,
  rules,
  onChange,
}: {
  f: FormatContext;
  value: ReviewFilter;
  rules: readonly { readonly ruleId: string; readonly version: number | null }[];
  onChange: (patch: Partial<ReviewFilter>) => void;
}) {
  return (
    <div style={rowStyle} data-testid="import-advanced-filters">
      <button
        type="button"
        aria-pressed={value.needsCategory}
        data-testid="import-filter-NEEDS_CATEGORY"
        onClick={() => onChange({ needsCategory: !value.needsCategory })}
      >
        {f.t('filters.needsCategory')}
      </button>
      <Field label={f.t('filters.confidence')}>
        {(p) => (
          <select
            {...p}
            style={inputStyle}
            value={value.confidence}
            data-testid="import-filter-confidence"
            onChange={(e) => onChange({ confidence: e.target.value as '' | DuplicateConfidence })}
          >
            <option value="">{f.t('filters.anyConfidence')}</option>
            <option value="HIGH">{f.t('confidence.HIGH')}</option>
            <option value="MEDIUM">{f.t('confidence.MEDIUM')}</option>
            <option value="LOW">{f.t('confidence.LOW')}</option>
          </select>
        )}
      </Field>
      <Field label={f.t('filters.rule')}>
        {(p) => (
          <select
            {...p}
            style={inputStyle}
            value={value.ruleId}
            data-testid="import-filter-rule"
            onChange={(e) => onChange({ ruleId: e.target.value })}
          >
            <option value="">{f.t('filters.anyRule')}</option>
            {rules.map((r) => (
              <option key={r.ruleId} value={r.ruleId}>
                {f.t('filters.ruleOption', { id: r.ruleId.slice(0, 8), version: r.version ?? 0 })}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

/**
 * Saldo del extracto (openspec add-import-pipeline, decisión 14): saldo final y periodo que declara el archivo o que
 * escribe el usuario (`PUT .../statement`), saldo resultante de la cuenta y la DIFERENCIA entre ambos. Sin ajustes
 * automáticos: es solo información previa a aprobar.
 */
export function StatementPanel({
  f,
  job,
  summary,
  currency,
  canEdit,
  busy,
  onSave,
}: {
  f: FormatContext;
  job: ImportJob;
  summary: ImportPreviewSummary | undefined;
  currency: string;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: {
    closingBalance: { amount: string; currency: string } | null;
    periodTo: string | null;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(job.statement?.closingBalance?.amount ?? '');
  const [date, setDate] = useState(job.statement?.periodTo ?? '');
  const [error, setError] = useState<string | undefined>();
  const has = hasClosingBalance(job);

  function save() {
    const value = amount.trim();
    if (value !== '' && !/^-?\d+(?:\.\d+)?$/.test(value)) {
      setError(f.t('statement.errors.amount'));
      return;
    }
    setError(undefined);
    onSave({
      closingBalance: value === '' ? null : { amount: value, currency },
      periodTo: date === '' ? null : date,
    });
    setEditing(false);
  }

  if (!has && !canEdit) return null;
  const diff = job.statementDifference;
  return (
    <section
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      aria-labelledby="statement-title"
      data-testid="import-statement"
    >
      <h3 id="statement-title" style={{ margin: 0 }}>
        {f.t('statement.title')}
      </h3>
      {has ? (
        <dl style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-4)' }}>
          <div>
            <dt style={mutedStyle}>{f.t('statement.closing')}</dt>
            <dd style={{ margin: 0 }} data-testid="statement-closing">
              {job.statement?.closingBalance ? formatMoney(job.statement.closingBalance, f.locale) : '—'}
              {job.statement?.periodTo ? ` · ${formatBusinessDate(job.statement.periodTo)}` : ''}
            </dd>
          </div>
          {summary ? (
            <div>
              <dt style={mutedStyle}>{f.t('totals.resultingBalance')}</dt>
              <dd style={{ margin: 0 }}>{formatMoney(summary.resultingBalance, f.locale)}</dd>
            </div>
          ) : null}
          {diff ? (
            <div>
              <dt style={mutedStyle}>{f.t('statement.difference')}</dt>
              <dd
                style={{ margin: 0, fontWeight: 600 }}
                data-testid="statement-difference"
                data-zero={differenceIsZero(diff.amount)}
              >
                {formatMoney(diff, f.locale)}{' '}
                <span style={mutedStyle}>
                  ({differenceIsZero(diff.amount) ? f.t('statement.matches') : f.t('statement.differs')})
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('statement.none')}</p>
      )}
      {canEdit && job.status === 'AWAITING_REVIEW' ? (
        editing ? (
          <div style={rowStyle}>
            <Field label={f.t('statement.closingInput', { currency })} error={error}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="decimal"
                  style={inputStyle}
                  value={amount}
                  data-testid="statement-amount"
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label={f.t('statement.dateInput')}>
              {(p) => (
                <input
                  {...p}
                  type="date"
                  style={inputStyle}
                  value={date}
                  data-testid="statement-date"
                  onChange={(e) => setDate(e.target.value)}
                />
              )}
            </Field>
            <button type="button" disabled={busy} data-testid="statement-save" onClick={save}>
              {f.t('statement.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              {f.t('statement.cancel')}
            </button>
          </div>
        ) : (
          <div>
            <button type="button" data-testid="statement-edit" onClick={() => setEditing(true)}>
              {has ? f.t('statement.edit') : f.t('statement.set')}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}

/**
 * Acciones en lote de la revisión: asignar una categoría a las filas del FILTRO actual, reevaluar las reglas (conserva
 * lo editado) y confirmar las coincidencias de compromisos de confianza alta (acción explícita, D121).
 */
export function BulkTools({
  f,
  categories,
  groups,
  filterLabel,
  filterSupported,
  highConfidence,
  busy,
  onBulkCategory,
  onReevaluate,
  onConfirmMatches,
}: {
  f: FormatContext;
  categories: readonly Category[];
  groups: readonly CategoryGroup[];
  /** Descripción legible del filtro (para el texto del botón). */
  filterLabel: string;
  /** El filtro vigente se puede enviar a la edición en lote. */
  filterSupported: boolean;
  /** Filas cargadas con una única candidata de confianza alta aún sin confirmar. */
  highConfidence: number;
  busy: boolean;
  onBulkCategory: (categoryId: string) => void;
  onReevaluate: () => void;
  onConfirmMatches: () => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const groupsOptions = [
    ...categoryOptions(categories, groups, 'EXPENSE'),
    ...categoryOptions(categories, groups, 'INCOME'),
  ];
  return (
    <section
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      aria-labelledby="bulk-title"
      data-testid="import-bulk"
    >
      <h3 id="bulk-title" style={{ margin: 0 }}>
        {f.t('bulk.title')}
      </h3>
      <div style={rowStyle}>
        <Field label={f.t('bulk.category')} hint={f.t('bulk.hint', { filter: filterLabel })}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={categoryId}
              disabled={busy || !filterSupported}
              data-testid="bulk-category"
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{f.t('bulk.chooseCategory')}</option>
              {groupsOptions.map((g) => (
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
        <button
          type="button"
          disabled={busy || !filterSupported || categoryId === ''}
          data-testid="bulk-apply"
          onClick={() => onBulkCategory(categoryId)}
        >
          {f.t('bulk.apply')}
        </button>
      </div>
      {!filterSupported ? (
        <p style={{ ...mutedStyle, margin: 0 }} data-testid="bulk-unsupported">
          {f.t('bulk.unsupported')}
        </p>
      ) : null}
      <div style={rowStyle}>
        <button type="button" disabled={busy} data-testid="reevaluate-rules" onClick={onReevaluate}>
          {f.t('bulk.reevaluate')}
        </button>
        <button
          type="button"
          disabled={busy || highConfidence === 0}
          data-testid="confirm-high-matches"
          onClick={onConfirmMatches}
        >
          {f.t('bulk.confirmMatches', { count: highConfidence })}
        </button>
      </div>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('bulk.reevaluateHint')}</p>
    </section>
  );
}
