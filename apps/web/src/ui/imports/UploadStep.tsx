'use client';

import { useRef, useState } from 'react';
import type { FormatContext } from '../dashboard/types';
import type { Account } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { MAX_FILE_BYTES, checkFile, formatBytes } from './logic';

/**
 * Paso 1 (Archivo): cuenta destino y archivo CSV. Valida tamaño (2 MiB) y extensión como cortesía antes de subir; el
 * servidor revisa el contenido real. El archivo no se lee en el navegador: viaja como multipart por el BFF.
 */
export function UploadStep({
  f,
  accounts,
  initialAccountId,
  busy,
  onSubmit,
}: {
  f: FormatContext;
  /** Cuentas activas del workspace. */
  accounts: readonly Account[];
  initialAccountId?: string | undefined;
  busy: boolean;
  onSubmit: (input: { file: File; accountId: string }) => void;
}) {
  const preselected = accounts.some((a) => a.id === initialAccountId) ? (initialAccountId ?? '') : '';
  const [accountId, setAccountId] = useState(preselected);
  const [accountError, setAccountError] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    const file = input.current?.files?.[0];
    const account = accountId === '' ? f.t('upload.errors.account') : undefined;
    const check = checkFile(file);
    const problem =
      check === 'ok' ? undefined : f.t(`upload.errors.${check}`, { max: formatBytes(MAX_FILE_BYTES) });
    setAccountError(account);
    setFileError(problem);
    if (account || problem || !file) return;
    onSubmit({ file, accountId });
  }

  return (
    <form
      style={formStyle}
      data-testid="import-upload"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('upload.intro', { max: formatBytes(MAX_FILE_BYTES) })}</p>
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
        <Field label={f.t('upload.file')} error={fileError} hint={f.t('upload.fileHint')}>
          {(p) => (
            <input
              {...p}
              ref={input}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              style={inputStyle}
              disabled={busy}
              data-testid="import-file"
            />
          )}
        </Field>
      </div>
      <div>
        <button type="submit" disabled={busy} data-testid="import-upload-submit">
          {busy ? f.t('upload.uploading') : f.t('upload.submit')}
        </button>
      </div>
    </form>
  );
}
