import type {
  AuditActorDto,
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import {
  DOCUMENT_AGGREGATE,
  DOCUMENT_LIFECYCLE,
  type Document,
  type DocumentState,
} from '../domain/document.js';
import { DOCUMENTS_EVENTS } from '../contracts/index.js';
import type { DocumentsDeps } from './ports/index.js';

export { DOCUMENT_AGGREGATE };

/** Actor de proceso para los jobs de mantenimiento (auditoría con actor `SYSTEM`, D318). */
export const systemActor = (process: string): AuditActorDto => ({ type: 'SYSTEM', process });

/** Escribe un hecho en el outbox (misma unidad de trabajo) y devuelve su referencia para el recorrido. */
export async function publishEvent(
  deps: DocumentsDeps,
  doc: Document,
  kind: { readonly eventType: string; readonly eventVersion: number },
  payload: object,
): Promise<LifecycleEventRefDto> {
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
    eventType: kind.eventType,
    eventVersion: kind.eventVersion,
    occurredAt: deps.clock.now().toString(),
    workspaceId: doc.workspaceId,
    aggregateType: DOCUMENT_AGGREGATE,
    aggregateId: doc.id,
    aggregateVersion: doc.version,
    payload,
  });
  return { eventId, eventType: `${kind.eventType}.v${kind.eventVersion}` };
}

/** `documents.AttachmentUploaded.v1`: sin el nombre original (FR-DOCUMENTS-005, NFR-SEC-015). */
export const uploadedEvent = (doc: Document): object => {
  const s = doc.snapshot;
  return {
    documentId: s.id,
    purpose: s.purpose,
    contentType: s.detectedContentType,
    format: s.detectedFormat,
    sizeBytes: s.sizeBytes,
    sha256: s.sha256,
    scanStatus: s.scanStatus ?? 'NOT_SCANNED',
  };
};

export const rejectedEvent = (doc: Document): object => ({
  documentId: doc.id,
  purpose: doc.snapshot.purpose,
  reason: doc.snapshot.rejectionReason,
});

export const publishAvailable = (deps: DocumentsDeps, doc: Document) =>
  publishEvent(deps, doc, DOCUMENTS_EVENTS.attachmentUploaded, uploadedEvent(doc));
export const publishRejected = (deps: DocumentsDeps, doc: Document) =>
  publishEvent(deps, doc, DOCUMENTS_EVENTS.documentRejected, rejectedEvent(doc));

/**
 * Campos auditables (allow-list `DOCUMENTS_AUDIT_POLICY`). NUNCA el nombre original (dato que puede llevar PII,
 * docs/12 §1), ni claves, ni contenido. Los valores compuestos irían como texto JSON.
 */
const FIELDS: readonly (keyof DocumentState)[] = [
  'status',
  'purpose',
  'sizeBytes',
  'detectedFormat',
  'scanStatus',
  'rejectionReason',
  'archivedAt',
  'deletedAt',
];

export function documentChanges(before: DocumentState | null, after: DocumentState): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  for (const f of FIELDS) {
    const b = before === null ? null : before[f];
    if (before === null || JSON.stringify(b) !== JSON.stringify(after[f])) {
      out.push({ field: f, before: b ?? null, after: after[f] ?? null });
    }
  }
  return out;
}

export function documentEntry(
  doc: Document,
  action: string,
  changes: readonly AuditChangeInput[],
  options: { readonly reason?: string | null; readonly actor?: AuditActorDto } = {},
): AuditEntry {
  return {
    workspaceId: doc.workspaceId,
    action: `documents.document.${action}`,
    aggregateType: DOCUMENT_AGGREGATE,
    aggregateId: doc.id,
    aggregateVersion: doc.version,
    changes,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
  };
}

/** Pasos del recorrido: la transición aplicada o una anotación con los campos cambiados. */
export function documentSteps(
  doc: Document,
  events: readonly LifecycleEventRefDto[],
  extra: {
    readonly changedFields?: readonly string[];
    readonly detailRefs?: Record<string, string | number>;
    readonly reason?: string | null;
  } = {},
): LifecycleStepInput[] {
  const t = doc.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: DOCUMENT_LIFECYCLE.version,
        events,
        ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...(extra.changedFields ?? doc.changedFields)],
      events,
      ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
    },
  ];
}
