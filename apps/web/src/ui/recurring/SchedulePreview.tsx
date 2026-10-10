import { mutedStyle, warningStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import type { Preview } from './logic';

const weekdayOf = (date: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * Vista previa de las próximas fechas de la definición (calculada en el cliente con el shared-kernel): el vencimiento con
 * el ajuste de fin de semana aplicado (la fecha nominal se muestra cuando difiere) y el aviso de fin de mes cuando el
 * ancla es el día 29–31 (los meses más cortos caen en su último día, FR-COMMITMENTS-005).
 */
export function SchedulePreview({ preview, f }: { preview: Preview; f: FormatContext }) {
  return (
    <section aria-labelledby="schedule-preview-title" data-testid="schedule-preview">
      <h3 id="schedule-preview-title" style={{ fontSize: '1rem', margin: '0 0 var(--pf-space-2)' }}>
        {f.t('preview.title')}
      </h3>
      {!preview.ok ? (
        <p style={mutedStyle} data-testid="preview-unavailable" data-error-code={preview.code}>
          {f.t('preview.unavailable')}
        </p>
      ) : (
        <>
          {preview.dates.length === 0 ? (
            <p style={mutedStyle}>{f.t('preview.none')}</p>
          ) : (
            <ol aria-live="polite" style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="preview-dates">
              {preview.dates.map((d) => (
                <li key={d.nominal} data-nominal={d.nominal} data-due={d.due}>
                  <span>
                    {weekdayOf(d.due, f.locale)} {formatBusinessDate(d.due)}
                  </span>
                  {d.adjusted ? (
                    <span style={mutedStyle}>
                      {' '}
                      —{' '}
                      {f.t('preview.adjusted', {
                        date: `${weekdayOf(d.nominal, f.locale)} ${formatBusinessDate(d.nominal)}`,
                      })}
                    </span>
                  ) : null}
                  {d.monthEnd ? <span style={mutedStyle}> — {f.t('preview.monthEnd')}</span> : null}
                </li>
              ))}
            </ol>
          )}
          {preview.endOfMonthDay !== null ? (
            <p
              role="note"
              style={{ ...warningStyle, marginTop: 'var(--pf-space-2)' }}
              data-testid="month-end-warning"
            >
              <span aria-hidden="true">⚠</span>{' '}
              {f.t('preview.monthEndWarning', { day: preview.endOfMonthDay })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
