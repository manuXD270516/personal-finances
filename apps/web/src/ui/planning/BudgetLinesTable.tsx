import { cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { formatMoney, formatSignedMoney } from '../dashboard/format';
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import { BudgetStatusBadge } from './BudgetStatus';
import {
  barValue,
  projectionExceeds,
  settlementOf,
  type Budget,
  type BudgetLine,
  type BudgetTargetKind,
} from './budget-logic';

/** Nombres de los objetivos por tipo (catálogos de CLASSIFICATION, incluidos los archivados). */
export interface TargetNames {
  readonly CATEGORY: ReadonlyMap<string, string>;
  readonly GROUP: ReadonlyMap<string, string>;
  readonly TAG: ReadonlyMap<string, string>;
}

export const targetName = (names: TargetNames, kind: BudgetTargetKind, id: string): string =>
  names[kind].get(id) ?? id;

function Plan({ line, f }: { line: BudgetLine; f: FormatContext }) {
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, f.locale);
  const p = line.progress;
  return (
    <>
      {line.kind === 'RANGE' && line.min && line.max ? (
        <span>{f.t('lines.range', { min: money(line.min), max: money(line.max) })}</span>
      ) : line.kind === 'PERCENT_OF_INCOME' && line.percent ? (
        <span>
          {money(p.effectivePlanned)}
          <br />
          <small style={mutedStyle}>
            {f.t('lines.percentOf', {
              percent: formatDecimal(line.percent, f.locale),
              basis: f.t(`basis.${line.incomeBasis ?? 'EXPECTED'}`),
            })}
          </small>
        </span>
      ) : (
        <span>{money(p.reference)}</span>
      )}
      {p.rolloverIn && p.rolloverStatus !== 'NONE' ? (
        <>
          <br />
          <small style={mutedStyle} data-testid="line-rollover" data-rollover-status={p.rolloverStatus}>
            {f.t('lines.rolloverIn', {
              amount: formatSignedMoney(p.rolloverIn, f.locale),
              status: f.t(`rollover.${p.rolloverStatus}`),
            })}
          </small>
        </>
      ) : null}
    </>
  );
}

function Projection({ line, f }: { line: BudgetLine; f: FormatContext }) {
  const settlement = settlementOf(line);
  if (settlement) {
    return (
      <span data-testid="line-settlement" data-settlement={settlement}>
        {f.t(`lines.settlement.${settlement}`)}
      </span>
    );
  }
  const projection = line.progress.projection;
  if (!projection) return <span aria-label={f.t('lines.noProjection')}>—</span>;
  return (
    <span>
      {formatMoney(projection, f.locale)}
      {projectionExceeds(line) ? (
        <>
          <br />
          <small data-testid="line-projection-exceeds" style={{ color: 'var(--pf-fin-over-budget)' }}>
            <span aria-hidden="true">▲</span> {f.t('lines.projectionExceeds')}
          </small>
        </>
      ) : null}
    </span>
  );
}

/**
 * Líneas del plan con planificado, gastado, restante, % de uso, proyección (solo máximo, rango y % de ingresos; fijo y
 * mínimo muestran pendiente/cumplido, docs/33 D83), estado con texto + icono y umbrales cruzados (openspec add-budgets
 * 6.1). Las líneas de ingreso muestran el real y su diferencia con lo esperado. Presentacional.
 */
