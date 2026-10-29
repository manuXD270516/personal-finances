# Tareas

> Change de Phase 6 (docs/24 §5.6). Bloqueos: la pregunta 1 de design.md bloquea los grupos 3 a 6 (descarga por la API y cifrado); la pregunta 2, la tarea 7.3 y el alcance del exit criterion; la pregunta 3, el grupo 8. La pregunta 4 bloquea solo el despliegue (tarea 4.8). Va antes de la etapa Upload de `add-import-pipeline` (design.md decisión 14).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner las specs `documents/attachments`, `security/file-upload-security` y los requirements agregados a `identity/workspace-portability` y `audit/lifecycle-timeline`, y las preguntas 1–11 de design.md; `pnpm spec:validate` en verde
- [ ] 1.2 Revisar TC-DOCUMENTS-ATTACH-001..026 y TC-SECURITY-UPLOAD-001..022 contra los scenarios (cifras: 482133 bytes, 15728640/15728641, 19922944, 5368709120 − 5368000000 = 709120 libres, 18874368 = 18 MiB); pasar a `ready` y `requirement_status: confirmed` al aprobar
- [ ] 1.3 Generador de archivos de prueba `apps/api/test/support/malicious-files.ts` (18 casos de la tabla de design.md § Suite, EICAR armado por fragmentos en memoria; ningún binario peligroso versionado) y fixtures benignos sintéticos (PDF de texto, JPEG, PNG, WebP, HEIC, CSV windows-1252, OFX, QIF, JSON, XLSX) en `tests/fixtures/documents/` sin datos reales (D255)

## 2. DOMAIN (TDD)

- [ ] 2.1 `Document` y su máquina de estados (transiciones válidas e inválidas, `archivedAt`, `CONTENT_PENDING`, versión) test-first (TC-DOCUMENTS-ATTACH-003, -005, -006, -016, -017, -026)
- [ ] 2.2 `DeclaredFile` y `FileTypePolicy`: normalización del nombre (NFC, sin rutas ni controles, ≤ 255), allowlist extensión ↔ tipo ↔ familia, límites por propósito y tope duro test-first; PBT: ningún nombre normalizado contiene `/`, `\`, CR, LF ni `"` (TC-SECURITY-UPLOAD-001, -002, -003, -014)
- [ ] 2.3 `MagicBytesDetector` y `TextContentInspector` (codificaciones, `NUL`/controles, marcado activo, OFX/QIF/JSON con profundidad) test-first (TC-SECURITY-UPLOAD-006, -007, -010)
- [ ] 2.4 `PdfActiveContentInspector` (firma en el byte 0, flujos de objetos inflados, nombres `#xx` normalizados, acciones prohibidas, `/Encrypt` con contraseña de usuario, límites de objetos e inflado) test-first (TC-SECURITY-UPLOAD-007, -008, -009)
- [ ] 2.5 `OoxmlInspector` (estructura del libro, macros, entradas, tamaño declarado, razón por entrada, rutas, inflado con tope) test-first (TC-SECURITY-UPLOAD-011, -012)
- [ ] 2.6 `StorageQuota` (reserva, uso, liberación, pendientes) y límite de adjuntos por destino test-first (TC-SECURITY-UPLOAD-018, TC-DOCUMENTS-ATTACH-011)

## 3. APPLICATION

