import type { FormatContext } from '../dashboard/types';
import { cardStyle, mutedStyle, rowStyle } from '../common/ui';
import { IMPORT_STAGES, type ImportJob } from './types';
import { PdfFailureDetails } from './PdfReadingPanel';
import { stageProgressOf } from './pipeline-logic';

/**
 * Procesamiento en el worker (openspec add-import-pipeline, tarea 7.1): estado «subida» o «procesando», etapa actual
 * (lectura, normalización, validación, clasificación, duplicados, coincidencias) y filas procesadas. La región es
 * `aria-live="polite"`: el lector de pantalla anuncia cada avance sin interrumpir; la barra es un `<progress>` con nombre.
 */
export function ProcessingPanel({ job, f }: { job: ImportJob; f: FormatContext }) {
  const p = stageProgressOf(job);
  const waiting = job.status === 'UPLOADED';
  return (
    <div
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="import-processing"
      data-status={job.status}
      data-stage={p.stage ?? ''}
    >
      <p style={{ margin: 0 }}>{f.t(`status.${job.status}`)}</p>
      {!waiting ? (
        <ol
          style={{ ...rowStyle, listStyle: 'none', margin: 0, padding: 0 }}
          aria-label={f.t('processing.stages')}
        >
          {IMPORT_STAGES.map((stage, i) => {
            const state =
              p.position === 0
                ? 'todo'
                : i + 1 < p.position
                  ? 'done'
                  : i + 1 === p.position
                    ? 'current'
                    : 'todo';
            return (
              <li
                key={stage}
                data-stage={stage}
                data-state={state}
                {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
                style={{
                  fontWeight: state === 'current' ? 700 : 400,
                  color: state === 'todo' ? 'var(--pf-fg-muted)' : 'var(--pf-fg)',
                }}
              >
                <span aria-hidden="true">{state === 'done' ? '✓ ' : state === 'current' ? '▸ ' : '· '}</span>
                {f.t(`processing.stage.${stage}`)}
                {state === 'done' ? <span className="pf-sr-only"> ({f.t('steps.done')})</span> : null}
                {state === 'current' ? <span className="pf-sr-only"> ({f.t('steps.current')})</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      <progress
        max={Math.max(p.fileRows, 1)}
        value={p.processed}
        aria-label={f.t('processing.bar')}
        data-testid="import-processing-bar"
        data-percent={p.percent}
      />
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="import-processing-live">
        {waiting
          ? f.t('processing.queued')
          : p.stage
            ? f.t('processing.live', {
                stage: f.t(`processing.stage.${p.stage}`),
                processed: p.processed,
                total: p.fileRows,
              })
            : f.t('processing.starting')}
      </div>
    </div>
  );
}

/** «Falló la lectura»: código, ubicación técnica (nunca texto del archivo) y salida para volver a empezar. */
export function ParseFailedPanel({
  job,
  f,
  message,
  newHref,
}: {
  job: ImportJob;
  f: FormatContext;
  /** Texto traducido del código de error (catálogo de errores). */
  message: (code: string) => string;
  newHref: string;
}) {
  const code = job.failure?.code ?? 'IMPORT_PARSE_FAILED';
  const pointer = job.failure?.pointer ?? null;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="import-parse-failed" role="alert">
      <p style={{ margin: 0 }}>
        <strong>{f.t('parseFailed.title')}</strong> {message(code)}
      </p>
      {pointer ? (
        <p style={{ ...mutedStyle, margin: 0 }} data-testid="import-parse-failed-pointer">
          {f.t('parseFailed.where')} <code>{pointer}</code>
        </p>
      ) : null}
      <PdfFailureDetails job={job} f={f} />
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('parseFailed.noRows')}</p>
      <p style={{ margin: 0 }}>
        <a href={newHref}>{f.t('result.importAnother')}</a>
      </p>
    </div>
  );
}
