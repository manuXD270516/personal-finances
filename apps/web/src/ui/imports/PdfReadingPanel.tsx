import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { mutedStyle, warningStyle } from '../common/ui';
import { pdfFailureLines } from './pipeline-logic';
import type { ImportJob } from './types';

/**
 * Lectura de un extracto PDF (openspec add-pdf-statement-parser, tarea 6.1). En la vista previa: el diseño detectado
 * con su versión, las páginas leídas, la coherencia de los saldos del extracto con los movimientos, la diferencia del
 * saldo inicial con la cuenta y la advertencia de cuenta sin verificar. Solo estructura y conteos: ningún texto del
 * extracto (lo que viaja en `job.pdf` ya no lo trae).
 */
export function PdfReadingPanel({
  job,
  f,
  onPinLayout,
  busy = false,
}: {
  job: ImportJob;
  f: FormatContext;
  /** Fija el diseño y su versión en un perfil PDF de la cuenta (sin edición de columnas); solo quien escribe. */
  onPinLayout?: () => void;
  busy?: boolean;
}) {
  const pdf = job.pdf;
  if (job.format !== 'PDF' || !pdf) return null;
  const locale = f.locale;
  return (
    <section
      aria-labelledby="import-pdf-title"
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="import-pdf"
    >
      <h3 id="import-pdf-title" style={{ margin: 0 }}>
        {f.t('pdf.title')}
      </h3>
      {pdf.layout ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-layout">
          {f.t('pdf.layout', { id: pdf.layout.id, version: pdf.layout.version })}
        </p>
      ) : null}
      <p style={{ margin: 0 }} data-testid="import-pdf-pages">
        {pdf.pagesDeclared !== null
          ? f.t('pdf.pages', { read: pdf.pagesRead, declared: pdf.pagesDeclared })
          : f.t('pdf.pagesOnly', { read: pdf.pagesRead })}
      </p>
      {pdf.coherence?.totals === 'OK' ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-coherence">
          {f.t('pdf.coherenceOk')}
        </p>
      ) : null}
      {pdf.coherence?.balanceChain === 'GAPS' ? (
        <p style={{ ...warningStyle, margin: 0 }} data-testid="import-pdf-chain">
          {f.t('pdf.chainGaps')}
        </p>
      ) : null}
      {pdf.openingDifference ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-opening" data-amount={pdf.openingDifference.amount}>
          {/^[-+]?0*(\.0*)?$/u.test(pdf.openingDifference.amount)
            ? f.t('pdf.openingMatches')
            : f.t('pdf.openingDifference', { amount: formatMoney(pdf.openingDifference, locale) })}
          {!/^[-+]?0*(\.0*)?$/u.test(pdf.openingDifference.amount) ? (
            <span style={mutedStyle}> {f.t('pdf.openingHint')}</span>
          ) : null}
        </p>
      ) : null}
      {onPinLayout && pdf.layout && !job.mappingProfile ? (
        <p style={{ margin: 0 }}>
          <button type="button" disabled={busy} data-testid="import-pdf-pin" onClick={onPinLayout}>
            {f.t('pdf.pin', { id: pdf.layout.id, version: pdf.layout.version })}
          </button>{' '}
          <span style={mutedStyle}>{f.t('pdf.pinHint')}</span>
        </p>
      ) : null}
      {pdf.warnings.map((w) => (
        <p
          key={w}
          style={{ ...warningStyle, margin: 0 }}
          role="status"
          data-testid={`import-pdf-warning-${w}`}
        >
          {f.t(`pdf.warning.${w}`)}
        </p>
      ))}
    </section>
  );
}

/** Detalle de una lectura fallida (páginas sin texto, líneas no leídas, diferencia, páginas y motivo de la extracción). */
export function PdfFailureDetails({ job, f }: { job: ImportJob; f: FormatContext }) {
  const pdf = job.pdf;
  if (!pdf) return null;
  const lines = pdfFailureLines(pdf);
  const difference = pdf.coherence?.difference ?? null;
  if (
    lines.layout === null &&
    lines.noText === null &&
    lines.unrecognized === null &&
    difference === null &&
    lines.pages === null &&
    lines.reason === null
  ) {
    return null;
  }
  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="import-pdf-failure"
      aria-label={f.t('pdf.failure.title')}
    >
      {lines.layout ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('pdf.failure.layout', lines.layout)}</p>
      ) : null}
      {lines.noText ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-pages-without-text">
          {f.t('pdf.failure.noText', { pages: lines.noText })}
        </p>
      ) : null}
      {lines.pages ? <p style={{ margin: 0 }}>{f.t('pdf.failure.pages', lines.pages)}</p> : null}
      {difference ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-difference">
          {f.t('pdf.failure.difference', { amount: formatMoney(difference, f.locale) })}
        </p>
      ) : null}
      {lines.unrecognized ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-unrecognized">
          {f.t('pdf.failure.unrecognized', { lines: lines.unrecognized })}
        </p>
      ) : null}
      {lines.reason ? (
        <p style={{ margin: 0 }} data-testid="import-pdf-reason">
          {f.t(`pdf.failure.reason.${lines.reason}`)}
        </p>
      ) : null}
    </div>
  );
}