- [ ] 3.1 `RequestUpload` (rol, idempotencia, política de tipos y tamaño, cuota con bloqueo de fila, dedupe por SHA-256, presigned PUT con endpoint público, auditoría y recorrido) (TC-DOCUMENTS-ATTACH-001, -002, -007; TC-SECURITY-UPLOAD-001..003, -018)
- [ ] 3.2 `CompleteUpload` con verificación síncrona fuera de transacción, semáforo, `worker_thread` con límites para PDF/XLSX, `MalwareScanner`, cifrado en streaming, borrado de cuarentena y UoW final con auditoría, recorrido y outbox (TC-DOCUMENTS-ATTACH-003..005, -021; TC-SECURITY-UPLOAD-004, -006..013, -019)
- [ ] 3.3 `LinkDocument`, `UnlinkDocument` y `AttachmentTargetRegistry` (sin consulta de periodo, D65) (TC-DOCUMENTS-ATTACH-008..012)
- [ ] 3.4 `ListDocuments`, `GetDocument`, `GetStorageUsage`, `DownloadDocument` (auditoría antes del cuerpo, descifrado verificado) (TC-DOCUMENTS-ATTACH-013..015, -019; TC-SECURITY-UPLOAD-015, -016, -020)
- [ ] 3.5 `ArchiveDocument`/`UnarchiveDocument` y `DeleteDocument` (destrucción del envoltorio en la UoW, borrado del objeto y sus versiones después) (TC-DOCUMENTS-ATTACH-016, -017)
- [ ] 3.6 Jobs `ExpirePendingUploads`, `RecoverStuckUploads`, `SweepQuarantine`, `PurgeUnlinkedDocuments`, `SweepOrphanObjects`, `RewrapDocumentKeys` (TC-DOCUMENTS-ATTACH-006, -018; TC-SECURITY-UPLOAD-013, -017)
- [ ] 3.7 Contratos `@pf/documents/contracts` para IMPORTS: `DocumentQuery.getForProcessing`, `DocumentContentReader.open`, `AttachmentCommand.link`/`unlink` en la UoW del llamador (TC-DOCUMENTS-ATTACH-020)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: schema `documents`, tres tablas con RLS forzada en la forma vigente (fail-closed `PF002`), grants, política `retention_scan` para `pf_maintenance`, registro en `platform.workspace_scoped_table`; TC-SECURITY-RLS-007 recorre las tablas nuevas (TC-SECURITY-UPLOAD-020)
- [ ] 4.2 Mover `envelope.ts` y `key-provider.ts` a `@pf/platform/crypto`, agregar `EncryptStream` y el llavero `DOCUMENT_ENCRYPTION_KEYS` con verificación de claves en uso al arrancar; IDENTITY importa desde ahí; TC-IDENTITY-EXPORT-* y TC-IDENTITY-RESTORE-* en verde (TC-SECURITY-UPLOAD-016, -017)
- [ ] 4.3 Adapter `ObjectStoragePort` completo en `@pf/platform/storage` (presign PUT con cabeceras firmadas y endpoint público, head con checksum, get stream y por rango, put en streaming, delete con versiones, listado por prefijo) con suite de contrato contra SeaweedFS (Testcontainers) (TC-SECURITY-UPLOAD-004, -005)
- [ ] 4.4 Adapters `NoopMalwareScanner` y `ClamdMalwareScanner` (INSTREAM, timeout, `UNAVAILABLE`) (TC-SECURITY-UPLOAD-019)
- [ ] 4.5 Consultas de existencia aditivas en `@pf/transactions/contracts` (transacción y conversión), `@pf/debt/contracts`, `@pf/commitments/contracts`, `@pf/accounts/contracts`, `@pf/planning/contracts` e `@pf/imports/contracts` (si `add-import-pipeline` no la agregó antes); tests de contrato (TC-DOCUMENTS-ATTACH-009)
- [ ] 4.6 Jobs en el worker con `DOCUMENT_MAINTENANCE_CRON`; confirmar con el test de arranque del worker (TC-PLATFORM-EVENTS-018) que no cambia el presupuesto de conexiones (API 22 + worker 34); si no caben, agruparlos en un job secuencial
- [ ] 4.7 Config `DOCUMENT_*`, `OBJECT_STORAGE_QUARANTINE_BUCKET`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `CLAMAV_*` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`); `.env.example` y `pnpm env:init` generan el llavero dev; `migrate` crea la cuarentena sin versioning con CORS
- [ ] 4.8 Despliegue (bloqueada por la pregunta 4): `PF_DOMAIN_FILES` en el Caddyfile limitado a `PUT`/`OPTIONS` firmados sobre el bucket de cuarentena, CSP `connect-src`, `pfos-bootstrap-storage.sh` (cuarentena), `pfos-backup.sh` (sin cuarentena), `pfos.env.example`; runbook del respaldo del llavero fuera del host

## 5. API

- [ ] 5.1 Operaciones de design.md § Contratos en el OpenAPI (tag Documents, `x-openspec-capability`, `x-required-role`, `x-rate-limit: costly`, `Idempotency-Key`, `If-Match`), enums abiertos, códigos nuevos en `ErrorCode` con mensajes es/en/pt; esquemas `contracts/events/documents/*.v1.schema.json`; `pnpm contract:breaking` sin cambios rompedores, Spectral y Redocly sin errores
- [ ] 5.2 Tests de API: matriz de roles (VIEWER no sube ni adjunta, sí descarga), idempotencia y replay sin cuota, `RATE_LIMITED`, `ETag`/`If-Match`, cabeceras de descarga, respuestas validadas contra el OpenAPI (TC-DOCUMENTS-ATTACH-001, -002, -013..015; TC-SECURITY-UPLOAD-015, -020, -021)
- [ ] 5.3 BFF: proxy en streaming de `downloadDocument` conservando `Content-Disposition`, `Content-Type`, `X-Content-Type-Options`, `Content-Security-Policy`, `Cache-Control` y `Repr-Digest`

## 6. UI

- [ ] 6.1 Componente "Adjuntos" (SHA-256 con `crypto.subtle`, subida con `XMLHttpRequest` y progreso con `aria-live`, confirmación, motivo de rechazo traducido, lista, descarga, quitar con confirmación) en los detalles de transacción, conversión, préstamo, suscripción, cuenta, importación y cierre de mes; i18n es/en/pt (TC-DOCUMENTS-ATTACH-022)
- [ ] 6.2 Página `/documentos` (filtros por propósito, estado, archivados y elemento; uso de cuota; archivar, desarchivar, eliminar; aviso de purga de documentos sin vínculo; documentos con contenido pendiente de restaurar) y entrada en la navegación (docs/28)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-DOCUMENTS-ATTACH-001..022 y -026 y TC-SECURITY-UPLOAD-001..021 con el TC-ID en el nombre; actualizar el front matter
- [ ] 7.2 Integración con PostgreSQL y SeaweedFS reales: subir → confirmar → descargar con suma igual; objeto cifrado en el bucket; byte alterado ⇒ `DOCUMENT_CONTENT_CORRUPTED` sin bytes del bloque alterado; dos solicitudes concurrentes por el último espacio (sin `Promise.all` sobre el mismo cliente pg) (TC-SECURITY-UPLOAD-016, -018)
- [ ] 7.3 Suite de uploads maliciosos TC-SECURITY-UPLOAD-022 en el job `integration` (17 casos); el caso EICAR con ClamAV en el `nightly` si la pregunta 2 se responde (b), con imagen fijada por digest y timeout explícito
- [ ] 7.4 E2E Playwright (con `PF_E2E_PROJECT=pfos-e2e-<nombre>`): adjuntar desde el detalle de un gasto, descargar, rechazo de un PNG renombrado (TC-DOCUMENTS-ATTACH-022)

## 8. PORTABILIDAD (bloqueado por la pregunta 3)

- [ ] 8.1 Secciones `documents` y `attachment-links` en el `PortabilityRegistry` con JSON Schema en `contracts/export/v1`, sin claves; importación con remapeo y `CONTENT_PENDING`; test de cobertura de tablas (TC-DOCUMENTS-ATTACH-023)
- [ ] 8.2 Archivo de contenidos del export (`includeDocumentContents`, ZIP en streaming con `EncryptStream`, subida multipart S3, columnas `contents_*`, descarga separada con re-auth, misma retención y descarte) (TC-DOCUMENTS-ATTACH-024)
- [ ] 8.3 `restoreDocumentContents` (multipart en streaming a cuarentena, 202 + operación, verificación de la decisión 4, cifrado con claves nuevas, UoW por documento, reporte, idempotencia) (TC-DOCUMENTS-ATTACH-024, -025)

## 9. DOCUMENTATION

- [ ] 9.1 Aplicar la lista "Cambios a docs compartidos" de design.md (incluido el ADR nuevo que matiza ADR-0009) y actualizar `docs/38-estado-y-pendientes.md`
- [ ] 9.2 README del contexto `packages/contexts/documents` (lenguaje ubicuo, agregados, puertos, eventos; NFR-MAINT-014)
- [ ] 9.3 `pnpm spec:validate`, `pnpm traceability:check` (0 errores, 0 advertencias) y `pnpm format:check` en verde
