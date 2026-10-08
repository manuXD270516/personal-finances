import { formatDecimal } from '../AuditHistory';
import { cellStyle, mutedStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { targetName, type TargetNames } from './BudgetLinesTable';
import type { LineSpec, TemplateLine } from './template-logic';

/**
 * Resumen de una especificación de línea en una frase corta (monto según el tipo): fijo y máximo muestran el monto,
 * el mínimo su piso, el rango sus dos extremos y el % de ingresos su porcentaje y base. `fb` es el namespace
 * `Budgets` (etiquetas de tipos y bases compartidas con el plan).
 */
export function SpecSummary({ spec, fb }: { spec: LineSpec; fb: FormatContext }) {
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, fb.locale);
  let main: string;
  if (spec.kind === 'RANGE' && spec.min && spec.max) {
    main = fb.t('lines.range', { min: money(spec.min), max: money(spec.max) });
  } else if (spec.kind === 'PERCENT_OF_INCOME' && spec.percent) {
    main = fb.t('lines.percentOf', {
      percent: formatDecimal(spec.percent, fb.locale),
      basis: fb.t(`basis.${spec.incomeBasis ?? 'EXPECTED'}`),
    });
  } else if (spec.kind === 'MINIMUM' && spec.min) {
    main = money(spec.min);
  } else {
    main = spec.planned ? money(spec.planned) : '—';
  }
  return (
    <span>
      <strong>{fb.t(`kind.${spec.kind}`)}</strong> {main}
    </span>
  );
}

/**
 * Líneas de una versión de template (o de su borrador): objetivo, tipo y monto, umbrales y remanente. Solo lectura
 * salvo que se pasen `onEdit` / `onRemove` (borrador de una versión nueva).
 */
export function TemplateLinesTable({
  lines,
  names,
  f,
  fb,
  caption,
  onEdit,
  onRemove,
}: {
  lines: readonly TemplateLine[];
  names: TargetNames;
  f: FormatContext;
  fb: FormatContext;
  caption: string;
  onEdit?: (line: TemplateLine) => void;
  onRemove?: (line: TemplateLine) => void;
}) {
  if (lines.length === 0) {
    return (
      <p style={mutedStyle} data-testid="template-lines-empty">
        {f.t('lines.empty')}
      </p>
    );
  }
  const editable = Boolean(onEdit || onRemove);
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="template-lines">
        <caption style={{ textAlign: 'left' }}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.target')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.spec')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.thresholds')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.rollover')}
            </th>
            {editable ? (
              <th scope="col" style={cellStyle}>
                {f.t('lines.columns.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const name = targetName(names, line.target.kind, line.target.id);
            return (
              <tr key={line.id} data-testid="template-line">
                <th scope="row" style={{ ...cellStyle, textAlign: 'left' }}>
                  {name}
                  <br />
                  <small style={mutedStyle}>
                    {fb.t(`targetKind.${line.target.kind}`)}
                    {line.nature === 'INCOME' ? ` · ${fb.t('lines.income')}` : ''}
                  </small>
                </th>
                <td style={cellStyle}>
                  <SpecSummary spec={line} fb={fb} />
                </td>
                <td style={cellStyle}>
                  {line.thresholds.length > 0 ? (
                    `${line.thresholds.join(', ')} %`
                  ) : (
                    <span aria-label={fb.t('lines.noThresholds')}>—</span>
                  )}
                </td>
                <td style={cellStyle}>{fb.t(`rolloverPolicy.${line.rolloverPolicy}`)}</td>
                {editable ? (
                  <td style={cellStyle}>
                    {onEdit ? (
                      <button
                        type="button"
                        onClick={() => onEdit(line)}
                        aria-label={fb.t('lines.editLabel', { name })}
                      >
                        {fb.t('lines.edit')}
                      </button>
                    ) : null}{' '}
                    {onRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(line)}
                        aria-label={fb.t('lines.removeLabel', { name })}
                      >
                        {fb.t('lines.remove')}
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
  );
}
