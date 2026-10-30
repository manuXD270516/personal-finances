'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { ConfirmPanel, cardStyle, errorStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { BFF_API, useOptionalSession } from '../session-context';
import {
  checkFile,
  contentTypeOf,
  downloadPath,
  formatBytes,
  putWithProgress,
  reasonKey,
  sha256Hex,
  type AttachmentTargetType,
  type DocumentPurpose,
  type DocumentView,
  type UploadInstructions,
} from './logic';

interface UploadResult {
  readonly document: DocumentView;
  readonly upload: UploadInstructions | null;
  readonly deduplicated: boolean;
}

type Phase =
  | { readonly step: 'idle' }
  | { readonly step: 'hashing' | 'requesting' | 'verifying' | 'linking' }
  | { readonly step: 'uploading'; readonly percent: number };

export interface AttachmentsSectionProps {
  readonly targetType: AttachmentTargetType;
  readonly targetId: string;
  /** Propósito de los archivos que se suben desde este detalle (por defecto comprobante). */
  readonly purpose?: DocumentPurpose;
  /** Sustituye la subida directa (pruebas): por defecto `XMLHttpRequest` con progreso. */
  readonly uploader?: typeof putWithProgress;
}

/**
 * "Adjuntos" de un elemento (transacción, conversión, préstamo, suscripción, cuenta, importación o cierre de mes;
 * openspec add-document-attachments, tarea 6.1): calcula el SHA-256 en el navegador, pide la subida, envía el archivo
 * directo al almacenamiento con progreso (`aria-live`), confirma (verificación síncrona de la API), adjunta, lista, descarga
 * por la API y quita. Un archivo rechazado muestra su motivo traducido y no se adjunta. La API autoriza; la UI solo oculta
 * acciones a un VIEWER.
 */
export function AttachmentsSection(props: AttachmentsSectionProps) {
  // Sin sesión (vistas probadas de forma aislada) no hay nada que mostrar.
  if (!useOptionalSession()) return null;
  return <WithWorkspace>{(ctx) => <Attachments ctx={ctx} {...props} />}</WithWorkspace>;
}

