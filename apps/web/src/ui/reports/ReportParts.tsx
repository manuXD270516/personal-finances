import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import {
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import {
  filterError,
  toneOf,
  TONE_ICON,
  variationText,
  type DrillCell,
  type DrillDownPage,
  type ReportAmount,
  type ReportFilters,
  type ReportMeta,
  type ReportVariation,
  type VariationTone,
} from './logic';

/** Hoja de estilos de la sección de reportes (tokens `--pf-*` de `globals.css`). */
export const REPORTS_CSS = `
.pf-rp{display:grid;gap:var(--pf-space-4);min-width:0}
.pf-rp-layout{display:grid;gap:var(--pf-space-4);grid-template-columns:minmax(0,1fr)}
@media (min-width:60rem){.pf-rp-layout[data-drill="open"]{grid-template-columns:minmax(0,1fr) minmax(0,26rem)}}
.pf-rp-catalog{list-style:none;margin:0;padding:0;display:grid;gap:var(--pf-space-3);grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))}
.pf-rp-card{border:1px solid var(--pf-border);border-radius:var(--pf-radius-md);padding:var(--pf-space-3);background:var(--pf-surface-raised);display:grid;gap:var(--pf-space-2)}
.pf-rp-status{display:inline-block;font-size:var(--pf-text-xs);border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-full);padding:0 var(--pf-space-2)}
.pf-rp-var{white-space:nowrap}
.pf-rp-var[data-tone="up"][data-kind="expense"],.pf-rp-var[data-tone="down"][data-kind="income"]{color:var(--pf-fin-over-budget)}
.pf-rp-var[data-tone="down"][data-kind="expense"],.pf-rp-var[data-tone="up"][data-kind="income"]{color:var(--pf-fin-ok)}
.pf-rp-drill{border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-md);padding:var(--pf-space-3);background:var(--pf-surface-raised);display:grid;gap:var(--pf-space-3);align-content:start;min-width:0}
.pf-rp-link{background:none;border:0;padding:0;color:var(--pf-primary);text-decoration:underline;cursor:pointer;font:inherit;text-align:left}
.pf-rp-btn{display:inline-block;padding:var(--pf-space-2) var(--pf-space-3);border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-sm);text-decoration:none;color:inherit}
`;

const translate = (f: FormatContext, key: string, fallback: string): string =>
  f.has(key) ? f.t(key) : fallback;

/** `12.000,00 BOB` por moneda, separados; o el texto de "sin movimientos". */
export function NativeList({ amounts, f }: { amounts: readonly Money[]; f: FormatContext }) {
  if (amounts.length === 0) return <span>—</span>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {amounts.map((m) => (
        <li key={m.currency}>{formatMoney(m, f.locale)}</li>
      ))}
    </ul>
  );
}

/** Aviso de cifra incompleta: lista los montos excluidos por falta de tasa (nunca se convierten 1:1). */
export function IncompleteNote({ amount, f }: { amount: ReportAmount; f: FormatContext }) {
  if (amount.complete) return null;
  return (
    <small style={warningStyle} role="note" data-testid="incomplete-note">
      {' '}
      {f.t('incomplete.short', {
        amounts: amount.unconverted.map((m) => formatMoney(m, f.locale)).join(', '),
      })}
    </small>
  );
}

/** Cifra consolidada con aviso de incompleta. */
export function ConsolidatedCell({ amount, f }: { amount: ReportAmount; f: FormatContext }) {
  return (
    <>
      <span>{formatMoney(amount.consolidated, f.locale)}</span>
      <IncompleteNote amount={amount} f={f} />
    </>
  );
}

/** Variación con texto e icono además del color (WCAG 1.4.1); `kind` decide si subir es bueno (ingreso) o malo (gasto). */
export function VariationCell({
  v,
  kind,
  f,
}: {
  v: Pick<ReportVariation, 'deltaAbs' | 'deltaPct' | 'isNew'>;
  kind: 'income' | 'expense' | 'neutral';
  f: FormatContext;
}) {
  const tone: VariationTone = toneOf(v);
  return (
    <span className="pf-rp-var" data-tone={tone} data-kind={kind} data-testid="variation">
      <span aria-hidden="true">{TONE_ICON[tone]} </span>
      <span
        className="sr-only"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
      >
        {f.t(`variation.${tone}`)}{' '}
      </span>
      {variationText(v, f)}
    </span>
  );
}