export function BudgetLinesTable({
  budget,
  names,
  f,
  canEdit,
  editingId,
  busyId,
  onEdit,
  onRemove,
}: {
  budget: Budget;
  names: TargetNames;
  f: FormatContext;
  canEdit: boolean;
  editingId?: string | undefined;
  busyId?: string | undefined;
  onEdit?: (line: BudgetLine) => void;
  onRemove?: (line: BudgetLine) => void;
}) {
  if (budget.lines.length === 0) {
    return (
      <p data-testid="budget-lines-empty" style={mutedStyle}>
        {f.t('lines.empty')}
      </p>
    );
  }
  const editable = canEdit && budget.periodStatus !== 'CLOSED';
  // `position: relative`: el texto solo-lectores (absoluto) queda recortado por el scroll de la tabla, no por la página.
  return (
    <div style={{ ...tableWrapStyle, position: 'relative' }}>
      <table style={tableStyle} data-testid="budget-lines-table">
        <caption style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}>
          {f.t('lines.caption')}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.target')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('lines.columns.planned')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('lines.columns.actual')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('lines.columns.remaining')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.usage')}
            </th>
            <th scope="col" style={numCellStyle}>
              {f.t('lines.columns.projection')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.thresholds')}
            </th>
            {editable ? (
              <th scope="col" style={cellStyle}>
                {f.t('lines.columns.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {budget.lines.map((line) => {
            const p = line.progress;
            const name = targetName(names, line.target.kind, line.target.id);
            const bar = barValue(p.utilization);
            return (
              <tr
                key={line.id}
                data-line-id={line.id}
                data-target-id={line.target.id}
                data-kind={line.kind}
                aria-current={editingId === line.id ? 'true' : undefined}
              >
                <th scope="row" style={{ ...cellStyle, fontWeight: 600 }}>
                  {name}
                  <br />
                  <small style={{ ...mutedStyle, fontWeight: 400 }}>
                    {f.t(`targetKind.${line.target.kind}`)} · {f.t(`kind.${line.kind}`)}
                    {line.nature === 'INCOME' ? ` · ${f.t('lines.income')}` : ''}
                  </small>
                </th>
                <td style={numCellStyle} data-testid="line-planned">
                  <Plan line={line} f={f} />
                </td>
                <td style={numCellStyle} data-testid="line-actual">
                  {formatMoney(p.actual, f.locale)}
                  {!p.actualComplete ? (
                    <>
                      <br />
                      <small data-testid="line-incomplete" style={{ color: 'var(--pf-fin-warning)' }}>
                        <span aria-hidden="true">⚠</span>{' '}
                        {f.t('lines.incomplete', {
                          amounts: p.unconverted.map((m) => formatMoney(m, f.locale)).join(', '),
                        })}
                      </small>
                    </>
                  ) : null}
                </td>
                <td style={numCellStyle} data-testid="line-remaining">
                  {line.nature === 'INCOME' ? (
                    <>
                      {formatSignedMoney(p.difference, f.locale)}
                      <br />
                      <small style={mutedStyle}>{f.t('lines.difference')}</small>
                    </>
                  ) : (
                    formatMoney(p.remaining, f.locale)
                  )}
                </td>
                <td style={cellStyle} data-testid="line-usage">
                  {p.utilization === null ? (
                    <span>—</span>
                  ) : (
                    <>
                      <progress
                        max={100}
                        value={bar ?? 0}
                        aria-label={f.t('lines.usageLabel', { name })}
                        style={{ width: '6rem', maxWidth: '100%' }}
                      />
                      <br />
                      <small>{f.t('lines.usage', { percent: formatDecimal(p.utilization, f.locale) })}</small>
                    </>
                  )}
                </td>
                <td style={numCellStyle} data-testid="line-projection">
                  <Projection line={line} f={f} />
                </td>
                <td style={cellStyle}>
                  <BudgetStatusBadge status={p.status} f={f} />
                </td>
                <td style={cellStyle} data-testid="line-thresholds">
                  {line.thresholds.length === 0 ? (
                    <span aria-label={f.t('lines.noThresholds')}>—</span>
                  ) : (
                    <ul
                      style={{
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.25rem',
                      }}
                    >
                      {line.thresholds.map((th) => {
                        const crossed = p.crossedThresholds.includes(th);
                        return (
                          <li key={th} data-crossed={crossed ? 'true' : 'false'}>
                            <small>
                              {crossed ? <span aria-hidden="true">✓ </span> : null}
                              {th} %
                              {crossed ? <span className="pf-sr-only"> {f.t('lines.crossed')}</span> : null}
                            </small>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                {editable ? (
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-2)' }}>
                      <button
                        type="button"
                        onClick={() => onEdit?.(line)}
                        disabled={busyId === line.id}
                        aria-label={f.t('lines.editLabel', { name })}
                      >
                        {f.t('lines.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove?.(line)}
                        disabled={busyId === line.id}
                        aria-label={f.t('lines.removeLabel', { name })}
                      >
                        {f.t('lines.remove')}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
