# Propuesta: add-document-attachments

## Why

Phase 6 (docs/24 §5.6) necesita guardar archivos: comprobantes, facturas y contratos adjuntos a transacciones, préstamos o cierres de mes (FR-DOCUMENTS-001..007), y los extractos que el pipeline de imports procesa (docs/13 §1: "el binario vive en Object Storage y su metadato como `Document`"). Hoy no existe el contexto DOCUMENTS: el CSV básico de Phase 3 recibe el archivo por `multipart/form-data` (≤ 2 MiB), lo parsea en memoria en la misma petición y **descarta el binario** (docs/24 A6), sin cuarentena, sin verificación por contenido, sin cifrado y sin retención. Los archivos de un usuario de finanzas son confidenciales (RISK-010: números de cuenta, CI, direcciones) y un upload es una puerta de entrada de contenido malicioso; uno de los criterios de salida de Phase 6 es **"uploads maliciosos de prueba rechazados"**, que exige definir y automatizar ese conjunto de pruebas (docs/12 §16). Este change crea DOCUMENTS como base segura de Phase 6: subida presignada a cuarentena, verificación del tipo real, cifrado en reposo, adjuntos N:M, descarga autorizada, retención, cuota, auditoría y portabilidad, y los contratos que `add-import-pipeline` usa para guardar y leer los extractos subidos.

## What Changes

- **Contexto nuevo `@pf/documents`** (schema `documents`, docs/05 §2.11) con el agregado `Document` (pendiente de subida → subido → disponible | rechazado; disponible → eliminado; contenido pendiente de restaurar → disponible) y `AttachmentLink`.
- **Subida presignada directa** al almacenamiento (FR-DOCUMENTS-001): la API valida la declaración (nombre, tipo, tamaño, SHA-256, propósito) y devuelve una URL PUT de 5 minutos atada al tamaño exacto, al tipo y a la suma; el archivo cae en un **bucket de cuarentena sin versioning**; la API nunca recibe el binario.
- **Verificación síncrona al confirmar** (sin consumidores nuevos, presupuesto de conexiones intacto): existencia, tamaño y suma; **tipo real por firma y estructura**; PDF sin JavaScript, acciones, adjuntos incrustados ni XFA (también ofuscados o en flujos comprimidos) y sin contraseña de apertura; formatos de texto (CSV, OFX/QFX, QIF, JSON) sin bytes nulos ni marcado HTML/SVG/script y JSON ≤ 64 niveles; XLSX sin macros y con límites de entradas, tamaño descomprimido y razón de compresión. Resultado: disponible o rechazado con motivo.
- **Antimalware opcional** (Could, FR-DOCUMENTS-008): puerto `MalwareScanner` con adapter ClamAV, deshabilitado por defecto (host de 2 GB, D51); su adopción en la suite la decide el owner.
- **Cifrado en reposo a nivel de aplicación** (NFR-SEC-006): cifrado de sobre AES-256-GCM por bloques, el mismo formato `PFXE` de los exports (movido a `@pf/platform/crypto`), con clave de datos por documento y un llavero maestro propio y rotable; borrar un documento destruye su clave (crypto-shredding).
- **Descarga solo por la API** en streaming, siempre como adjunto, con `nosniff`, CSP en modo aislado, sin caché y nombre saneado; sin presigned GET (cambia FR-DOCUMENTS-004 y ADR-0009: pregunta 1).
- **Adjuntos N:M** (FR-DOCUMENTS-003) a transacciones, conversiones, préstamos, suscripciones, cuentas, importaciones y cierres de mes, validados por contratos de existencia de cada contexto dueño; permitidos en periodos cerrados (D65); hasta 20 por elemento.
- **Deduplicación** por SHA-256 dentro del workspace (FR-DOCUMENTS-006), **archivado**, **eliminación** y **purga** de documentos sin vínculo a los 30 días (FR-DOCUMENTS-007), expiración de subidas abandonadas y barridos de cuarentena y de objetos huérfanos.
- **Cuota por workspace** (5 GiB, 20 subidas pendientes) con contadores bajo bloqueo de fila; cuota `costly` en subir y confirmar.
- **Claves de objeto con solo identificadores opacos** y nombre original solo como metadato normalizado, nunca en logs (FR-DOCUMENTS-005).
- **Auditoría** de solicitud, aceptación, rechazo, vínculos, archivado, eliminación, purga y **cada descarga**; **recorrido** del documento (D37); eventos `documents.AttachmentUploaded.v1` y `documents.DocumentRejected.v1` sin nombre de archivo.
- **Portabilidad:** metadatos y vínculos en el export del workspace; contenidos en un archivo aparte opcional, cifrado y restaurable en un segundo paso idempotente (D100 intacta; pregunta 3).
- **Contratos para `add-import-pipeline`:** consulta del documento, lectura del contenido verificado en streaming, vínculo `IMPORT_JOB` en la UoW del llamador y retención garantizada mientras esté vinculado.
- **Suite de uploads maliciosos** (exit criterion): 17 casos (18 con escáner) generados por código, ejecutados de punta a punta contra la API y SeaweedFS reales.
- **UI:** componente "Adjuntos" en los detalles de los siete tipos de elemento (subida con progreso, lista, descarga, quitar, motivo de rechazo) y página `/documentos` con filtros y uso de cuota; i18n es/en/pt.
- **Fuera de alcance:** OCR (FR-DOCUMENTS-009, Phase 11), vista previa en línea y miniaturas, re-codificación de imágenes, ClamAV en producción, versiones de un documento, enlaces públicos, subida multiparte del navegador (> 25 MiB), datos demo con documentos, cambios en la ruta multipart del CSV básico, parseo del contenido financiero (IMPORTS), destinos `CREDIT_CARD_STATEMENT`, `GOAL` y `RECONCILIATION` de docs/08 (pregunta 9).

