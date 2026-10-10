import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { cardStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { canResolveFailures, errorLines, isPolling, progressPercent, resultSummaryOf } from './logic';
import type { ImportErrorGroup, ImportJob, ImportWarning } from './types';

/**
 * Progreso de la persistencia (paso 4): lotes hechos de lotes totales y transacciones creadas. La región es
 * `aria-live="polite"`: el lector de pantalla anuncia los avances sin interrumpir; la barra es un `<progress>` con nombre.
 */
export function ProgressPanel({ job, f }: { job: ImportJob; f: FormatContext }) {
  const { batchesDone, batchCount } = job.progress;
  return (
    <div
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="import-progress-panel"
    >
      <p style={{ margin: 0 }}>{f.t(`status.${job.status}`)}</p>
      <progress
        max={Math.max(batchCount, 1)}
        value={batchesDone}
        aria-label={f.t('progress.bar')}
        data-testid="import-progress-bar"
        data-percent={progressPercent(batchesDone, batchCount)}
      />
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="import-progress-live">
        {batchCount > 0
          ? f.t('progress.batches', { done: batchesDone, count: batchCount, created: job.counters.created })
          : f.t('progress.starting')}
      </div>
    </div>
  );
}

/** Grupos de filas que un lote rechazado dejó fuera: código traducido, cantidad y primeras líneas del archivo. */
export function ErrorGroups({
  groups,
  f,
  messageOf,
}: {
  groups: readonly ImportErrorGroup[];
  f: FormatContext;
  /** Texto traducido del código de error de dominio del lote (catálogo de errores). */
  messageOf: (code: string) => string;
}) {
  return (
    <ul
      style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="import-errors"
    >
      {groups.map((g) => {
        const { shown, more } = errorLines(g);
        return (
          <li key={g.code} data-error-code={g.code}>
            <strong>{messageOf(g.code)}</strong>{' '}
            <span data-testid="import-error-count">{f.t('result.errorCount', { count: g.count })}</span>
            <br />
            <span style={mutedStyle} data-testid="import-error-lines">
              {f.t('result.errorLines', { lines: shown.join(', ') })}
              {more > 0 ? ` ${f.t('result.errorMore', { count: more })}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Resumen final: filas del archivo, creadas, omitidas, ya importadas, inválidas (y fallidas si las hubo). */
export function ResultSummary({ job, f }: { job: ImportJob; f: FormatContext }) {
  const s = resultSummaryOf(job);
  const items: readonly { key: string; value: number }[] = [
    { key: 'rows', value: s.rows },
    { key: 'created', value: s.created },
    { key: 'skipped', value: s.skipped },
    { key: 'alreadyImported', value: s.alreadyImported },
    { key: 'invalid', value: s.invalid },
    ...(s.failed > 0 ? [{ key: 'failed', value: s.failed }] : []),
  ];
  return (
    <dl
      style={{ ...cardStyle, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-4)' }}
      data-testid="import-result-summary"
    >
      {items.map((item) => (
        <div key={item.key}>
          <dt style={mutedStyle}>{f.t(`result.${item.key}`)}</dt>
          <dd style={{ margin: 0, fontWeight: 600 }} data-testid={`result-${item.key}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Advertencia no bloqueante de archivo ya importado, con enlace a la importación anterior. */
export function AlreadyImportedWarning({
  warning,
  f,
  href,
}: {
  warning: ImportWarning;
  f: FormatContext;
  href: string;
}) {
  return (
    <p role="status" style={{ ...warningStyle, margin: 0 }} data-testid="import-already-warning">
      {f.t('warnings.IMPORT_FILE_ALREADY_IMPORTED', {
        date: formatBusinessDate(warning.previousImportedAt),
      })}{' '}
      <a href={href} data-testid="import-previous-link">
        {f.t('warnings.previousLink')}
      </a>
    </p>
  );
}

/** Acciones del resultado (enlaces a Transacciones y a nueva importación). */
export function ResultLinks({
  f,
  transactionsHref,
  newHref,
  listHref,
}: {
  f: FormatContext;
  transactionsHref: string;
  newHref: string;
  listHref: string;
}) {
  return (
    <nav aria-label={f.t('result.linksLabel')} style={rowStyle}>
      <a href={transactionsHref} data-testid="result-transactions-link">
        {f.t('result.viewTransactions')}
      </a>
      <a href={newHref}>{f.t('result.importAnother')}</a>
      <a href={listHref}>{f.t('backToList')}</a>
    </nav>
  );
}

/**
 * Paso 4 (Resultado) según el estado: progreso mientras se crean las transacciones, resumen al completar, grupos de
 * errores con "Reintentar" y "Aceptar el resultado parcial" cuando algún lote fue rechazado, o aviso de cancelación.
 */
export function ResultStep({
  job,
  f,
  canEdit,
  busy,
  messageOf,
  transactionsHref,
  newHref,
  listHref,
  onRetry,
  onAccept,
}: {
  job: ImportJob;
  f: FormatContext;
  canEdit: boolean;
  busy: boolean;
  messageOf: (code: string) => string;
  transactionsHref: string;
  newHref: string;
  listHref: string;
  onRetry: () => void;
  onAccept: () => void;
}) {
  const running = isPolling(job.status);
  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
      data-testid="import-result"
      data-status={job.status}
    >
      {running ? <ProgressPanel job={job} f={f} /> : null}

      {job.status === 'COMPLETED' ? (
        <p role="status" data-testid="import-done">
          {f.t('result.completed', { count: job.counters.created })}
        </p>
      ) : null}
      {job.status === 'PARTIALLY_FAILED' ? (
        <p role="alert" data-testid="import-partial">
          {f.t('result.partial', { created: job.counters.created, failed: job.counters.failed })}
        </p>
      ) : null}
      {job.status === 'COMPLETED_WITH_ERRORS' ? (
        <p role="status" data-testid="import-accepted-errors">
          {f.t('result.acceptedErrors', { created: job.counters.created, failed: job.counters.failed })}
        </p>
      ) : null}
      {job.status === 'CANCELLED' ? (
        <p role="status" data-testid="import-cancelled">
          {f.t('result.cancelled')}
        </p>
      ) : null}

      {!running && job.status !== 'CANCELLED' ? <ResultSummary job={job} f={f} /> : null}
      {job.errors.length > 0 && !running ? (
        <ErrorGroups groups={job.errors} f={f} messageOf={messageOf} />
      ) : null}

      {canResolveFailures(canEdit, job.status) ? (
        <div style={rowStyle}>
          <button type="button" disabled={busy} onClick={onRetry} data-testid="import-retry">
            {f.t('result.retry')}
          </button>
          <button type="button" disabled={busy} onClick={onAccept} data-testid="import-accept-errors">
            {f.t('result.accept')}
          </button>
        </div>
      ) : null}

      {!running ? (
        <ResultLinks f={f} transactionsHref={transactionsHref} newHref={newHref} listHref={listHref} />
      ) : null}
    </div>
  );
}