/** Bloque "Cómo se convirtió": política, moneda de reporte, ventana de vigencia y cada tasa usada con tipo, fuente y fecha. */
export function ConversionBlock({ meta, f }: { meta: ReportMeta; f: FormatContext }) {
  const c = meta.conversion;
  return (
    <details data-testid="conversion-block" open>
      <summary>{f.t('conversion.title')}</summary>
      <p>
        {f.t(`conversion.policy.${c.policy}`, { date: c.cutoffDate ?? '' })}{' '}
        {f.t('conversion.reporting', { currency: meta.reportingCurrency, days: c.rateWindowDays })}
      </p>
      {c.ratesUsed.length === 0 ? (
        <p style={mutedStyle}>{f.t('conversion.none')}</p>
      ) : (
        <ul>
          {c.ratesUsed.map((r, i) => (
            <li key={i}>
              {f.t('conversion.rate', {
                base: r.rate.base,
                quote: r.rate.quote,
                value: formatDecimal(r.rate.value, f.locale),
                type: r.rateType,
                source: r.provider ?? r.source,
                date: formatLocalDate(r.asOf.slice(0, 10), f.locale),
              })}
            </li>
          ))}
        </ul>
      )}
      {!meta.complete && (
        <p role="note" style={warningStyle}>
          {f.t('incomplete.report', {
            amounts: meta.unconverted.map((m) => formatMoney(m, f.locale)).join(', '),
          })}
        </p>
      )}
      {c.attributions.length > 0 && <p style={mutedStyle}>{c.attributions.join(' · ')}</p>}
    </details>
  );
}

