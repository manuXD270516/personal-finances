import { useState } from 'react';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import type { Tag } from '../common/types';
import { errorStyle, Field, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import {
  newSplitRow,
  splitByPercent,
  splitEqually,
  summarizeSplits,
  type SplitMoney,
  type SplitRow,
} from './splits';

export interface CategoryOptionGroup {
  readonly group: string;
  readonly options: readonly { id: string; label: string; system: boolean }[];
}

/**
 * Editor de splits (docs/28 §4.4): filas {categoría, monto, %, tags}; "Restante por asignar" debe llegar a 0;
 * "Partes iguales" y "Aplicar porcentajes" usan el mayor residuo (sin centavos perdidos).
 */
export function SplitsEditor({
  rows,
  onChange,
  total,
  money,
  categories,
  tags,
  f,
}: {
  rows: readonly SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  total: string | null;
  money: SplitMoney;
  categories: readonly CategoryOptionGroup[];
  tags: readonly Tag[];
  f: FormatContext;
}) {
  const { t, locale } = f;
  const [percentError, setPercentError] = useState(false);
  const summary = summarizeSplits(rows, total, money);
  const update = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const activeTags = tags.filter((tag) => !tag.archivedAt);

  return (
    <fieldset
      style={{ border: '1px solid #d0d7de', padding: '0.5rem', display: 'grid', gap: '0.5rem', minWidth: 0 }}
    >
      <legend>{t('splits.title')}</legend>
      {rows.map((r, i) => (
        <div key={r.key} style={rowStyle} data-testid="split-row">
          <Field label={t('splits.category', { n: i + 1 })}>
            {(p) => (
              <select
                {...p}
                name={`split-${i}-category`}
                style={inputStyle}
                value={r.categoryId}
                onChange={(e) => update(r.key, { categoryId: e.target.value })}
              >
                <option value="">{t('splits.uncategorized')}</option>
                {categories.map((g) => (
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
          <Field
            label={t('splits.amount', { n: i + 1, currency: money.currency })}
            error={
              summary.amounts[i] === null && r.amount.trim() !== ''
                ? t('splits.invalidAmount', { scale: money.scale })
                : undefined
            }
            style={{ flex: '0 1 9rem' }}
          >
            {(p) => (
              <input
                {...p}
                name={`split-${i}-amount`}
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                placeholder={rows.length === 1 ? t('splits.wholeAmount') : ''}
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
              />
            )}
          </Field>
          {rows.length > 1 ? (
            <Field label={t('splits.percent', { n: i + 1 })} style={{ flex: '0 1 5rem' }}>
              {(p) => (
                <input
                  {...p}
                  name={`split-${i}-percent`}
                  inputMode="decimal"
                  autoComplete="off"
                  style={inputStyle}
                  value={r.percent}
                  onChange={(e) => update(r.key, { percent: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          {activeTags.length > 0 ? (
            <Field label={t('splits.tags', { n: i + 1 })}>
              {(p) => (
                <select
                  {...p}
                  multiple
                  name={`split-${i}-tags`}
                  style={{ ...inputStyle, minHeight: '2.5rem' }}
                  value={[...r.tagIds]}
                  onChange={(e) =>
                    update(r.key, { tagIds: [...e.target.selectedOptions].map((o) => o.value) })
                  }
                >
                  {activeTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {rows.length > 1 ? (
            <button
              type="button"
              aria-label={t('splits.remove', { n: i + 1 })}
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            >
              {t('splits.removeShort')}
            </button>
          ) : null}
        </div>
      ))}
      <div style={rowStyle}>
        <button type="button" onClick={() => onChange([...rows, newSplitRow()])}>
          {t('splits.add')}
        </button>
        <button
          type="button"
          disabled={!total || rows.length < 2}
          onClick={() => total && onChange(splitEqually(rows, total, money))}
        >
          {t('splits.equal')}
        </button>
        <button
          type="button"
          disabled={!total || rows.length < 2}
          onClick={() => {
            const next = total ? splitByPercent(rows, total, money) : null;
            setPercentError(!next);
            if (next) onChange(next);
          }}
        >
          {t('splits.applyPercent')}
        </button>
      </div>
      {percentError ? (
        <p role="alert" style={errorStyle}>
          {t('splits.percentInvalid')}
        </p>
      ) : null}
      {rows.length > 1 ? (
        <p
          data-testid="split-remaining"
          data-balanced={summary.balanced ? 'true' : 'false'}
          aria-live="polite"
          style={summary.balanced ? mutedStyle : { ...errorStyle, color: '#9a6700' }}
        >
          {summary.remaining === null
            ? t('splits.remainingUnknown')
            : summary.balanced
              ? t('splits.balanced')
              : t('splits.remaining', {
                  amount: formatMoney({ amount: summary.remaining, currency: money.currency }, locale),
                })}
        </p>
      ) : null}
    </fieldset>
  );
}
