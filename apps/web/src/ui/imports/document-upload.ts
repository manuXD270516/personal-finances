/**
 * Subida del extracto como DOCUMENTO (openspec add-import-pipeline, tarea 7.1; add-document-attachments): reutiliza el
 * mismo flujo de las demás pantallas —SHA-256 en el navegador, solicitud de subida, PUT directo al almacenamiento con
 * progreso, confirmación— con el propósito `IMPORT_SOURCE`. NO vincula el documento a ningún elemento: lo vincula la
 * creación de la importación en la misma unidad de trabajo (decisión 2).
 */
import { FinanceApiError, type FinanceApiClient } from '../../bff/finance-api-client';
import {
  contentTypeOf,
  putWithProgress,
  sha256Hex,
  MAX_IMPORT_SOURCE_BYTES,
  type DocumentView,
  type UploadInstructions,
} from '../documents/logic';

export type UploadPhase = 'hashing' | 'requesting' | 'uploading' | 'verifying';

export type DocumentFileCheck = 'ok' | 'none' | 'empty' | 'tooLarge' | 'type';

/** Cortesía previa a la subida; la API (DOCUMENTS) es la autoridad. */
export function checkStatementFile(
  file: { readonly name: string; readonly size: number } | null | undefined,
): DocumentFileCheck {
  if (!file) return 'none';
  if (file.size <= 0) return 'empty';
  if (contentTypeOf(file.name) === null) return 'type';
  return file.size > MAX_IMPORT_SOURCE_BYTES ? 'tooLarge' : 'ok';
}

interface UploadResult {
  readonly document: DocumentView;
  readonly upload: UploadInstructions | null;
  readonly deduplicated: boolean;
}

export type UploadOutcome =
  | { readonly kind: 'available'; readonly document: DocumentView }
  | { readonly kind: 'rejected'; readonly document: DocumentView };

/**
 * Sube el archivo y devuelve el documento ya verificado (`AVAILABLE`) o rechazado (con su motivo). Los errores de red o de
 * la API se propagan como `FinanceApiError` para que el llamador los muestre con el catálogo de errores.
 */
export async function uploadStatementDocument(input: {
  readonly api: FinanceApiClient;
  readonly base: string;
  readonly file: File;
  readonly onPhase: (phase: UploadPhase, percent?: number) => void;
  readonly uploader?: typeof putWithProgress;
}): Promise<UploadOutcome> {
  const { api, base, file } = input;
  const upload = input.uploader ?? putWithProgress;
  input.onPhase('hashing');
  const sha256 = await sha256Hex(file);
  input.onPhase('requesting');
  const requested = await api.command<UploadResult>('POST', `${base}/documents/uploads`, {
    fileName: file.name,
    contentType: contentTypeOf(file.name),
    sizeBytes: file.size,
    sha256,
    purpose: 'IMPORT_SOURCE',
  });
  const result = requested.data as UploadResult;
  let doc = result.document;
  if (result.upload) {
    input.onPhase('uploading', 0);
    await upload(result.upload, file, (percent) => input.onPhase('uploading', percent));
    input.onPhase('verifying');
    doc = await confirm(api, base, doc.id);
  }
  return doc.status === 'REJECTED'
    ? { kind: 'rejected', document: doc }
    : { kind: 'available', document: doc };
}

async function confirm(api: FinanceApiClient, base: string, documentId: string): Promise<DocumentView> {
  // La confirmación es idempotente: se reintenta (503 con Retry-After) sin clave, como en los adjuntos.
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