/** Tabla de datos equivalente a un gráfico (NFR-USAB-105): encabezados de columna, leyenda y desplazamiento accesible. */
export function DataTable({
  caption,
  headers,
  children,
  label,
}: {
  caption: string;
  headers: readonly string[];
  children: ReactNode;
  label: string;
}) {
  return (
    <div style={tableWrapStyle} role="region" aria-label={label} tabIndex={0}>
      <table style={tableStyle}>
        <caption style={{ textAlign: 'left', ...mutedStyle }}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} scope="col" style={i === 0 ? cellStyle : { ...cellStyle, textAlign: 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, num = true }: { children: ReactNode; num?: boolean }) => (
  <td style={num ? numCellStyle : cellStyle}>{children}</td>
);

const LIST_FIELDS = [
  ['accountIds', 'accounts'],
  ['currencies', 'currencies'],
  ['categoryIds', 'categories'],
  ['tagIds', 'tags'],
  ['counterpartyIds', 'counterparties'],
] as const;

export interface FiltersBarProps {
  readonly f: FormatContext;
  readonly draft: ReportFilters;
  readonly onDraft: (next: ReportFilters) => void;
  readonly onApply: () => void;
  /** Monedas habilitadas del workspace para la moneda de reporte. */
  readonly currencies: readonly string[];
  /** Mostrar y no mostrar controles según el reporte. */
  readonly show: {
    readonly grouping?: boolean;
    readonly compare?: boolean;
    readonly rolling?: boolean;
    readonly conversion?: boolean;
    readonly lists?: boolean;
    readonly granularity?: readonly string[];
    readonly topN?: boolean;
    /** Falso en los reportes sin rango (costos recurrentes). */
    readonly range?: boolean;
    readonly tagMatch?: boolean;
    readonly debtKind?: boolean;
    /** Normalizar por día sin necesidad de comparación (tendencias). */
    readonly normalize?: boolean;
    readonly account?: readonly { id: string; name: string }[];
  };
}

/** Barra de filtros común de los reportes (rango, agrupación, comparación, moneda de reporte y filtros), con estado en la URL. */
export function FiltersBar(p: FiltersBarProps) {
  const { f, draft, show } = p;
  const err = filterError(draft);
  const set = (patch: Partial<ReportFilters>) => p.onDraft({ ...draft, ...patch });
  return (
    <form
      style={formStyle}
      aria-label={f.t('filters.title')}
      data-testid="report-filters"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!err) p.onApply();
      }}
    >
      <div style={rowStyle}>
        {show.range !== false && (
          <>
            <Field
              label={f.t('filters.from')}
              error={err === 'range' ? f.t('filters.errors.range') : undefined}
            >
              {(c) => (
                <input
                  {...c}
                  type="date"
                  name="from"
                  style={inputStyle}
                  value={draft.from}
                  onChange={(e) => set({ from: e.target.value })}
                />
              )}
            </Field>
            <Field label={f.t('filters.to')}>
              {(c) => (
                <input
                  {...c}
                  type="date"
                  name="to"
                  style={inputStyle}
                  value={draft.to}
                  onChange={(e) => set({ to: e.target.value })}
                />
              )}
            </Field>
          </>
        )}
        {show.grouping && (
          <Field label={f.t('filters.grouping')}>
            {(c) => (
              <select
                {...c}
                name="grouping"
                style={inputStyle}
                value={draft.grouping}
                onChange={(e) => set({ grouping: e.target.value as ReportFilters['grouping'] })}
              >
                <option value="FINANCIAL_PERIOD">{f.t('filters.FINANCIAL_PERIOD')}</option>
                <option value="CALENDAR_MONTH">{f.t('filters.CALENDAR_MONTH')}</option>
              </select>
            )}
          </Field>
        )}
        {show.granularity && (
          <Field label={f.t('filters.granularity')}>
            {(c) => (
              <select
                {...c}
                name="granularity"
                style={inputStyle}
                value={draft.granularity || show.granularity?.[0]}
                onChange={(e) => set({ granularity: e.target.value })}
              >
                {show.granularity?.map((g) => (
                  <option key={g} value={g}>
                    {f.t(`filters.${g}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {show.account && (
          <Field label={f.t('filters.account')}>
            {(c) => (
              <select
                {...c}
                name="historyAccount"
                style={inputStyle}
                value={draft.accountId}
                onChange={(e) => set({ accountId: e.target.value })}
              >
                <option value="">{f.t('filters.accountPick')}</option>
                {show.account?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {show.tagMatch && (
          <Field label={f.t('filters.tagMatch')}>
            {(c) => (
              <select
                {...c}
                name="tagMatch"
                style={inputStyle}
                value={draft.tagMatch}
                onChange={(e) => set({ tagMatch: e.target.value as ReportFilters['tagMatch'] })}
              >
                <option value="ANY">{f.t('filters.ANY')}</option>
                <option value="ALL">{f.t('filters.ALL')}</option>
              </select>
            )}
          </Field>
        )}
        {show.debtKind && (
          <Field label={f.t('filters.debtKind')}>
            {(c) => (
              <select
                {...c}
                name="debtKind"
                style={inputStyle}
                value={draft.debtKind}
                onChange={(e) => set({ debtKind: e.target.value as ReportFilters['debtKind'] })}
              >
                <option value="">{f.t('filters.debtAll')}</option>
                <option value="LOAN">{f.t('debts.kind.LOAN')}</option>
                <option value="CARD">{f.t('debts.kind.CARD')}</option>
              </select>
            )}
          </Field>
        )}
        {show.topN && (
          <Field label={f.t('filters.topN')}>
            {(c) => (
              <input
                {...c}
                type="number"
                min={1}
                max={50}
                name="topN"
                style={inputStyle}
                value={draft.topN}
                onChange={(e) => set({ topN: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>
      <div style={rowStyle}>
        <Field label={f.t('filters.reportingCurrency')}>
          {(c) => (
            <select
              {...c}
              name="reportingCurrency"
              style={inputStyle}
              value={draft.reportingCurrency}
              onChange={(e) => set({ reportingCurrency: e.target.value })}
            >
              <option value="">{f.t('filters.baseCurrency')}</option>
              {p.currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </Field>
        {show.conversion && (
          <Field label={f.t('filters.conversion')}>
            {(c) => (
              <select
                {...c}
                name="conversion"
                style={inputStyle}
                value={draft.conversion}
                onChange={(e) => set({ conversion: e.target.value as ReportFilters['conversion'] })}
              >
                <option value="HISTORICAL">{f.t('filters.HISTORICAL')}</option>
                <option value="CUTOFF">{f.t('filters.CUTOFF')}</option>
              </select>
            )}
          </Field>
        )}
        {show.compare && (
          <Field
            label={f.t('filters.compare')}
            error={err === 'custom' ? f.t('filters.errors.custom') : undefined}
          >
            {(c) => (
              <select
                {...c}
                name="compare"
                style={inputStyle}
                value={draft.compare}
                onChange={(e) => set({ compare: e.target.value as ReportFilters['compare'] })}
              >
                <option value="NONE">{f.t('filters.NONE')}</option>
                <option value="PREVIOUS_PERIOD">{f.t('filters.PREVIOUS_PERIOD')}</option>
                <option value="PREVIOUS_YEAR">{f.t('filters.PREVIOUS_YEAR')}</option>
                <option value="PREVIOUS_PERIOD_TO_DATE">{f.t('filters.PREVIOUS_PERIOD_TO_DATE')}</option>
                <option value="CUSTOM">{f.t('filters.CUSTOM')}</option>
              </select>
            )}
          </Field>
        )}
        {show.compare && draft.compare === 'CUSTOM' && (
          <>
            <Field label={f.t('filters.compareFrom')}>
              {(c) => (
                <input
                  {...c}
                  type="date"
                  name="compareFrom"
                  style={inputStyle}
                  value={draft.compareFrom}
                  onChange={(e) => set({ compareFrom: e.target.value })}
                />
              )}
            </Field>
            <Field label={f.t('filters.compareTo')}>
              {(c) => (
                <input
                  {...c}
                  type="date"
                  name="compareTo"
                  style={inputStyle}
                  value={draft.compareTo}
                  onChange={(e) => set({ compareTo: e.target.value })}
                />
              )}
            </Field>
          </>
        )}
        {((show.compare && draft.compare !== 'NONE') || show.normalize) && (
          <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="normalize"
              checked={draft.normalize}
              onChange={(e) => set({ normalize: e.target.checked })}
            />
            {f.t('filters.normalize')}
          </label>
        )}
        {show.rolling && (
          <Field label={f.t('filters.rolling')}>
            {(c) => (
              <select
                {...c}
                name="rolling"
                style={inputStyle}
                value={draft.rolling}
                onChange={(e) => set({ rolling: e.target.value as ReportFilters['rolling'] })}
              >
                <option value="">{f.t('filters.NONE')}</option>
                <option value="3">3</option>
                <option value="6">6</option>
                <option value="12">12</option>
              </select>
            )}
          </Field>
        )}
      </div>
      {show.lists && (
        <div style={rowStyle}>
          {LIST_FIELDS.map(([key, label]) => (
            <Field key={key} label={f.t(`filters.${label}`)}>
              {(c) => (
                <input
                  {...c}
                  type="text"
                  name={key}
                  style={inputStyle}
                  placeholder={f.t('filters.idsHint')}
                  value={draft[key]}
                  onChange={(e) => set({ [key]: e.target.value } as Partial<ReportFilters>)}
                />
              )}
            </Field>
          ))}
        </div>
      )}
      <div style={rowStyle}>
        <button type="submit" disabled={err !== null}>
          {f.t('filters.apply')}
        </button>
      </div>
    </form>
  );
}

/** Panel lateral del drill-down: filas paginadas con totales de toda la celda, enlace a la transacción y exportación CSV. */
export function DrillDownPanel({
  f,
  cell,
  page,
  loadingMore,
  hasError,
  transactionHref,
  accountHistoryHref,
  exportHref,
  onMore,
  onClose,
}: {
  f: FormatContext;
  cell: DrillCell;
  page:
    | { rows: DrillDownPage['rows']; totals: ReportAmount; count: number; nextCursor: string | null }
    | undefined;
  loadingMore: boolean;
  hasError: ReactNode;
  transactionHref: (id: string) => string;
  /** Historial de saldo de una cuenta del mismo rango (drill-down del patrimonio). */
  accountHistoryHref?: (accountId: string, from: string, to: string) => string;
  exportHref: string;
  onMore: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="pf-rp-drill" aria-label={f.t('drill.title')} data-testid="drill-down">
      <header style={rowStyle}>
        <h2 style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>{cell.title}</h2>
        <button type="button" onClick={onClose}>
          {f.t('drill.close')}
        </button>
      </header>
      {hasError}
      {!page && !hasError && <p aria-busy="true">{f.t('loading')}</p>}
      {page && (
        <>
          <p data-testid="drill-totals">
            {f.t('drill.totals', { count: page.count })}{' '}
            <strong>{formatMoney(page.totals.consolidated, f.locale)}</strong>
            {page.totals.byCurrency.length > 1 &&
              ` (${page.totals.byCurrency.map((m) => formatMoney(m, f.locale)).join(' · ')})`}
          </p>
          <DataTable
            caption={f.t('drill.caption')}
            label={f.t('drill.title')}
            headers={[f.t('drill.date'), f.t('drill.description'), f.t('drill.amount'), f.t('drill.valued')]}
          >
            {page.rows.map((r) => (
              <tr
                key={r.splitId ?? r.journalEntryId ?? `${r.date}-${r.amount.amount}`}
                data-testid="drill-row"
              >
                <Td num={false}>
                  {r.transactionId ? (
                    <a href={transactionHref(r.transactionId)}>{formatLocalDate(r.date, f.locale)}</a>
                  ) : (
                    formatLocalDate(r.date, f.locale)
                  )}
                </Td>
                <Td>
                  {r.accountId && !r.transactionId && accountHistoryHref ? (
                    <a
                      href={accountHistoryHref(r.accountId, cell.from, cell.to)}
                      data-testid="drill-account-history"
                    >
                      {r.description ?? r.accountId}
                    </a>
                  ) : (
                    (r.description ?? translate(f, `drill.component.${r.component ?? ''}`, '—'))
                  )}
                </Td>
                <Td>{formatMoney(r.amount, f.locale)}</Td>
                <Td>{r.valued ? formatMoney(r.valued, f.locale) : '—'}</Td>
              </tr>
            ))}
          </DataTable>
          <div style={rowStyle}>
            {page.nextCursor && (
              <button type="button" onClick={onMore} disabled={loadingMore}>
                {f.t('drill.more')}
              </button>
            )}
            <a className="pf-rp-btn" href={exportHref} download data-testid="drill-export">
              {f.t('export')}
            </a>
          </div>
        </>
      )}
    </aside>
  );
}
