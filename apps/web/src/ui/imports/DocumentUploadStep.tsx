'use client';

import { useRef, useState } from 'react';
import type { FormatContext } from '../dashboard/types';
import type { Account } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { MAX_IMPORT_SOURCE_BYTES } from '../documents/logic';
import { formatBytes } from './logic';
import { checkStatementFile, type UploadPhase } from './document-upload';
import { DOCUMENT_ACCEPT } from './pipeline-logic';
import type { ImportProfile } from './types';

/**
 * Paso 1 (Archivo) desde un DOCUMENTO (openspec add-import-pipeline, tarea 7.1): cuenta destino, extracto CSV, OFX, QIF,
 * JSON o XLSX (hasta 20 MiB) y, si se quiere, el perfil a forzar. El archivo se sube como documento con propósito
 * «extracto para importar»; la importación se crea con su `documentId` y la procesa el worker. El formato lo decide el
 * CONTENIDO, no el nombre. El progreso se anuncia con `aria-live`.
 */
export function DocumentUploadStep({
  f,
  accounts,
  profiles,
  initialAccountId,
  busy,
  phase,
  percent,
  onSubmit,
}: {
  f: FormatContext;
  accounts: readonly Account[];
  /** Perfiles vigentes (no archivados) para forzar uno; opcional. */
  profiles: readonly ImportProfile[];
  initialAccountId?: string | undefined;
  busy: boolean;
  phase: UploadPhase | undefined;
  percent: number;
  onSubmit: (input: { file: File; accountId: string; mappingProfileId?: string }) => void;
}) {
  const preselected = accounts.some((a) => a.id === initialAccountId) ? (initialAccountId ?? '') : '';
  const [accountId, setAccountId] = useState(preselected);
  const [profileId, setProfileId] = useState('');
  const [accountError, setAccountError] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    const file = input.current?.files?.[0];
    const check = checkStatementFile(file);
    const account = accountId === '' ? f.t('docUpload.errors.account') : undefined;
    const problem =
      check === 'ok'
        ? undefined
        : f.t(`docUpload.errors.${check}`, { max: formatBytes(MAX_IMPORT_SOURCE_BYTES) });
    setAccountError(account);
    setFileError(problem);
    if (account || problem || !file) return;
    onSubmit({ file, accountId, ...(profileId ? { mappingProfileId: profileId } : {}) });
  }

  const progress = phase === undefined ? '' : f.t(`docUpload.phase.${phase}`, { percent });

  return (
    <form
      style={formStyle}
      data-testid="import-doc-upload"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>
        {f.t('docUpload.intro', { max: formatBytes(MAX_IMPORT_SOURCE_BYTES) })}
      </p>
      <div style={rowStyle}>
        <Field label={f.t('upload.account')} error={accountError}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={accountId}
              disabled={busy}
              data-testid="import-account"
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">{f.t('upload.accountPlaceholder')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('docUpload.file')} error={fileError} hint={f.t('docUpload.fileHint')}>
          {(p) => (
            <input
              {...p}
              ref={input}
              type="file"
              accept={DOCUMENT_ACCEPT}
              style={inputStyle}
              disabled={busy}
              data-testid="import-file"
            />
          )}
        </Field>
        {profiles.length > 0 ? (
          <Field label={f.t('docUpload.profile')} hint={f.t('docUpload.profileHint')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={profileId}
                disabled={busy}
                data-testid="import-profile-select"
                onChange={(e) => setProfileId(e.target.value)}
              >
                <option value="">{f.t('docUpload.profileAuto')}</option>
                {profiles.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name} ({pr.format})
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="import-upload-progress">
        {progress}
      </div>
      <div>
        <button type="submit" disabled={busy} data-testid="import-upload-submit">
          {busy ? f.t('upload.uploading') : f.t('docUpload.submit')}
        </button>
      </div>
    </form>
  );
}
