import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { cardStyle, mutedStyle } from '../common/ui';
import { JOB_PRESENTATION, formatBytes } from './logic';
import type { ImportJob } from './types';

const DELIMITER_KEY: Readonly<Record<string, string>> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

/**
 * Datos de la importación: archivo (nombre saneado por la API; texto no confiable), cuenta, codificación y separador
 * detectados, número de columnas y estado (texto + icono).
 */
export function FileInfo({
  job,
  f,
  accountName,
}: {
  job: ImportJob;
  f: FormatContext;
  accountName: string | undefined;
}) {
  return (
    <dl
      style={{
        ...cardStyle,
        margin: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--pf-space-2) var(--pf-space-6)',
      }}
      data-testid="import-file-info"
    >
      <div>
        <dt style={mutedStyle}>{f.t('info.file')}</dt>
        <dd style={{ margin: 0 }} data-testid="import-file-name">
          {job.originalName ?? '—'} <span style={mutedStyle}>({formatBytes(job.fileSizeBytes)})</span>
        </dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('info.account')}</dt>
        <dd style={{ margin: 0 }}>{accountName ?? '—'}</dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('info.detected')}</dt>
        <dd style={{ margin: 0 }} data-testid="import-detected">
          {f.t('info.detectedValue', {
            encoding: f.t(`info.encoding.${job.detected.encoding === 'utf-8' ? 'utf8' : 'windows1252'}`),
            delimiter: f.t(`info.delimiter.${DELIMITER_KEY[job.detected.delimiter] ?? 'comma'}`),
            columns: job.columnCount,
          })}
        </dd>
      </div>
      <div>
        <dt style={mutedStyle}>{f.t('info.status')}</dt>
        <dd style={{ margin: 0 }}>
          <Badge
            presentation={JOB_PRESENTATION[job.status]}
            label={f.t(`status.${job.status}`)}
            status={job.status}
            testId="import-status"
          />
        </dd>
      </div>
    </dl>
  );
}