function Attachments({
  ctx,
  targetType,
  targetId,
  purpose = 'RECEIPT',
  uploader,
}: AttachmentsSectionProps & { ctx: WorkspaceContext }) {
  const t = useTranslations('Documents');
  const { api, base } = ctx;
  const [items, setItems] = useState<readonly DocumentView[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [rejected, setRejected] = useState<{ name: string; reason: string | null } | undefined>();
  const [invalid, setInvalid] = useState<'EMPTY' | 'TYPE' | 'TOO_LARGE' | undefined>();
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [removing, setRemoving] = useState<
    { documentId: string; linkId: string; name: string } | undefined
  >();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = uploader ?? putWithProgress;

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ targetType, targetId, limit: '200' });
      const r = await api.get<{ data: DocumentView[] }>(`${base}/documents?${q.toString()}`);
      setItems(r.data?.data ?? []);
    } catch (err) {
      setProblem(problemOf(err));
    }
  }, [api, base, targetType, targetId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function confirmUpload(documentId: string): Promise<DocumentView> {
    // La confirmación es naturalmente idempotente: se reintenta (503 con Retry-After) sin clave.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const r = await api.command<DocumentView>(
          'POST',
          `${base}/documents/${documentId}/complete`,
          undefined,
          {
            idempotent: false,
          },
        );
        return r.data as DocumentView;
      } catch (err) {
        if (err instanceof FinanceApiError && err.status === 503 && attempt < 3) {
          await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  async function attach(file: File) {
    setProblem(undefined);
    setRejected(undefined);
    setInvalid(undefined);
    const check = checkFile(file, purpose);
    if (check !== 'OK') {
      setInvalid(check);
      return;
    }
    try {
      setPhase({ step: 'hashing' });
      const sha256 = await sha256Hex(file);
      setPhase({ step: 'requesting' });
      const requested = await api.command<UploadResult>('POST', `${base}/documents/uploads`, {
        fileName: file.name,
        contentType: contentTypeOf(file.name),
        sizeBytes: file.size,
        sha256,
        purpose,
      });
      const result = requested.data as UploadResult;
      let doc = result.document;
      if (result.upload) {
        setPhase({ step: 'uploading', percent: 0 });
        await upload(result.upload, file, (percent) => setPhase({ step: 'uploading', percent }));
        setPhase({ step: 'verifying' });
        doc = await confirmUpload(doc.id);
      }
      if (doc.status === 'REJECTED') {
        setRejected({ name: file.name, reason: doc.rejectionReason });
        return;
      }
      setPhase({ step: 'linking' });
      await api.command('POST', `${base}/documents/${doc.id}/links`, { targetType, targetId });
      await load();
    } catch (err) {
      setProblem(err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' });
    } finally {
      setPhase({ step: 'idle' });
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.command(
        'DELETE',
        `${base}/documents/${removing.documentId}/links/${removing.linkId}`,
        undefined,
        {
          idempotent: false,
        },
      );
      setRemoving(undefined);
      await load();
    } catch (err) {
      setRemoving(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const working = phase.step !== 'idle';
  const progressText =
    phase.step === 'uploading'
      ? t('progress.uploading', { percent: phase.percent })
      : phase.step === 'idle'
        ? ''
        : t(`progress.${phase.step}`);

  return (
    <section aria-labelledby={`attachments-${targetId}`} style={cardStyle} data-testid="attachments">
      <h2 id={`attachments-${targetId}`} style={{ marginTop: 0 }}>
        {t('title')}
      </h2>
      {items === undefined && !problem ? <p aria-busy="true">{t('loading')}</p> : null}
      {items && items.length === 0 ? (
        <p style={mutedStyle} data-testid="attachments-empty">
          {t('empty')}
        </p>
      ) : null}
      {items && items.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          {items.map((d) => {
            const link = d.links.find((l) => l.targetType === targetType && l.targetId === targetId);
            return (
              <li key={d.id} style={{ ...rowStyle, alignItems: 'center' }} data-testid="attachment-item">
                <span style={{ flex: '1 1 14rem', minWidth: 0 }}>
                  <strong>{d.originalName}</strong>{' '}
                  <span style={mutedStyle}>
                    {formatBytes(d.sizeBytes, ctx.formatLocale)}
                    {d.availableAt ? ` · ${t('uploadedOn', { date: d.availableAt.slice(0, 10) })}` : ''}
                    {d.status === 'CONTENT_PENDING' ? ` · ${t('contentPending')}` : ''}
                  </span>
                </span>
                {d.status === 'AVAILABLE' ? (
                  <a
                    href={downloadPath(BFF_API, ctx.ws.id, d.id)}
                    download
                    data-testid="attachment-download"
                    aria-label={t('downloadNamed', { name: d.originalName })}
                  >
                    {t('download')}
                  </a>
                ) : null}
                {ctx.canEdit && link ? (
                  <button
                    type="button"
                    data-testid="attachment-remove"
                    aria-label={t('removeNamed', { name: d.originalName })}
                    onClick={() => setRemoving({ documentId: d.id, linkId: link.id, name: d.originalName })}
                  >
                    {t('remove')}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {ctx.canEdit ? (
        <div style={{ ...rowStyle, marginTop: 'var(--pf-space-3)' }}>
          <label htmlFor={`attach-file-${targetId}`}>{t('choose')}</label>
          <input
            id={`attach-file-${targetId}`}
            ref={input}
            type="file"
            disabled={working}
            data-testid="attachment-file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.ofx,.qfx,.qif,.json,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attach(file);
            }}
          />
        </div>
      ) : (
        <p style={mutedStyle}>{t('viewerNotice')}</p>
      )}

      {/* Región viva solo mientras hay un mensaje: una `role="status"` vacía permanente chocaría con los avisos de las demás pantallas. */}
      {progressText ? (
        <p role="status" aria-live="polite" data-testid="attachment-progress" style={mutedStyle}>
          {progressText}
        </p>
      ) : null}
      {phase.step === 'uploading' ? (
        <progress
          value={phase.percent}
          max={100}
          aria-label={t('progress.label')}
          style={{ width: '100%' }}
        />
      ) : null}
      {invalid ? (
        <p role="alert" style={errorStyle} data-testid="attachment-invalid">
          {t(`invalid.${invalid}`)}
        </p>
      ) : null}
      {rejected ? (
        <p role="alert" style={errorStyle} data-testid="attachment-rejected">
          {t('rejected', { name: rejected.name, reason: t(reasonKey(rejected.reason)) })}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      {removing ? (
        <ConfirmPanel
          title={t('removeTitle')}
          description={t('removeBody', { name: removing.name })}
          confirmLabel={t('remove')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(undefined)}
          testId="attachment-remove-confirm"
        />
      ) : null}
    </section>
  );
}
