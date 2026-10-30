import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a DOCUMENTS (openspec add-document-attachments
 * decisión 13, tarea 8.1; D315): los metadatos de los documentos y sus vínculos viajan en el ZIP principal; el CONTENIDO
 * no (archivo aparte, opcional). Orden 810–812: después de todos los destinos de los vínculos (cuentas 400,
 * transacciones 600, periodos 700, suscripciones 750, importaciones 770, préstamos 780–797) y de NOTIFICATIONS
 * (800–801), antes de AUDIT (900).
 *
 * Nunca viajan claves de datos, claves envueltas, identificador de clave maestra ni claves de objeto
 * (`omit`): al importar toman su DEFAULT (nulos). Un documento disponible en el origen queda
 * `CONTENT_PENDING` (gancho `documents.content-pending`) hasta que se restaure su contenido; los eliminados y
 * rechazados conservan su estado. Las subidas sin terminar (`PENDING_UPLOAD`, `UPLOADED`) no viajan: su archivo vive en
 * una cuarentena que no se exporta. Los ids de documentos y de destinos se remapean al importar (columnas `uuid`).
 */
export const DOCUMENTS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'documents',
    context: 'documents',
    table: 'documents.document',
    order: 810,
    orderBy: ['id'],
    omit: [
      'quarantine_key',
      'object_key',
      'encrypted_size_bytes',
      'key_id',
      'wrapped_key',
      'envelope_version',
    ],
    where: "t.status NOT IN ('PENDING_UPLOAD', 'UPLOADED')",
    importHook: 'documents.content-pending',
  },
  {
    name: 'attachment-links',
    context: 'documents',
    table: 'documents.attachment_link',
    order: 811,
    orderBy: ['document_id', 'target_type', 'target_id', 'id'],
  },
  {
    name: 'document-storage-usage',
    context: 'documents',
    table: 'documents.storage_usage',
    order: 812,
    orderBy: ['workspace_id'],
    idColumns: [],
    importHook: 'documents.usage-recompute',
  },
];

/** Nombres de los ganchos de importación de DOCUMENTS (se registran en el composition root). */
export const DOCUMENTS_IMPORT_HOOKS = {
  contentPending: 'documents.content-pending',
  usageRecompute: 'documents.usage-recompute',
} as const;
