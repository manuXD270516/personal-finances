import type { ReactNode } from 'react';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { cardStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import type { ClassificationFilter } from './logic';
import type { ImportPreviewSummary } from './types';

/** Aviso permanente: las transferencias propias y los pagos de tarjeta no se importan como gasto o ingreso. */
export function TransferNotice({ f }: { f: FormatContext }) {
  return (
    <p style={{ ...warningStyle, margin: 0 }} data-testid="import-transfer-notice">
      {f.t('review.transferNotice')}
    </p>
  );
}

/** Conteos de la vista previa y decisiones pendientes (el resumen se calcula sobre todo el archivo). */
export function SummaryCounts({ summary, f }: { summary: ImportPreviewSummary; f: FormatContext }) {
  const c = summary.counts;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-1)' }} data-testid="import-summary">
      <p style={{ margin: 0 }} data-testid="import-summary-counts">
        {f.t('review.counts', {
          rows: c.rows,
          newRows: c.new,
          already: c.alreadyImported,
          duplicates: c.probableDuplicates,
          invalid: c.invalid,
        })}
      </p>
      <p style={{ margin: 0 }} role="status" data-testid="import-pending" data-pending={c.pendingDecisions}>
        {c.pendingDecisions > 0
          ? f.t('review.pending', { count: c.pendingDecisions })
          : f.t('review.noPending')}
      </p>
    </div>
  );
}

/** Filtro por clasificación: botones con `aria-pressed` y el conteo de cada una. */
export function FilterBar({
  summary,
  f,
  value,
  onChange,
}: {
  summary: ImportPreviewSummary;
  f: FormatContext;
  value: ClassificationFilter;
  onChange: (value: ClassificationFilter) => void;
}) {
  const c = summary.counts;
  const filters: readonly { value: ClassificationFilter; label: string }[] = [
    { value: '', label: f.t('filters.all', { count: c.rows }) },
    { value: 'NEW', label: f.t('filters.NEW', { count: c.new }) },
    {
      value: 'DUPLICATE_PROBABLE',
      label: f.t('filters.DUPLICATE_PROBABLE', { count: c.probableDuplicates }),
    },
    { value: 'DUPLICATE_EXACT', label: f.t('filters.DUPLICATE_EXACT', { count: c.alreadyImported }) },
    { value: 'INVALID', label: f.t('filters.INVALID', { count: c.invalid }) },
  ];
  return (
    <div role="group" aria-label={f.t('filters.label')} style={rowStyle} data-testid="import-filters">
      {filters.map((x) => (
        <button
          key={x.value || 'all'}
          type="button"
          aria-pressed={value === x.value}
          data-testid={`import-filter-${x.value || 'ALL'}`}
          onClick={() => onChange(x.value)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Resumen previo a la aprobación (ConfirmDialog con resumen, docs/28 §4.7): filas a crear, Σ de salidas y de entradas,
 * saldo actual → resultante y que las transacciones quedan SIN categoría (se categorizan después con la edición masiva
 * de Transacciones).
 */
export function ApproveSummary({
  summary,
  f,
  transactionsHref,
}: {
  summary: ImportPreviewSummary;
  f: FormatContext;
  transactionsHref: string;
}): ReactNode {
  const c = summary.counts;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-1)' }} data-testid="import-approve-summary">
      <p style={{ margin: 0 }} data-testid="approve-to-create">
        {f.t('approve.toCreate', { count: c.toCreate })}
      </p>
      {c.skipped > 0 || c.excluded > 0 ? (
        <p style={{ margin: 0 }}>{f.t('approve.notCreated', { skipped: c.skipped, excluded: c.excluded })}</p>
      ) : null}
      <p style={{ margin: 0 }} data-testid="approve-flows">
        {f.t('approve.flows', {
          outflows: formatMoney(summary.outflows, f.locale),
          inflows: formatMoney(summary.inflows, f.locale),
        })}
      </p>
      <p style={{ margin: 0 }} data-testid="approve-balance">
        {f.t('approve.balance', {
          current: formatMoney(summary.currentBalance, f.locale),
          resulting: formatMoney(summary.resultingBalance, f.locale),
        })}
      </p>
      <p style={{ margin: 0 }} data-testid="approve-uncategorized">
        {f.t('approve.uncategorized')}{' '}
        <a href={transactionsHref} data-testid="approve-bulk-link">
          {f.t('approve.bulkLink')}
        </a>
      </p>
    </div>
  );
}

/** Caja de totales del paso de revisión (salidas, entradas y saldo resultante de lo que se va a crear). */
export function TotalsCard({ summary, f }: { summary: ImportPreviewSummary; f: FormatContext }) {
  return (
    <dl
      style={{ ...cardStyle, margin: 0, display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="import-totals"
    >
      <div>
        <dt style={mutedStyle}>{f.t('totals.toCreate')}</dt>
        <dd style={{ margin: 0 }}>{summary.counts.toCreate}</dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('totals.outflows')}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(summary.outflows, f.locale)}</dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('totals.inflows')}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(summary.inflows, f.locale)}</dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('totals.currentBalance')}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(summary.currentBalance, f.locale)}</dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('totals.resultingBalance')}</dt>
        <dd style={{ margin: 0 }} data-testid="totals-resulting">
          {formatMoney(summary.resultingBalance, f.locale)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Barra de aprobación del paso de revisión: "Aprobar N transacciones" queda deshabilitado mientras haya decisiones
 * pendientes (con el motivo y cuántas faltan, asociado por `aria-describedby`). Un VIEWER no ve acciones de escritura.
 */
export function ApproveBar({
  f,
  canEdit,
  approvable,
  pending,
  toCreate,
  onApprove,
  actions,
}: {
  f: FormatContext;
  canEdit: boolean;
  approvable: boolean;
  pending: number;
  toCreate: number;
  onApprove: () => void;
  actions?: ReactNode;
}) {
  if (!canEdit) {
    return (
      <p style={mutedStyle} data-testid="import-viewer-note">
        {f.t('viewerNotice')}
      </p>
    );
  }
  const blocked = !approvable && pending > 0;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <div style={rowStyle}>
        <button
          type="button"
          disabled={!approvable}
          aria-describedby={blocked ? 'import-approve-blocked' : undefined}
          onClick={onApprove}
          data-testid="import-approve"
        >
          {f.t('review.approve', { count: toCreate })}
        </button>
        {actions}
      </div>
      {blocked ? (
        <p id="import-approve-blocked" style={mutedStyle} data-testid="import-approve-blocked">
          {f.t('review.approveBlocked', { count: pending })}
        </p>
      ) : null}
    </div>
  );
}
