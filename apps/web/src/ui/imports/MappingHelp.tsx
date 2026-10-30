'use client';

import { useState } from 'react';
import type { FormatContext } from '../dashboard/types';
import { Field, cardStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { truncate } from './logic';
import type { DateOrder } from './pipeline-logic';
import type { ImportJob, ImportProfileCandidate } from './types';

/**
 * Ayuda del estado «esperando mapeo» de un job de documento (openspec add-import-pipeline, tarea 7.1): perfiles
 * candidatos con las columnas que les faltan en el encabezado, las columnas requeridas ausentes y, para un QIF, el orden
 * día/mes que el archivo no declara. Los nombres de columna vienen del archivo: texto no confiable (React lo escapa).
 */
export function MappingHelp({
  job,
  f,
  busy,
  canEdit,
  onApplyProfile,
  onQifDateOrder,
}: {
  job: ImportJob;
  f: FormatContext;
  busy: boolean;
  canEdit: boolean;
  onApplyProfile: (candidate: ImportProfileCandidate) => void;
  onQifDateOrder: (order: DateOrder) => void;
}) {
  const candidates = job.profileCandidates ?? [];
  const missing = job.missingColumns ?? [];
  const [order, setOrder] = useState<'' | DateOrder>('');
  if (candidates.length === 0 && missing.length === 0 && job.format !== 'QIF') return null;
  return (
    <section
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      aria-labelledby="mapping-help-title"
      data-testid="mapping-help"
    >
      <h3 id="mapping-help-title" style={{ margin: 0 }}>
        {f.t('mappingHelp.title')}
      </h3>
      {missing.length > 0 ? (
        <div data-testid="mapping-missing">
          <p style={{ margin: 0 }}>{f.t('mappingHelp.missing')}</p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {missing.map((name) => (
              <li key={name}>
                <code>{truncate(name, 60)}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {candidates.length > 0 ? (
        <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
          <p style={{ margin: 0 }}>{f.t('mappingHelp.candidates')}</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--pf-space-2)' }}>
            {candidates.map((c) => (
              <li key={`${c.profileId}-${c.version}`} data-testid="profile-candidate" style={rowStyle}>
                <span>
                  <strong>{c.name}</strong> <span style={mutedStyle}>v{c.version}</span>
                  {c.missingColumns.length > 0 ? (
                    <span style={mutedStyle}>
                      {' '}
                      —{' '}
                      {f.t('mappingHelp.lacks', {
                        columns: c.missingColumns.map((x) => truncate(x, 40)).join(', '),
                      })}
                    </span>
                  ) : null}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="profile-candidate-apply"
                    aria-label={f.t('mappingHelp.applyNamed', { name: c.name, version: c.version })}
                    onClick={() => onApplyProfile(c)}
                  >
                    {f.t('mappingHelp.apply')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {job.format === 'QIF' && canEdit ? (
        <div style={rowStyle}>
          <Field label={f.t('mappingHelp.dateOrder')} hint={f.t('mappingHelp.dateOrderHint')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={order}
                disabled={busy}
                data-testid="qif-date-order"
                onChange={(e) => setOrder(e.target.value as '' | DateOrder)}
              >
                <option value="">{f.t('mapping.chooseOption')}</option>
                <option value="DMY">{f.t('mappingHelp.dmy')}</option>
                <option value="MDY">{f.t('mappingHelp.mdy')}</option>
              </select>
            )}
          </Field>
          <button
            type="button"
            disabled={busy || order === ''}
            data-testid="qif-date-order-apply"
            onClick={() => order !== '' && onQifDateOrder(order)}
          >
            {f.t('mappingHelp.applyOrder')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** «Guardar como perfil» (se crea con `fromImportId` al aplicar el mapeo; el servidor toma la institución de la cuenta). */
export function SaveAsProfile({
  f,
  enabled,
  name,
  disabled,
  onChange,
}: {
  f: FormatContext;
  enabled: boolean;
  name: string;
  disabled: boolean;
  onChange: (patch: { enabled?: boolean; name?: string }) => void;
}) {
  return (
    <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="save-as-profile">
      <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          data-testid="save-profile-toggle"
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        {f.t('saveProfile.toggle')}
      </label>
      {enabled ? (
        <Field label={f.t('saveProfile.name')} hint={f.t('saveProfile.hint')}>
          {(p) => (
            <input
              {...p}
              type="text"
              maxLength={120}
              style={inputStyle}
              value={name}
              disabled={disabled}
              data-testid="save-profile-name"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}