## Capabilities

### New Capabilities
- `documents/attachments`: subida presignada, confirmación y verificación, expiración, deduplicación, adjuntos N:M y sus validaciones, periodos cerrados, límite por elemento, desvincular, consulta, descarga por la API, archivado, eliminación, purga, auditoría, lectura para el pipeline de imports, eventos y UI (18 requirements: 11 Must, 7 Should).
- `security/file-upload-security`: allowlist, tamaño por propósito, integridad de la subida, tipo real por contenido, PDF sin contenido activo, texto sin marcado activo, XLSX sin macros ni bombas, cuarentena, claves y logs sin datos personales, entrega segura, cifrado en reposo, rotación de la clave maestra, cuota, antimalware opcional, aislamiento, límite de frecuencia y suite de archivos maliciosos (17 requirements: 13 Must, 3 Should, 1 Could).

### Modified Capabilities
- `identity/workspace-portability`: ADDED "Documentos y adjuntos en el export" (Must) y "Archivo de contenidos de documentos del export" (Should).
- `audit/lifecycle-timeline`: ADDED "Recorrido de un documento" (Should).

## Impact

**Specs impactadas:** crea `documents/attachments` (18) y `security/file-upload-security` (17); agrega 2 requirements a `identity/workspace-portability` y 1 a `audit/lifecycle-timeline`. Total 38 requirements (25 Must, 12 Should, 1 Could). Se apoya sin modificarlos en `security/access-control` (RLS forzada, fail-closed, tablas registradas), `platform/api-conventions` (idempotencia, cuota `costly`, `ETag`/`If-Match`), `audit/audit-trail` y `planning/month-closing` (D65: adjuntos permitidos en periodo cerrado).

