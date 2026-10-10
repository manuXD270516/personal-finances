import { cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { AmountText, DefinitionStatusBadge } from './Badges';
import { definitionPath } from './logic';
import type { RecurringDefinition } from './types';

/** "Mensual" o "Mensual (cada 2)" según el intervalo de la versión vigente. */
export function cadenceSummary(definition: RecurringDefinition, f: FormatContext): string {
  const { cadence, interval } = definition.current.schedule;
  const name = f.t(`cadences.${cadence}`);
  return cadence !== 'CUSTOM' && interval > 1 ? f.t('everyN', { cadence: name, interval }) : name;
}

/**
 * Lista de definiciones: estado (texto + icono), próxima fecha de vencimiento, monto o rango de la versión vigente,
 * frecuencia y ocurrencias por aprobar. El nombre enlaza al detalle.
 */
export function DefinitionsList({
  definitions,
  f,
  accountName,
  href,
}: {
  definitions: readonly RecurringDefinition[];
  f: FormatContext;
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
}) {
  if (definitions.length === 0)
    return (
      <p style={mutedStyle} data-testid="definitions-empty">
        {f.t('definitions.empty')}
      </p>
    );
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="definitions-table">
        <caption className="pf-sr-only">{f.t('definitions.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.name')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.next')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('columns.amount')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.schedule')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('columns.toApprove')}
            </th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((d) => (
            <tr
              key={d.id}
              data-testid="definition-row"
              data-definition-id={d.id}
              data-name={d.name}
              data-status={d.status}
            >
              <td style={cellStyle}>
                <a href={href(definitionPath(d.id))} data-testid="definition-link">
                  {d.name}
                </a>
                <div style={mutedStyle}>
                  {f.t(`kinds.${d.kind}`)} · {accountName(d.current.accountId) ?? '—'}
                  {d.current.toAccountId ? ` → ${accountName(d.current.toAccountId) ?? '—'}` : ''} ·{' '}
                  {f.t(`modes.${d.current.materialization.mode}`)}
                </div>
              </td>
              <td style={cellStyle}>
                <DefinitionStatusBadge status={d.status} f={f} />
              </td>
              <td style={cellStyle}>
                {d.nextOccurrence ? formatBusinessDate(d.nextOccurrence.dueDate) : f.t('definitions.noNext')}
              </td>
              <td style={numCellStyle}>
                <AmountText expected={d.current.amount} f={f} />
              </td>
              <td style={cellStyle}>{cadenceSummary(d, f)}</td>
              <td style={numCellStyle} data-testid="pending-approval-count">
                {d.pendingApprovalCount ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
