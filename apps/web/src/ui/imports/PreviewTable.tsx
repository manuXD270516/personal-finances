import { Fragment } from 'react';
import { formatMoney } from '../dashboard/format';
import { formatBusinessDate } from '../planning/logic';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import {
  badgeStyle,
  cellStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import {
  CLASSIFICATION_PRESENTATION,
  allowedDecisions,
  candidateKindKey,
  canDecide,
  isTransferCandidate,
  issueKey,
  needsDecision,
} from './logic';
import type { ImportJobStatus, ImportPreviewCandidate, ImportPreviewRow, ImportRowDecision } from './types';

export const decisionButtonId = (rowId: string, decision: ImportRowDecision): string =>
  `import-decide-${rowId}-${decision}`;

/**
 * El movimiento existente que la fila duplicaría (fecha, monto, descripción y tipo: gasto, ingreso, transferencia o
 * conversión). Si es una pata de transferencia o conversión avisa de que puede ser un pago de tarjeta o una
 * transferencia propia. La descripción es texto del usuario/archivo: se muestra como texto.
 */
export function CandidateCard({ candidate, f }: { candidate: ImportPreviewCandidate; f: FormatContext }) {
  return (
    <div
      data-testid="import-candidate"
      data-kind={candidate.kind ?? undefined}
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
    >
      <p style={{ margin: 0 }}>
        <strong>{f.t('candidate.title')}</strong>{' '}
        {candidate.date ? formatBusinessDate(candidate.date) : f.t('candidate.noDate')}
        {' · '}
        {candidate.amount ? formatMoney(candidate.amount, f.locale) : f.t('candidate.noAmount')}
        {' · '}
        {f.t(candidateKindKey(candidate.kind))}
      </p>
      {candidate.description ? <p style={{ ...mutedStyle, margin: 0 }}>{candidate.description}</p> : null}
      {isTransferCandidate(candidate) ? (
        <p style={{ ...warningStyle, margin: 0 }} data-testid="import-candidate-transfer">
          {f.t('candidate.transferWarning')}
        </p>
      ) : null}
    </div>
  );
}

/** Botones de decisión de una fila (`aria-pressed` marca la vigente). El foco se conserva: el botón no se desmonta. */
function DecisionButtons({
  row,
  f,
  busy,
  onDecide,
}: {
  row: ImportPreviewRow;
  f: FormatContext;
  busy: boolean;
  onDecide: (row: ImportPreviewRow, decision: ImportRowDecision) => void;
}) {
  const duplicate = row.classification === 'DUPLICATE_PROBABLE';
  return (
    <div role="group" aria-label={f.t('row.decideGroup', { line: row.lineNumber })} style={rowStyle}>
      {allowedDecisions(row).map((decision) => (
        <button
          key={decision}
          id={decisionButtonId(row.id, decision)}
          type="button"
          aria-pressed={row.decision === decision}
          disabled={busy}
          data-testid={`import-decide-${decision}`}
          aria-label={f.t(`row.decide.${duplicate ? 'dup' : 'new'}.${decision}Aria`, {
            line: row.lineNumber,
          })}
          onClick={() => onDecide(row, decision)}
        >
          {f.t(`row.decide.${duplicate ? 'dup' : 'new'}.${decision}`)}
        </button>
      ))}
    </div>
  );
}

function Issues({ row, f }: { row: ImportPreviewRow; f: FormatContext }) {
  if (row.issues.length === 0) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="import-row-issues">
      {row.issues.map((issue) => (
        <li key={`${issue.code}-${issue.severity}`} data-severity={issue.severity}>
          {f.t(issueKey(issue.code))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tabla de la vista previa (docs/28 §4.7): línea, fecha, descripción, monto con su sentido (entrada o salida en
 * TEXTO), clasificación con texto + icono y, para quien escribe, las decisiones de la fila. Un posible duplicado
 * muestra su candidato y exige decisión. Toda celda del archivo se renderiza como texto.
 */
export function PreviewTable({
  rows,
  f,
  status,
  canEdit,
  busyRowId,
  onDecide,
}: {
  rows: readonly ImportPreviewRow[];
  f: FormatContext;
  status: ImportJobStatus;
  canEdit: boolean;
  busyRowId?: string | undefined;
  onDecide: (row: ImportPreviewRow, decision: ImportRowDecision) => void;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('review.tableRegion')}>
      <table style={tableStyle} data-testid="import-preview">
        <caption className="pf-sr-only">{f.t('review.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('row.line')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('row.date')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('row.description')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('row.amount')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('row.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('row.decision')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detail = row.candidate !== null || row.issues.length > 0 || row.failure !== null;
            return (
              <Fragment key={row.id}>
                <tr
                  data-testid="import-row"
                  data-classification={row.classification}
                  data-decision={row.decision ?? 'NONE'}
                  data-line={row.lineNumber}
                >
                  <th scope="row" style={cellStyle}>
                    {row.lineNumber}
                  </th>
                  <td style={cellStyle}>{row.date ? formatBusinessDate(row.date) : '—'}</td>
                  <td style={cellStyle} data-testid="import-row-description">
                    {row.description ?? '—'}
                  </td>
                  <td style={numCellStyle}>
                    {row.amount && row.direction ? (
                      <>
                        <span aria-hidden="true">{row.direction === 'OUT' ? '−' : '+'}</span>
                        {formatMoney(row.amount, f.locale)}{' '}
                        <span style={mutedStyle}>({f.t(`row.direction.${row.direction}`)})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={cellStyle}>
                    <Badge
                      presentation={CLASSIFICATION_PRESENTATION[row.classification]}
                      label={f.t(`classification.${row.classification}`)}
                      status={row.classification}
                      testId="import-row-class"
                    />
                  </td>
                  <td style={cellStyle}>
                    {needsDecision(row) ? (
                      <span
                        style={{ ...badgeStyle, color: 'var(--pf-fin-warning)' }}
                        data-testid="import-row-pending"
                      >
                        {f.t('row.pending')}
                      </span>
                    ) : row.decision ? (
                      <span data-testid="import-row-decision">
                        {f.t(`row.decisionState.${row.decision}`)}
                      </span>
                    ) : null}
                    {canDecide(row, canEdit, status) ? (
                      <DecisionButtons row={row} f={f} busy={busyRowId === row.id} onDecide={onDecide} />
                    ) : null}
                  </td>
                </tr>
                {detail ? (
                  <tr data-testid="import-row-detail" data-line={row.lineNumber}>
                    <td style={cellStyle} />
                    <td style={cellStyle} colSpan={5}>
                      <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
                        <Issues row={row} f={f} />
                        {row.candidate ? <CandidateCard candidate={row.candidate} f={f} /> : null}
                        {row.failure ? (
                          <p role="note" style={{ margin: 0 }} data-testid="import-row-failure">
                            {f.t('row.failed', { reason: f.t(issueKey(row.failure.code)) })}
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