**Componentes/contextos impactados:** DOCUMENTS nuevo (`packages/contexts/documents`). `@pf/platform`: adapter S3 completo (`storage`) y cifrado de sobre movido desde IDENTITY (`crypto`, con `EncryptStream` nuevo). IDENTITY: importa el cifrado desde `@pf/platform/crypto`, secciones de portabilidad de documentos y archivo de contenidos del export. Contratos aditivos de existencia de destino en TRANSACTIONS, DEBT, COMMITMENTS, ACCOUNTS, PLANNING e IMPORTS. `apps/api` (controller, jobs del worker, composición), BFF (streaming de la descarga), `apps/web` (componente "Adjuntos", `/documentos`, CSP `connect-src`). Despliegue: Caddy (`PF_DOMAIN_FILES`), bootstrap y backup del almacenamiento.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo, tag Documents): `requestDocumentUpload`, `completeDocumentUpload`, `getDocument`, `listDocuments`, `downloadDocument`, `linkDocument`, `unlinkDocument`, `archiveDocument`, `unarchiveDocument`, `deleteDocument`, `getDocumentStorageUsage`, `getDocumentLifecycle`, `restoreDocumentContents`, `downloadWorkspaceExportDocumentContents`; `requestWorkspaceExport` agrega `includeDocumentContents` opcional. Códigos nuevos en `ErrorCode`: `UPLOAD_TYPE_NOT_ALLOWED`, `DOCUMENT_QUOTA_EXCEEDED`, `DOCUMENT_PENDING_UPLOADS_EXCEEDED`, `DOCUMENT_UPLOAD_MISSING`, `DOCUMENT_NOT_AVAILABLE`, `DOCUMENT_REJECTED`, `DOCUMENT_DELETED`, `DOCUMENT_CONTENT_CORRUPTED`, `ATTACHMENT_LIMIT_EXCEEDED`. Enums abiertos `DocumentPurpose`, `DocumentStatus`, `DocumentRejectionReason`, `AttachmentTargetType`, `DocumentScanStatus`, `DocumentFormat`.

**Tablas impactadas:** nuevas `documents.document`, `documents.attachment_link`, `documents.storage_usage`; columnas nullable `contents_*` en `iam.workspace_export`; `platform.workspace_scoped_table` (registro), `platform.outbox`, `audit.audit_log`, `audit.lifecycle_transition`.

**Eventos impactados:** produce `documents.AttachmentUploaded.v1` (docs/11) y `documents.DocumentRejected.v1` (nuevo); sin consumidores en este change (0 conexiones nuevas del worker).

**Migraciones requeridas:** expand, no destructiva: schema `documents` con RLS forzada, grants, política `retention_scan` para `pf_maintenance` y registro de tablas; columnas nullable en `iam.workspace_export`. Buckets: cuarentena nuevo sin versioning (local por `migrate`, producción por el script de bootstrap).

**Test cases:** AÑADIDOS — TC-DOCUMENTS-ATTACH-001..026 (carpeta nueva `tests/cases/documents/`) y TC-SECURITY-UPLOAD-001..022, todos `draft`, `provisional`, `not_automated`. MODIFICADOS — ninguno (TC-IDENTITY-EXPORT-* y TC-SECURITY-RLS-007 deben seguir en verde con el cifrado movido y las tablas nuevas). DEPRECADOS — ninguno.

**Impacto de regresión:** el refactor del cifrado de sobre a `@pf/platform/crypto` toca el export y la importación del workspace (mismo formato `PFXE` v1; sus tests de ida y vuelta y de archivo alterado deben seguir verdes). La ruta multipart del CSV básico no cambia. Los contextos dueños solo agregan consultas de existencia. El test de cobertura de tablas del export incluye las tres tablas nuevas. La verificación ocupa CPU y memoria de la API (semáforo de 2 por proceso).

**Riesgos introducidos:** RISK-010 (archivos sensibles), pérdida del llavero de documentos (pérdida total del contenido), parsers de formatos no confiables en el proceso de la API, endpoint S3 público nuevo, ausencia de antimalware en producción, retención de envoltorios en los backups de la base (≤ 12 meses). Ver design.md § Riesgos.

**Invariantes afectadas:** INV-025 (RLS por workspace), INV-027 (idempotencia de comandos), INV-029 (auditoría en la misma unidad de trabajo). No toca dinero, ledger, FX, periodos ni redondeo: adjuntar en un periodo cerrado no modifica asientos (INV-015 intacta).
