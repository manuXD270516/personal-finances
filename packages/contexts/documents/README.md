# @pf/documents

Bounded context **DOCUMENTS** (openspec `add-document-attachments`, Phase 6, FR-DOCUMENTS-001..008, ADR-0030). Almacena archivos de forma
segura y los vincula a elementos del workspace. No interpreta su contenido financiero (eso es de IMPORTS).

## Lenguaje ubicuo

| Término | Significado |
|---|---|
| **Documento** (`Document`) | Un archivo del workspace con su ciclo de vida. El contenido vive cifrado en el bucket de documentos; la base guarda solo metadatos y la clave de datos envuelta. |
| **Cuarentena** | Bucket propio, sin versioning, donde el navegador sube el archivo con un presigned PUT. Ningún objeto permanece más de 24 h. |
| **Verificación** | La que hace `complete` de forma síncrona: tamaño, suma SHA-256, tipo real por contenido, controles por formato y antimalware opcional. |
| **Vínculo** (`AttachmentLink`) | Relación N:M de un documento con un elemento (`TRANSACTION`, `CONVERSION`, `LOAN`, `SUBSCRIPTION`, `ACCOUNT`, `IMPORT_JOB`, `MONTH_CLOSING`). |
| **Propósito** | `RECEIPT`, `INVOICE`, `STATEMENT`, `CONTRACT`, `IMPORT_SOURCE`, `OTHER`; fija el tamaño máximo (15 MiB y 20 MiB para extractos a importar; tope duro 25 MiB). |
| **Contenido pendiente** (`CONTENT_PENDING`) | Documento importado desde un export cuyo contenido aún no se restauró. |

## Agregados y estados

`Document`: `PENDING_UPLOAD → UPLOADED → AVAILABLE | REJECTED`, `PENDING_UPLOAD → REJECTED` (vencimiento), `AVAILABLE | CONTENT_PENDING → DELETED`,
`CONTENT_PENDING → AVAILABLE`. Archivar, desarchivar, vincular y desvincular son anotaciones del recorrido (`archivedAt` es un atributo).
La máquina está declarada en `domain/document.ts` (`DOCUMENT_LIFECYCLE`, D37).

## Capas

- `domain/`: `Document`, `FileTypePolicy` (lista permitida extensión ↔ tipo ↔ familia, límites), nombres seguros, detección por firma, inspector de texto, cuota (`StorageUsage`).
- `application/`: `UploadsService` (solicitud + confirmación), `AttachmentsService`, `DocumentsService` (archivar, eliminar, rotación), `DownloadService` (descarga y contratos de lectura para IMPORTS), `DocumentsQueries`, `MaintenanceService`. Puertos en `application/ports`; dobles en `application/testing`.
- `infrastructure/`: repositorios Kysely/PG, `EnvelopeDocumentCipher`, inspectores de PDF (con cifrado) y XLSX, `WorkerThreadInspector`, `ClamdMalwareScanner`/`NoopMalwareScanner`, semáforo.
- `interface/`: `DocumentsController` (`/workspaces/{id}/documents*`) y `documents.module.ts` (composición).
- `contracts/`: eventos, política de auditoría, secciones de portabilidad y los puertos para IMPORTS (`DocumentQuery`, `DocumentContentReader`, `AttachmentCommand`).

## Puertos y adapters

`ObjectStorage` (de `@pf/platform/storage`, adapter S3 con presign SigV4 y endpoint público), `DocumentCipher` (cifrado de sobre de
`@pf/platform/crypto`), `ContentInspector`, `MalwareScanner`, `AttachmentTargetRegistry` (consultas de existencia `*ExistenceQuery` de cada contexto dueño; sin FK cruzadas).

## Eventos

`documents.AttachmentUploaded.v1` (al quedar disponible) y `documents.DocumentRejected.v1`; sin consumidores obligatorios (no cambian el presupuesto de conexiones). Ninguno lleva el nombre original.

## Mantenimiento

Un único job secuencial (`documents.maintenance`, `DOCUMENT_MAINTENANCE_CRON`): expira subidas no completadas, reintenta verificaciones atascadas, barre la cuarentena y los objetos huérfanos, purga los documentos sin vínculo a los 30 días (los archivados se conservan) y re-envuelve las claves tras una rotación. Los candidatos entre workspaces los lee `pf_maintenance` (política `retention_scan`, solo columnas operativas).

## Seguridad

Cifrado de sobre con clave de datos por documento y llavero propio (**respaldarlo fuera del host**); descarga solo por la API y como adjunto; auditoría sin el nombre original; RLS forzada y fail-closed; suite de archivos maliciosos generada por código (nunca binarios peligrosos versionados).
