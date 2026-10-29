# Diseño: add-document-attachments

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: docs/01 FR-DOCUMENTS-001..009 (001–005 Must, 006–007 Should, 008 Could Phase 9, 009 Phase 11, fuera de alcance); docs/02 NFR-SEC-003/004/006/008/011/012/015, NFR-COMP-002/005, NFR-REL-010/014; docs/05 §2.11 (DOCUMENTS: `RequestUpload`, `ConfirmUpload`, `LinkDocument`, `UnlinkDocument`, `ArchiveDocument`, `GetDownloadUrl`, `ListDocumentsFor`; dependencias `ObjectStorage`, `MalwareScanner`); docs/08 §5.11 (`documents.document`, `documents.attachment_link`); docs/10 (rutas `W/documents/*`, códigos `UPLOAD_*`/`DOCUMENT_REJECTED`, matriz de roles: subir y adjuntar OWNER/EDITOR, descargar todos); docs/11 (`documents.AttachmentUploaded.v1`); docs/12 §3 (STRIDE de object storage), §8 (flujo de subida segura), §10 (cifrado), §13 (descargas auditadas), §16 (pruebas de upload maliciosos, bloqueante en Phase 6) y §17 pregunta 4 (antimalware); docs/13 §1, §4.1, §11, §13 (lo que IMPORTS espera de DOCUMENTS); docs/24 §5.6 (alcance, exit criterion "uploads maliciosos de prueba rechazados", RISK-010); ADR-0009 (puerto `ObjectStorage`, SeaweedFS, claves `ws/<workspaceId>/<context>/<uuidv7>`), ADR-0027 (VPS N1 con Compose, SeaweedFS en el host con réplica nocturna a B2, Lightsail 2 GB por D51); decisiones D65 (adjuntos permitidos en periodos cerrados), D100 (import de workspace ≤ 200 MB en una transacción), D37 (recorrido por agregado), D255/D281 (los extractos reales nunca entran al repositorio), D308–D310 (patrón de barrido con `pf_maintenance`).

### Cómo recibe hoy el archivo el CSV básico (Phase 3)

`add-basic-csv-import` (docs/24 A6) no usa Object Storage ni DOCUMENTS. `POST W/imports` recibe `multipart/form-data` (`file`, `accountId`); `ImportsHttp` (`packages/contexts/imports/src/interface/imports-http.ts`) lee el stream con tope `IMPORT_CSV_MAX_BYTES` (2 MiB, deja de leer al excederlo ⇒ 413 `UPLOAD_TOO_LARGE`), calcula el SHA-256, decodifica y parsea **en memoria en la misma petición**, guarda las celdas en `imports.staged_transaction.raw` y **descarta el binario**. La idempotencia multipart usa como payload `{ fileSha256, accountId }` (D113). No hay cuarentena, verificación por contenido (más allá del sniff de texto del `CsvSniffer`), cifrado ni retención del archivo.

Lo que cambia con este change: **nada en la ruta multipart** (contrato aditivo; se conserva). Este change agrega el camino que Phase 6 necesita: subida presignada a cuarentena, verificación por contenido, cifrado, retención y lectura en streaming desde el worker. Es el pipeline (`add-import-pipeline`, en redacción paralela) el que agrega la variante JSON de `POST W/imports` con `documentId` y decide cuándo deprecar la multipart (pregunta abierta 10; decisión 14).

### Restricciones del despliegue real que condicionan el diseño

- **Producción N1**: SeaweedFS en el host, **sin puertos públicos** (`compose.prod.yaml`: `ports: !reset []`); Caddy publica solo `PF_DOMAIN_APP` y `PF_DOMAIN_AUTH`. La subida presignada desde el navegador exige publicar un endpoint S3 (decisión 2).
- **Sin KMS ni SSE gestionado**: SeaweedFS no ofrece SSE-KMS validado (SPIKE-07 no lo midió) y su réplica nocturna va a B2. El cifrado en reposo lo da la aplicación (decisión 6), igual que los exports (`add-workspace-export` decisión 4).
- **Host de 2 GB** (D51): ClamAV necesita ~1–1,5 GiB de RAM para sus firmas; no cabe junto al stack actual (decisión 5).
- **Presupuesto de conexiones**: API 22 + worker 34 = 56 sobre `max_connections=70` (64 de 67 con pg-boss). Este change **no agrega consumidores de eventos** (decisión 3).

### Capas afectadas

| Capa | Cambios |
|---|---|
| domain | DOCUMENTS (nuevo): agregado `Document` (máquina `PENDING_UPLOAD → UPLOADED → AVAILABLE \| REJECTED`, `AVAILABLE → DELETED`, `CONTENT_PENDING → AVAILABLE \| DELETED`, `PENDING_UPLOAD → REJECTED` por expiración; `archivedAt` como atributo), `AttachmentLink`, VOs `DocumentPurpose`, `DeclaredFile` (nombre normalizado, tipo, tamaño, sha256), `FileTypePolicy` (allowlist extensión ↔ tipo ↔ familia, límites por propósito), `RejectionReason`, `StorageQuota`. Inspectores puros (sin E/S) por formato: `MagicBytesDetector`, `PdfActiveContentInspector`, `TextContentInspector`, `OoxmlInspector`. |
| application | `RequestUpload`, `CompleteUpload` (verificación síncrona), `LinkDocument`, `UnlinkDocument`, `ArchiveDocument`/`UnarchiveDocument`, `DeleteDocument`, `DownloadDocument`, `ListDocuments`, `GetStorageUsage`; jobs `ExpirePendingUploads`, `PurgeUnlinkedDocuments`, `SweepQuarantine`, `SweepOrphanObjects`, `RewrapDocumentKeys`, `RecoverStuckUploads`. Puertos: `DocumentRepository`, `AttachmentLinkRepository`, `StorageUsageRepository`, `ObjectStoragePort` (presign PUT, head, get stream, get range, put stream, delete, delete versions, list prefix), `EnvelopeCipher`/`DocumentKeyProvider`, `MalwareScanner`, `AttachmentTargetRegistry`, `AuditPort`, `LifecyclePort`, `OutboxPort`, `Clock`. |
| infrastructure | Kysely (schema `documents`), adapter S3 completo (`@pf/platform/storage`), cifrado de sobre movido a `@pf/platform/crypto` (decisión 6), adapter ClamAV (`clamd` INSTREAM por TCP) y `NoopMalwareScanner`, inspectores con librerías acotadas (decisión 4), exporter/importer de portabilidad. |
| interface | `DocumentsController` (`W/documents*`), contratos `@pf/documents/contracts` para IMPORTS e IDENTITY (decisión 14), registro de destinos por contexto dueño, jobs del worker; web: componente "Adjuntos" y página `/documentos`; BFF: streaming de la descarga. |

Contextos que cambian solo por contratos aditivos de existencia de destino (decisión 9): TRANSACTIONS (transacción, conversión), DEBT (préstamo), COMMITMENTS (suscripción), ACCOUNTS (cuenta), PLANNING (periodo para el cierre de mes), IMPORTS (importación). IDENTITY: secciones de portabilidad y archivo de contenidos (decisión 13).

## Objetivos / No objetivos

**Objetivos:** almacenar documentos de forma segura (FR-DOCUMENTS-001/002/005), adjuntarlos N:M (FR-DOCUMENTS-003), descargarlos con autorización (FR-DOCUMENTS-004), deduplicar, archivar y purgar (FR-DOCUMENTS-006/007), cifrado en reposo (NFR-SEC-006), cuota, auditoría, recorrido, portabilidad, y dejar la base que el pipeline de imports usa para guardar y leer extractos. Cumplir el exit criterion "uploads maliciosos de prueba rechazados" con una suite definida (TC-SECURITY-UPLOAD-022).

**No objetivos:** OCR o extracción de datos (FR-DOCUMENTS-009, Phase 11); vista previa en línea de imágenes o PDF (todo se descarga como adjunto, docs/12 §8.4); miniaturas; re-codificación de imágenes (pregunta 8); antimalware en producción (pregunta 2); edición o versiones de un documento (un documento es inmutable; se sube otro); compartir documentos por enlace público; subida multiparte del navegador (> 25 MiB no se admite); datos demo con documentos; cambiar la ruta multipart del CSV básico; parsear el contenido financiero (lo hace IMPORTS).

## Decisiones

### 1. Contexto nuevo DOCUMENTS (`@pf/documents`, schema `documents`)

Es el contexto 11 de ARCHITECTURE §3 (Generic, Phase 6). Dueño de los archivos y de los vínculos; no interpreta su contenido financiero (docs/05 §2.11). Alternativa descartada: alojar los documentos en IMPORTS (acoplaría los adjuntos de transacciones al pipeline) o en `@pf/platform` (no es infraestructura: tiene reglas de dominio, estados y auditoría).

### 2. Subida presignada directa a una cuarentena con bucket propio

- `RequestUpload` valida la declaración (`fileName`, `contentType`, `sizeBytes`, `sha256` hex de 64, `purpose`) contra `FileTypePolicy`, la cuota (decisión 11) y crea `Document(PENDING_UPLOAD)`; devuelve un **presigned PUT** (SPIKE-07): `signableHeaders` = `content-type`, `content-length` (tamaño **exacto**) y `x-amz-checksum-sha256` (en `unhoistableHeaders`, para que el almacenamiento rechace un contenido sustituido); `DOCUMENT_UPLOAD_URL_TTL` = `PT5M` (máximo `PT10M`, NFR-SEC-012). La URL se firma con el **endpoint público** (`OBJECT_STORAGE_PUBLIC_ENDPOINT`), distinto del interno (SPIKE-07).
- **Cuarentena = bucket aparte sin versioning** (`OBJECT_STORAGE_QUARANTINE_BUCKET`, clave `ws/{workspaceId}/{documentId}`): un `DELETE` borra de verdad el texto plano (con versioning quedaría una versión no cifrada). Documentos definitivos en el bucket existente `OBJECT_STORAGE_BUCKET` (versionado, SPIKE-07) con clave `ws/{workspaceId}/documents/{documentId}` (ADR-0009). Ninguna clave lleva el nombre original (FR-DOCUMENTS-005).
- **Endpoint público en producción** (pregunta 4, no bloquea la implementación): un tercer hostname `PF_DOMAIN_FILES` en Caddy que solo deja pasar `PUT` y `OPTIONS` sobre `/{bucketDeCuarentena}/ws/…` con `X-Amz-Signature` en la query, y responde 404 a todo lo demás (sin `GET`, `LIST` ni acceso a otros buckets). CORS del bucket de cuarentena solo con el origen de la app y `ExposeHeaders: ETag`; CSP de la web: `connect-src` agrega ese origen (NFR-SEC-008). Alternativas: ruta en el dominio de la app (mezcla orígenes y envía la cookie de sesión al almacenamiento) o subir por la API (contradice FR-DOCUMENTS-001).
- La UI calcula el SHA-256 en el navegador (`crypto.subtle.digest`, archivo ≤ 25 MiB en memoria) y sube con `XMLHttpRequest` para mostrar el progreso.

### 3. Verificación síncrona en la confirmación (API), sin consumidores nuevos

`POST W/documents/{id}/complete` hace, **fuera de toda transacción de base de datos**: `HEAD` (existe, `ContentLength` = declarado; si falta ⇒ 409 `DOCUMENT_UPLOAD_MISSING` y el documento sigue `PENDING_UPLOAD`) → `GET` en streaming del objeto de cuarentena → SHA-256 recalculado (autoritativo, aunque el almacenamiento ya validó el checksum firmado) → inspección por formato (decisión 4) → antimalware si está habilitado (decisión 5) → cifrado en streaming (decisión 6) y `PUT` al bucket de documentos → borrado de la cuarentena. Antes y después hay dos unidades de trabajo cortas: (1) `PENDING_UPLOAD → UPLOADED` (marca de inicio, `verification_started_at`) y (2) `UPLOADED → AVAILABLE | REJECTED` con auditoría, recorrido y outbox en la misma UoW (INV-029). La respuesta es **200 con el documento en su estado final** (`AVAILABLE` o `REJECTED` + `rejectionReason`): el rechazo es un resultado de la verificación, no un error de la petición.

- **Concurrencia acotada**: semáforo por proceso `DOCUMENT_VERIFY_MAX_CONCURRENCY` = 2; si está lleno ⇒ 503 `SERVICE_UNAVAILABLE` con `Retry-After: 5` (la UI reintenta). Memoria: el PDF y el XLSX se inspeccionan con el archivo en memoria (≤ 25 MiB; la inspección necesita acceso aleatorio a la tabla xref y al directorio central del ZIP); el resto en streaming por bloques de 64 KiB. Pico estimado ≤ 2 × 25 MiB + bibliotecas por proceso de API.
- **Aislamiento del parser**: la inspección de PDF y XLSX corre en un `worker_thread` con `resourceLimits` (`maxOldGenerationSizeMb` 128) y un tiempo máximo `DOCUMENT_INSPECTION_TIMEOUT` = `PT10S`; vencido ⇒ `REJECTED` con `MALFORMED_CONTENT` (falla cerrada).
- **Recuperación**: si la API cae a mitad, el documento queda `UPLOADED`; el job `RecoverStuckUploads` (worker, cada 10 min) reintenta la verificación de los `UPLOADED` con `verification_started_at` de más de 10 min, con el mismo código.
- **Por qué no en el worker** (docs/12 §8.4 y ADR-0009 dicen "worker"): un consumidor nuevo (`documents.verify`, concurrencia 1) costaría +1 conexión del worker (34 → 35; total 65 de 67) en un presupuesto ya justo, y la UI tendría que sondear el resultado. La verificación síncrona da el motivo de rechazo en la misma respuesta, no toca el presupuesto (usa el pool de la API en dos transacciones cortas, sin retener conexión durante el streaming) y la cuota `costly` (10/min por usuario) acota la carga. **Alternativa** documentada para el día que exista un escáner lento: mover la verificación a un consumidor con el mismo código (los inspectores son puros) y `202` en `complete`. Se anota en "Cambios a docs compartidos" (docs/12 §8.4, ADR-0009).

### 4. Detección del tipo real y controles por formato

| Familia (extensiones → tipo canónico) | Firma / estructura exigida | Controles extra | Motivo de rechazo |
|---|---|---|---|
| PDF (`pdf` → `application/pdf`) | `%PDF-1.` en el byte 0 (docs/12 exige firma en el inicio; los lectores toleran 1 KiB, lo que habilita políglotas) | Parser que **infla los flujos de objetos** (PDF 1.5+) y **normaliza nombres** (`#xx`): rechaza `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `/GoToE`, `/SubmitForm`, `/ImportData`; `/OpenAction` o `/AA` solo si apuntan a una de esas acciones. `/Encrypt` con contraseña de usuario no vacía ⇒ rechazo; solo contraseña de propietario (permisos) ⇒ se acepta (pregunta 7). Límites: 10 000 objetos, 50 MiB inflados en total | `TYPE_MISMATCH`, `ACTIVE_CONTENT`, `ENCRYPTED_CONTENT`, `MALFORMED_CONTENT` |
| Imagen (`png`, `jpg`/`jpeg`, `webp`, `heic`) | PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; WebP `RIFF????WEBP`; HEIC caja `ftyp` con marca `heic`/`heix`/`mif1`/`msf1` | Dimensiones ≤ 50 000 px por lado (lectura de cabecera, sin decodificar); sin re-codificar (pregunta 8) | `TYPE_MISMATCH`, `MALFORMED_CONTENT` |
| Texto (`csv` → `text/csv`, `ofx`/`qfx` → `application/x-ofx`, `qif` → `application/qif`, `json` → `application/json`) | Decodificable como UTF-8 (con o sin BOM), UTF-16 con BOM o windows-1252 (docs/13 §12); sin `NUL` ni controles C0 salvo `\t \r \n` | Primeros 1 KiB sin `<!doctype html`, `<html`, `<script`, `<svg`, `<?xml … <svg`, `<iframe`, `javascript:` (insensible a mayúsculas, tras BOM y espacios). OFX: cabecera `OFXHEADER:` o `<OFX>`; QIF: `!Type:` o `!Account`; JSON: parseo con profundidad ≤ 64 | `ACTIVE_CONTENT`, `MALFORMED_CONTENT`, `TYPE_MISMATCH` |
| XLSX (`xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) | ZIP (`PK\x03\x04`) con `[Content_Types].xml` y `xl/workbook.xml` | Lectura del directorio central sin inflar: ≤ 1000 entradas, Σ tamaños declarados ≤ 100 MiB, razón por entrada ≤ 100:1, sin rutas absolutas ni `..`; inflado en streaming con tope (el tamaño declarado puede mentir). `xl/vbaProject.bin`, tipo `macroEnabled` o `activeX` ⇒ macros | `MACROS_PRESENT`, `ARCHIVE_LIMITS_EXCEEDED`, `TYPE_MISMATCH` |

La extensión, el tipo declarado y la familia detectada deben coincidir (`TYPE_MISMATCH` si no). Un contenido sin familia reconocible ⇒ `TYPE_NOT_ALLOWED`. Bibliotecas candidatas (las fija la implementación con revisión de licencia y CVE): `file-type` para la firma, un parser PDF de bajo nivel que exponga objetos y flujos (p. ej. `pdf-lib` o `pdfjs-dist` en modo de solo estructura), `yauzl` para el directorio central. Ningún inspector ejecuta macros, fórmulas, scripts ni renderiza.

`DocumentRejectionReason` (enum abierto, no HTTP): `UPLOAD_NOT_COMPLETED`, `SIZE_MISMATCH`, `CHECKSUM_MISMATCH`, `TYPE_NOT_ALLOWED`, `TYPE_MISMATCH`, `ACTIVE_CONTENT`, `ENCRYPTED_CONTENT`, `MACROS_PRESENT`, `ARCHIVE_LIMITS_EXCEEDED`, `MALFORMED_CONTENT`, `MALWARE_DETECTED`.

### 5. Antimalware: puerto `MalwareScanner`, deshabilitado por defecto

Puerto `MalwareScanner.scan(stream) → CLEAN | INFECTED(signature) | UNAVAILABLE`; adapters `NoopMalwareScanner` (devuelve `NOT_SCANNED`) y `ClamdMalwareScanner` (protocolo `INSTREAM` de `clamd` por TCP, `DOCUMENT_MALWARE_SCAN_TIMEOUT` = `PT30S`). Config `DOCUMENT_MALWARE_SCANNER` = `none` (defecto) | `clamav`. Habilitado: `UNAVAILABLE` ⇒ la confirmación responde 503 `SERVICE_UNAVAILABLE` y el documento queda `UPLOADED` (falla cerrada; `RecoverStuckUploads` reintenta). Columna `scan_status` (`NOT_SCANNED`, `CLEAN`; `INFECTED` termina en `REJECTED/MALWARE_DETECTED`). Con `none`, la mitigación es la de docs/12 §8.4: nunca se sirve en línea (decisión 7). Requirement **Could** (FR-DOCUMENTS-008 es Could de Phase 9); adoptarlo en la suite depende de la **pregunta 2**.

**EICAR en el repositorio:** la cadena de prueba EICAR **no se versiona** ni aparece completa en ningún archivo fuente: el antivirus de la máquina Windows del owner (Defender) pondría en cuarentena el archivo al hacer checkout. El test la construye en memoria desde fragmentos.

### 6. Cifrado de sobre a nivel de aplicación (reutiliza el formato de los exports)

- Se **mueve** el cifrado de sobre de `packages/contexts/identity/src/infrastructure/portability/{envelope,key-provider}.ts` a `@pf/platform/crypto` (formato `PFXE` v1 de `contracts/export/v1/ENCRYPTION.md`: AES-256-GCM por bloques de 64 KiB, número de bloque y marca de último bloque en el AAD) y se agrega `EncryptStream` (hoy solo existe `encryptEnvelope(Buffer)` y `DecryptStream`). IDENTITY pasa a importarlo desde ahí, sin cambio de comportamiento (sus tests TC-IDENTITY-EXPORT-* siguen en verde). Alternativa descartada: duplicar el código en DOCUMENTS (dos implementaciones criptográficas que divergen).
- **Clave de datos por documento** (256 bits), envuelta con la clave maestra activa de un **llavero propio** `DOCUMENT_ENCRYPTION_KEYS` / `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID` (mismo formato que `EXPORT_ENCRYPTION_KEYS`). AAD del envoltorio: `documents:{workspaceId}:{documentId}` (un envoltorio copiado a otra fila no descifra). `{ key_id, wrapped_key }` en `documents.document`, nunca en el bucket. Llavero separado del de exports porque los exports viven ≤ 7 días y los documentos años: distinto ciclo de rotación y menor radio de compromiso.
- **Rotación** (Should): `RewrapDocumentKeys` (diario y bajo demanda) desenvuelve y vuelve a envolver las claves de datos con la clave activa en lotes de 500, sin tocar el contenido. Al arrancar, la API y el worker verifican que todo `key_id` en uso esté en el llavero (consulta agregada barata) y, si falta, fallan con el id faltante.
- **Borrado = destrucción de la clave** (crypto-shredding): `DeleteDocument` pone `wrapped_key = NULL` y `key_id = NULL` en la misma UoW, y después borra el objeto **y sus versiones** (`DeleteObject` con `VersionId`, el bucket es versionado). Así las copias en la réplica de B2 quedan ilegibles. **Límite honesto:** los backups de la base (pgBackRest, fulls mensuales × 12, ADR-0027) conservan el envoltorio hasta 12 meses; el borrado efectivo frente a una restauración completa es ≤ 12 meses (se documenta en docs/30).
- **La pérdida del llavero = pérdida de todos los documentos**: el llavero debe respaldarse fuera del host (gestor de contraseñas del owner o el secreto de despliegue), igual que la clave de pgBackRest. Riesgo y tarea de runbook.

### 7. Descarga solo a través de la API, en streaming

`GET W/documents/{id}/download` (VIEWER+): `GetObject` en streaming → `DecryptStream` (valida el tag de cada bloque antes de emitirlo; un fallo aborta la respuesta y, si aún no se enviaron cabeceras, responde 422 `DOCUMENT_CONTENT_CORRUPTED`) → respuesta. Cabeceras: `Content-Type` = tipo canónico de la familia detectada; `Content-Disposition: attachment; filename="<ascii seguro>"; filename*=UTF-8''<RFC 5987>` (nombre normalizado; `"`, `;`, `\`, CR, LF y controles eliminados de la parte ASCII); `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox; default-src 'none'`; `Cache-Control: private, no-store`; `Content-Length`; `Repr-Digest: sha-256=:<base64>:`. Por el BFF (mismo dominio, cookie de sesión), igual que la descarga del export.

**Contradice** FR-DOCUMENTS-004 ("presigned GET de corta duración"), NFR-SEC-012 (GET ≤ 5 min) y ADR-0009 ("descarga vía presigned GET"): con cifrado a nivel de aplicación el almacenamiento solo tiene texto cifrado. Es la misma decisión que `add-workspace-export` decisión 5. Requiere confirmación del owner (**pregunta 1, bloqueante**) y un ADR nuevo que matice ADR-0009 (borrador al final). La autorización por workspace previa (lo que FR-DOCUMENTS-004 protege) se mantiene y se refuerza: no existe ninguna URL de descarga reutilizable.

### 8. Modelo de datos (schema `documents`, migración expand)

| Tabla | Definición | RLS / grants |
|---|---|---|
| `documents.document` | `id uuid PK (v7), workspace_id, purpose text CHECK IN ('RECEIPT','INVOICE','STATEMENT','CONTRACT','IMPORT_SOURCE','OTHER'), status text CHECK IN ('PENDING_UPLOAD','UPLOADED','AVAILABLE','REJECTED','DELETED','CONTENT_PENDING'), original_name text (≤ 255, normalizado NFC), extension text, declared_content_type text, detected_content_type text NULL, detected_format text NULL CHECK IN ('PDF','PNG','JPEG','WEBP','HEIC','CSV','OFX','QIF','JSON','XLSX'), size_bytes bigint CHECK (size_bytes > 0 AND size_bytes <= 26214400), sha256 bytea CHECK (octet_length = 32), quarantine_key text NULL, object_key text NULL, encrypted_size_bytes bigint NULL, key_id text NULL, wrapped_key bytea NULL, envelope_version smallint NULL, scan_status text NULL CHECK IN ('NOT_SCANNED','CLEAN'), scan_engine text NULL, rejection_reason text NULL, upload_expires_at, verification_started_at NULL, uploaded_at NULL, available_at NULL, rejected_at NULL, archived_at NULL, archived_by NULL, deleted_at NULL, deleted_by NULL, last_unlinked_at NULL, restored_from jsonb NULL, created_by, created_at, updated_at, version`. CHECKs: `REJECTED ⇒ rejection_reason IS NOT NULL`; `AVAILABLE ⇒ object_key, key_id, wrapped_key NOT NULL`; `DELETED ⇒ wrapped_key IS NULL`. Únicos: `(workspace_id, object_key)`; **parcial** `(workspace_id, sha256) WHERE status = 'AVAILABLE'` (dedupe, FR-DOCUMENTS-006). Índices: `(workspace_id, status) WHERE status IN ('PENDING_UPLOAD','UPLOADED')`, `(workspace_id, purpose, available_at DESC)`, `(key_id) WHERE wrapped_key IS NOT NULL` (rotación) | WS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE; `pf_maintenance` política `retention_scan` (SELECT de `id, workspace_id, status, upload_expires_at, verification_started_at, last_unlinked_at, archived_at, key_id`, patrón D308–D310) |
| `documents.attachment_link` | `id, workspace_id, document_id FK → document, target_type text CHECK IN ('TRANSACTION','CONVERSION','LOAN','SUBSCRIPTION','ACCOUNT','IMPORT_JOB','MONTH_CLOSING'), target_id uuid, created_by, created_at`. Único `(workspace_id, document_id, target_type, target_id)`; índice `(workspace_id, target_type, target_id)` | WS forzada; `pf_app` SELECT/INSERT/DELETE (desvincular borra la fila, docs/08 §5.11, no es dato financiero; auditado); `pf_worker` SELECT/DELETE |
| `documents.storage_usage` | `workspace_id PK, used_bytes bigint ≥ 0, reserved_bytes bigint ≥ 0, pending_uploads int ≥ 0, updated_at` (contadores de la decisión 11) | WS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE |

Las tres se registran en `platform.workspace_scoped_table` (purga demo, ADR-0026; TC-SECURITY-RLS-007 las recorre). `MONTH_CLOSING` usa el id del **periodo financiero** que se cierra (existe antes del cierre). El CHECK de `target_type` es ampliable (expand) si el owner suma `CREDIT_CARD_STATEMENT`, `GOAL` o `RECONCILIATION` de docs/08 (pregunta 9). La purga demo borra filas: los objetos quedan huérfanos y los borra `SweepOrphanObjects` (decisión 10); las claves ya no existen (crypto-shredding).

### 9. Vínculos polimórficos con registro de destinos

`AttachmentTargetRegistry` (application de DOCUMENTS) mapea `targetType → AttachmentTargetLookup.existing(workspaceId, ids[]) → Set<id>`. El composition root registra un adapter por tipo que llama al **contrato público del dueño**: TRANSACTIONS `TransactionExistenceQuery` (`TRANSACTION`: cualquier tipo no anulado ni anulado —un comprobante de una transacción anulada sigue siendo evidencia—; `CONVERSION`: solo `kind = CONVERSION`), DEBT `LoanExistenceQuery`, COMMITMENTS `SubscriptionExistenceQuery`, ACCOUNTS `AccountExistenceQuery`, PLANNING `FinancialPeriodExistenceQuery`, IMPORTS `ImportJobExistenceQuery`. Cada uno es una consulta set-based nueva y aditiva en `@pf/<ctx>/contracts`, bajo RLS. Sin FK cruzadas (ARCHITECTURE §2, docs/08 §5.11). Un elemento que deja de existir (no ocurre: nada se borra en duro) lo detectaría el job de huérfanos de docs/08 §5.11, que aquí se reduce a una métrica `documents_orphan_links_total` en `SweepOrphanObjects` (sin borrar vínculos).

Periodo cerrado (D65): vincular y desvincular no consulta el periodo. Límite por destino: `DOCUMENT_MAX_LINKS_PER_TARGET` = 20, contado con `SELECT … FOR UPDATE` sobre los vínculos del destino en la UoW (dos vínculos paralelos al mismo destino se serializan).

### 10. Retención, archivado, borrado y barridos

| Job (worker, cron `DOCUMENT_MAINTENANCE_CRON`, por defecto cada 10 min salvo indicación) | Rol | Qué hace |
|---|---|---|
| `ExpirePendingUploads` | `pf_maintenance` para encontrar candidatos; `pf_worker` con `SET LOCAL app.workspace_id` para mutar | `PENDING_UPLOAD` con `upload_expires_at + DOCUMENT_UPLOAD_GRACE (PT1H)` vencido ⇒ `REJECTED/UPLOAD_NOT_COMPLETED`, borra la cuarentena, libera la reserva |
| `RecoverStuckUploads` | ídem | `UPLOADED` con `verification_started_at` > 10 min ⇒ reintenta la verificación (decisión 3) |
| `SweepQuarantine` (cada hora) | sin BD salvo consulta de estado | lista el bucket de cuarentena; objeto > 24 h ⇒ borrado (red de seguridad del requirement "Cuarentena hasta la verificación") |
| `PurgeUnlinkedDocuments` (diario) | ídem | `AVAILABLE`, sin vínculos, `archived_at IS NULL`, `COALESCE(last_unlinked_at, available_at) < now − DOCUMENT_UNLINKED_RETENTION (P30D)` ⇒ borrado como en la decisión 6 con actor `SYSTEM` (pregunta 6) |
| `SweepOrphanObjects` (diario) | ídem | objetos del bucket de documentos sin fila `AVAILABLE`/`CONTENT_PENDING` que los referencie y con más de 24 h ⇒ borrado de todas sus versiones; métrica de vínculos huérfanos |
| `RewrapDocumentKeys` (diario) | ídem | decisión 6 |

Cada mutación de estado lleva auditoría (actor `SYSTEM`), recorrido y outbox en su UoW. Los jobs corren en las conexiones reservadas de mantenimiento del worker, como `imports.purge-staging` y `identity.export-retention` (la tarea 4.6 lo verifica con el test de arranque del worker; si no cupieran, se agrupan en un solo job secuencial). Borrar el contenido no viola "sin hard delete de datos financieros" (NFR-DATA-012): el documento es evidencia adjunta, sus metadatos se conservan y ningún asiento cambia.

### 11. Cuota con contadores por workspace

`documents.storage_usage` se actualiza en la misma UoW que la transición: `RequestUpload` toma `SELECT … FOR UPDATE` de la fila (la crea si falta), comprueba `used + reserved + size ≤ DOCUMENT_WORKSPACE_QUOTA_BYTES` (5 GiB) y `pending_uploads < DOCUMENT_MAX_PENDING_UPLOADS` (20) y reserva; `AVAILABLE` mueve de reservado a usado; `REJECTED` libera la reserva; `DELETED` resta del usado; archivar no cambia nada. El bloqueo de fila serializa las solicitudes concurrentes del mismo workspace (escenario "Dos solicitudes por el último espacio"). Verificación de deriva: `RewrapDocumentKeys` recalcula los contadores con `SUM` y emite `documents_storage_usage_drift_bytes` si difieren. Los límites de disco del host: 5 GiB por workspace sobre el SSD de 60 GB del plan elegido; se vigila con la métrica de uso.

### 12. Auditoría, recorrido, eventos y observabilidad

- Auditoría (INV-029, FR-AUDIT-001/005): `documents.document.upload_requested`, `.accepted`, `.rejected`, `.expired`, `.archived`, `.unarchived`, `.deleted`, `.purged`, `.downloaded`, `.content_restored`, `documents.attachment.linked`, `.unlinked`. Diff con `purpose`, `sizeBytes`, `detectedFormat`, `rejectionReason`, `targetType`, `targetId`; **nunca el nombre original** (dato que puede llevar PII, docs/12 §1) ni el contenido. La descarga se audita en la misma transacción de lectura que autoriza (escritura corta antes de emitir el cuerpo; si falla, no se entrega el archivo).
- Recorrido (D37, requirement Should en `audit/lifecycle-timeline`): máquina declarada con las transiciones de la spec; archivar, desarchivar, vincular y desvincular como anotaciones; `GET W/documents/{id}/lifecycle`.
- Eventos por outbox (sin consumidores obligatorios en este change, por lo tanto sin costo de conexiones): `documents.AttachmentUploaded.v1` (nombre de docs/11; se publica al quedar `AVAILABLE`) y `documents.DocumentRejected.v1` (nuevo; reemplaza el `DocumentQuarantined` de docs/05, que no tiene definición). `AttachmentLinked` de docs/05 **no se emite** (sin consumidores; lo cubre la auditoría).
- Métricas (docs/18): `documents_uploads_total{result,reason,format}`, `documents_verification_duration_seconds{format}`, `documents_verify_inflight`, `documents_downloads_total`, `documents_storage_used_bytes` (agregado global, sin workspace), `documents_quarantine_objects`, `documents_orphan_links_total`, `documents_storage_usage_drift_bytes`. Logs: solo `documentId`, `workspaceId`, códigos y tamaños (NFR-SEC-015); test canario con un nombre con PII (TC-SECURITY-UPLOAD-014).

### 13. Portabilidad: metadatos en el export, contenidos en un archivo aparte

El export actual arma el ZIP **en memoria** (`built.zip: Buffer`) y la importación tiene un tope de 200 MB en una sola transacción (D100). Meter los binarios en ese ZIP rompe ambos con la cuota de 5 GiB. Diseño propuesto (pregunta 3, **bloquea solo el grupo 8**):

- **ZIP principal**: dos secciones nuevas de DOCUMENTS en el `PortabilityRegistry` (`documents` orden 900, `attachment-links` orden 910, después de todos los destinos), con JSON Schema en `contracts/export/v1/documents.schema.json` y `attachment-links.schema.json`. Sin `key_id`, `wrapped_key`, `object_key` ni `quarantine_key`. La importación remapea `id`, `workspace_id`, `target_id` (por el mapa `oldId → newId` existente) y deja `AVAILABLE` (y `CONTENT_PENDING` del origen) como **`CONTENT_PENDING`**; `DELETED` y `REJECTED` se conservan; recalcula `storage_usage` (los `CONTENT_PENDING` cuentan como usados para que la restauración no supere la cuota).
- **Archivo de contenidos** (Should): `POST W/exports` acepta `includeDocumentContents: boolean` (defecto `false`). Si es `true`, tras terminar el ZIP principal el mismo job genera un segundo artefacto **en streaming** (`documents/<documentId>` por cada `AVAILABLE` + `documents-manifest.json` con `documentId, sha256, sizeBytes`) cifrado con su propia clave de datos (`EncryptStream`, decisión 6) y subido por multipart S3 al bucket de exports; columnas aditivas en `iam.workspace_export`: `contents_object_key, contents_size_bytes, contents_sha256, contents_key_id, contents_wrapped_key, contents_count`. Descarga `GET W/exports/{id}/document-contents/download` con los mismos requisitos (OWNER, re-auth), misma retención y descarte.
- **Restauración**: `POST W/documents/content-restores` (OWNER, re-auth, `Idempotency-Key`, multipart en streaming hacia la cuarentena, tope `DOCUMENT_CONTENTS_RESTORE_MAX_BYTES` = cuota del workspace) ⇒ `202` + operación; el worker recorre el ZIP en streaming y, por cada `documentId` remapeado (lo resuelve con `iam.workspace_import.report` del import de origen), compara la suma, aplica la **misma verificación de la decisión 4** (un export puede venir alterado), cifra con clave nueva y pasa a `AVAILABLE` en una UoW por documento. Idempotente por documento (solo actúa sobre `CONTENT_PENDING`). Reporte: restaurados, ya disponibles, `CHECKSUM_MISMATCH`, ausentes.
- Alternativas descartadas en la pregunta 3: (a) solo metadatos (el export deja de ser completo, NFR-REL-014); (b) binarios en el mismo ZIP con export e import en streaming y límite mayor (cambia D100 y la atomicidad del import).

### 14. Lo que el pipeline de imports necesita de DOCUMENTS (coordinación con `add-import-pipeline`)

Contratos en `@pf/documents/contracts` (aditivos; ningún contexto importa el dominio de DOCUMENTS):

| Contrato | Firma | Notas |
|---|---|---|
| Subida | **la del usuario**: la UI sube el extracto por `POST W/documents/uploads` con `purpose = IMPORT_SOURCE` y luego crea la importación con `documentId` | Un solo flujo de subida para todo; IMPORTS no firma URLs ni toca la cuarentena |
| `DocumentQuery.getForProcessing` | `(workspaceId, documentId) → { status, purpose, detectedFormat, detectedContentType, sizeBytes, sha256 (hex), originalName, availableAt } \| null` | Bajo RLS; `originalName` para mostrar, nunca para loguear |
| `DocumentContentReader.open` | `(workspaceId, documentId) → Promise<Readable>` | Solo `AVAILABLE`; si no, `DocumentNotAvailableError` (la API de IMPORTS lo traduce a 409 `DOCUMENT_NOT_AVAILABLE`). Texto plano verificado por bloque; alteración ⇒ `DocumentIntegrityError` y el flujo se destruye sin emitir el bloque. Memoria O(64 KiB). Pensado para el worker (`imports.pipeline`) |
| `AttachmentCommand.link` / `unlink` | `(uow, { workspaceId, documentId, targetType: 'IMPORT_JOB', targetId, actor }) → { linkId, created }` | En la UoW del llamador (como `recordBatch`), idempotente, auditado; IMPORTS vincula el extracto al crear el job |
| Eventos | `documents.AttachmentUploaded.v1` / `documents.DocumentRejected.v1` con `purpose` | **Recomendación:** IMPORTS no los consume (se ahorra un consumidor): exige `AVAILABLE` al crear el job; la UI ya conoce el resultado por la respuesta síncrona de `complete` |
| Retención | Un documento vinculado nunca se purga; `IMPORT_SOURCE` sin vínculo se purga a los 30 días | docs/13 §3.2 "el archivo se conserva según la retención de Documents" |
| Límites | `IMPORT_SOURCE` ≤ 20 MiB (docs/13 §11); estructura de XLSX y PDF ya validada | El parser de IMPORTS debe igual acotar filas, memoria y tiempo (docs/13 §11); DOCUMENTS no garantiza que el contenido sea un extracto válido |
| Existencia del destino | IMPORTS publica `ImportJobExistenceQuery` en `@pf/imports/contracts` | Lo agrega este change si llega primero; si no, el pipeline |
| Dedupe de archivo | La suma SHA-256 del documento es la de `import_job.file_checksum` | `IMPORT_FILE_ALREADY_IMPORTED` sigue siendo de IMPORTS; un mismo extracto subido dos veces devuelve el mismo documento (FR-DOCUMENTS-006) |

**Ruta multipart del CSV básico** (pregunta 10, decisión del pipeline): recomendación ⇒ se conserva sin cambios (≤ 2 MiB, sin guardar el binario, docs/24 A6) y se marca `deprecated: true` en el OpenAPI (cambio aditivo para oasdiff) cuando la UI pase al flujo con `documentId`; no se agrega una "ingesta del lado del servidor" que reciba binarios por la API.

### 15. Configuración nueva (`@pf/platform` y docs/config-reference)

`OBJECT_STORAGE_QUARANTINE_BUCKET`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `DOCUMENT_MAX_BYTES` (15728640), `DOCUMENT_IMPORT_SOURCE_MAX_BYTES` (20971520), tope duro 26214400 validado al arrancar, `DOCUMENT_WORKSPACE_QUOTA_BYTES` (5368709120), `DOCUMENT_MAX_PENDING_UPLOADS` (20), `DOCUMENT_MAX_LINKS_PER_TARGET` (20), `DOCUMENT_UPLOAD_URL_TTL` (`PT5M`, máx. `PT10M`), `DOCUMENT_UPLOAD_GRACE` (`PT1H`), `DOCUMENT_UNLINKED_RETENTION` (`P30D`), `DOCUMENT_VERIFY_MAX_CONCURRENCY` (2), `DOCUMENT_INSPECTION_TIMEOUT` (`PT10S`), `DOCUMENT_XLSX_MAX_ENTRIES` (1000), `DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES` (104857600), `DOCUMENT_ARCHIVE_MAX_RATIO` (100), `DOCUMENT_JSON_MAX_DEPTH` (64), `DOCUMENT_ENCRYPTION_KEYS` (secreto), `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID`, `DOCUMENT_MALWARE_SCANNER` (`none`), `CLAMAV_HOST`, `CLAMAV_PORT` (3310), `DOCUMENT_MALWARE_SCAN_TIMEOUT` (`PT30S`), `DOCUMENT_MAINTENANCE_CRON`, `DOCUMENT_CONTENTS_RESTORE_MAX_BYTES`. `.env.example` con valores dev obvios (`pnpm env:init` genera el llavero dev); nunca claves reales.

### 16. Infraestructura

- **Compose local** (`deploy/compose/compose.yaml`): `migrate` crea el bucket de cuarentena **sin versioning** con CORS (`ensureQuarantineBucket`, junto a `ensureBucket`/`ensureExportsBucket`); perfil opcional `clamav` con `clamav/clamav` (no en `core`).
- **Producción**: `PF_DOMAIN_FILES` en Caddy (decisión 2), `pfos-bootstrap-storage.sh` crea el bucket de cuarentena, `pfos-backup.sh` replica solo el bucket de documentos (cifrado) a B2, **nunca** la cuarentena; `pfos.env.example` con las variables nuevas; el llavero en el archivo de secretos del host y respaldado fuera (decisión 6).
- **Testcontainers**: el harness de integración ya levanta SeaweedFS (`apps/api/test/support/images.ts`); la suite maliciosa corre contra él. ClamAV en CI solo si la pregunta 2 lo adopta (job `nightly`, imagen fijada por digest).

## Contratos

### OpenAPI (`contracts/openapi/finance-api.v1.yaml`, aditivo; tag `Documents`, `x-openspec-capability: documents/attachments`)

| Operación | Ruta | Rol / requisitos | Respuesta |
|---|---|---|---|
| `requestDocumentUpload` | `POST W/documents/uploads` body `{ fileName (1..255), contentType, sizeBytes (int64 ≥ 1), sha256 (^[0-9a-f]{64}$), purpose }` | OWNER/EDITOR, `Idempotency-Key`, `x-rate-limit: costly` | 201 `{ document: Document, upload: { url, method: "PUT", headers: { "Content-Type", "x-amz-checksum-sha256" }, expiresAt } }` · 200 `{ document, upload: null, deduplicated: true }` · 413 `UPLOAD_TOO_LARGE` · 422 `UPLOAD_TYPE_NOT_ALLOWED`, `DOCUMENT_QUOTA_EXCEEDED`, `VALIDATION_FAILED` · 409 `DOCUMENT_PENDING_UPLOADS_EXCEEDED` |
| `completeDocumentUpload` | `POST W/documents/{documentId}/complete` | OWNER/EDITOR, `Idempotency-Key`, `costly` | 200 `Document` (`AVAILABLE` o `REJECTED` + `rejectionReason`) · 409 `DOCUMENT_UPLOAD_MISSING` · 409 `INVALID_STATUS_TRANSITION` (p. ej. `DELETED`) · 503 `SERVICE_UNAVAILABLE` + `Retry-After` |
| `getDocument` | `GET W/documents/{documentId}` | VIEWER+ | 200 `Document` + `ETag` |
| `listDocuments` | `GET W/documents?purpose&status&archived&targetType&targetId&cursor&limit` | VIEWER+ | 200 página por cursor de `Document` (con `links[]`) |
| `downloadDocument` | `GET W/documents/{documentId}/download` | VIEWER+ | 200 binario en streaming (cabeceras de la decisión 7) · 409 `DOCUMENT_NOT_AVAILABLE`/`DOCUMENT_REJECTED` · 410 `DOCUMENT_DELETED` · 422 `DOCUMENT_CONTENT_CORRUPTED` |
| `linkDocument` | `POST W/documents/{documentId}/links` body `{ targetType, targetId }` | OWNER/EDITOR, `Idempotency-Key` | 201 `AttachmentLink` · 200 existente · 422 `REFERENCE_NOT_FOUND` · 409 `DOCUMENT_NOT_AVAILABLE`/`DOCUMENT_REJECTED`/`ATTACHMENT_LIMIT_EXCEEDED` · 410 `DOCUMENT_DELETED` |
| `unlinkDocument` | `DELETE W/documents/{documentId}/links/{linkId}` | OWNER/EDITOR | 204 |
| `archiveDocument` / `unarchiveDocument` | `POST W/documents/{documentId}/archive` · `/unarchive` | OWNER/EDITOR, `If-Match` | 200 `Document` |
| `deleteDocument` | `DELETE W/documents/{documentId}` | OWNER/EDITOR, `If-Match` | 204 · 409 `INVALID_STATUS_TRANSITION` |
| `getDocumentStorageUsage` | `GET W/documents/usage` | VIEWER+ | 200 `{ usedBytes, reservedBytes, quotaBytes, pendingUploads, maxPendingUploads }` |
| `getDocumentLifecycle` | `GET W/documents/{documentId}/lifecycle` | VIEWER+ | 200 recorrido (forma de `audit/lifecycle-timeline`) |
| `restoreDocumentContents` | `POST W/documents/content-restores` (multipart `file`) | OWNER, re-auth, `Idempotency-Key`, `costly` | 202 + operación · 413 `UPLOAD_TOO_LARGE` · 422 `EXPORT_FORMAT_UNSUPPORTED` |
| `downloadWorkspaceExportDocumentContents` | `GET W/exports/{id}/document-contents/download` | OWNER, re-auth | 200 `application/zip` · 404 si el export no los incluye · 409/410/422 como el export |
| `requestWorkspaceExport` (modificada, aditiva) | `POST W/exports` | igual | body opcional `{ includeDocumentContents?: boolean }`; `WorkspaceExport` agrega `documentContents?: { sizeBytes, sha256, count }` |

`Document`: `{ id, purpose, status, originalName, extension, declaredContentType, detectedContentType?, detectedFormat?, sizeBytes, sha256, scanStatus?, rejectionReason?, uploadExpiresAt?, availableAt?, archivedAt?, deletedAt?, links: [{ id, targetType, targetId, createdAt }], createdBy, createdAt, version }`. Enums abiertos (`x-extensible-enum`): `DocumentPurpose`, `DocumentStatus`, `DocumentRejectionReason`, `AttachmentTargetType`, `DocumentScanStatus`, `DocumentFormat`.

**Códigos nuevos en `ErrorCode` (`x-extensible-enum`):** `UPLOAD_TYPE_NOT_ALLOWED` (422), `DOCUMENT_QUOTA_EXCEEDED` (422), `DOCUMENT_PENDING_UPLOADS_EXCEEDED` (409), `DOCUMENT_UPLOAD_MISSING` (409), `DOCUMENT_NOT_AVAILABLE` (409), `DOCUMENT_REJECTED` (409), `DOCUMENT_DELETED` (410), `DOCUMENT_CONTENT_CORRUPTED` (422), `ATTACHMENT_LIMIT_EXCEEDED` (409). Reutiliza `UPLOAD_TOO_LARGE`, `REFERENCE_NOT_FOUND`, `VALIDATION_FAILED`, `INVALID_STATUS_TRANSITION`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INSUFFICIENT_ROLE`, `RESOURCE_NOT_FOUND`, `REAUTHENTICATION_REQUIRED`. `UPLOAD_CHECKSUM_MISMATCH` de docs/10 **no se agrega**: la suma distinta la rechaza el almacenamiento (y la confirmación responde `DOCUMENT_UPLOAD_MISSING`) o queda como motivo `CHECKSUM_MISMATCH` del documento. Mensajes es/en/pt. oasdiff sin cambios rompedores; Spectral y Redocly sin errores (descripciones con comas entre comillas en flow mappings).

### Eventos (`contracts/events/documents/*.v1.schema.json`)

| Evento | Cuándo | Payload | Consumidores | Idempotencia |
|---|---|---|---|---|
| `documents.AttachmentUploaded.v1` | `→ AVAILABLE` (verificación o restauración de contenido) | `documentId, purpose, contentType, format, sizeBytes, sha256, scanStatus` (sin nombre) | ninguno obligatorio | `documentId` + `availableAt` |
| `documents.DocumentRejected.v1` | `→ REJECTED` | `documentId, purpose, reason` | ninguno obligatorio | `documentId` |

### Export (`contracts/export/v1`)

`documents.schema.json` y `attachment-links.schema.json` (secciones del ZIP principal); `document-contents/MANIFEST.md` con el formato del archivo de contenidos (`documents-manifest.json`: `format: "pfos-document-contents"`, `formatVersion: 1`, `workspaceId`, `exportId`, `items[{ documentId, sha256, sizeBytes }]`); `ENCRYPTION.md` sin cambios (mismo `PFXE` v1).

## Suite de uploads maliciosos (exit criterion de Phase 6)

Fixtures **generados por código** en `apps/api/test/support/malicious-files.ts` (ninguno versionado como binario peligroso; EICAR por fragmentos): cada caso declara archivo, declaración y etapa esperada de rechazo. TC-SECURITY-UPLOAD-022 los corre contra API + SeaweedFS reales; cada uno tiene además su TC propio.

| # | Caso | Etapa | Resultado esperado | TC |
|---|---|---|---|---|
| 1 | `logo.svg` `image/svg+xml` | solicitud | 422 `UPLOAD_TYPE_NOT_ALLOWED` | 001 |
| 2 | `setup.exe` `application/x-msdownload` | solicitud | 422 `UPLOAD_TYPE_NOT_ALLOWED` | 001 |
| 3 | `extracto.pdf` declarado `text/html` | solicitud | 422 `UPLOAD_TYPE_NOT_ALLOWED` | 002 |
| 4 | Comprobante de 15728641 bytes | solicitud | 413 `UPLOAD_TOO_LARGE` | 003 |
| 5 | Contenido sustituido (mismo largo, otra suma) | almacenamiento | PUT rechazado; `complete` ⇒ 409 `DOCUMENT_UPLOAD_MISSING` | 004 |
| 6 | PUT con la URL vencida | almacenamiento | PUT rechazado (403) | 005 |
| 7 | PNG como `factura.pdf` | verificación | `REJECTED/TYPE_MISMATCH` | 006 |
| 8 | Ejecutable PE como `extracto.csv` | verificación | `REJECTED/MALFORMED_CONTENT` (bytes nulos) | 006 |
| 9 | Políglota: HTML con `<script>` y `%PDF-` en el byte 200 | verificación | `REJECTED/TYPE_MISMATCH` | 007 |
| 10 | SVG con `<script>` declarado `recibo.png` | verificación | `REJECTED/TYPE_MISMATCH` | 007 |
| 11 | PDF con `/OpenAction` → `/JS` | verificación | `REJECTED/ACTIVE_CONTENT` | 008 |
| 12 | PDF con `/J#61vaScript` en flujo de objetos comprimido | verificación | `REJECTED/ACTIVE_CONTENT` | 008 |
| 13 | PDF con contraseña de usuario | verificación | `REJECTED/ENCRYPTED_CONTENT` | 009 |
| 14 | `movimientos.csv` que empieza con `<html><script>` | verificación | `REJECTED/ACTIVE_CONTENT` | 010 |
| 15 | JSON con 65 niveles | verificación | `REJECTED/MALFORMED_CONTENT` | 010 |
| 16 | XLSX con `xl/vbaProject.bin` | verificación | `REJECTED/MACROS_PRESENT` | 011 |
| 17 | XLSX de 40 KiB que se infla a 2 GiB | verificación | `REJECTED/ARCHIVE_LIMITS_EXCEEDED` | 012 |
| 18 | EICAR en `movimientos.csv` (solo con escáner) | verificación | `REJECTED/MALWARE_DETECTED` | 019 |

Al final de la corrida: 0 documentos `AVAILABLE`, cuarentena vacía y ningún objeto en el bucket de documentos.

## Riesgos / Trade-offs

- **RISK-010 (archivos sensibles):** cifrado de sobre, cuarentena sin versioning, claves y logs sin PII, descarga solo por la API y auditada. Residual: los backups de la base retienen envoltorios hasta 12 meses (decisión 6).
- **Pérdida del llavero de documentos:** pérdida total e irreversible del contenido. Mitigación: respaldo fuera del host como requisito de despliegue (runbook), test de arranque que exige todas las claves en uso y rotación sin re-cifrado.
- **Parsers de formatos no confiables en el proceso de la API:** un CVE en el parser PDF o ZIP expondría la API. Mitigación: `worker_thread` con límites de memoria y tiempo, solo lectura de estructura (sin render ni ejecución), dependencias auditadas por Renovate/Trivy, falla cerrada.
- **Carga de la API durante la verificación:** acotada por el semáforo (2) y la cuota `costly`; plan B: mover a un consumidor (decisión 3).
- **Endpoint S3 público:** superficie nueva; mitigada con Caddy limitado a `PUT`/`OPTIONS` firmados sobre el bucket de cuarentena, sin listados ni lecturas.
- **Compatibilidad S3 de SeaweedFS** (checksum firmado, `DeleteObject` con versión): cubierta por SPIKE-07 (23/23) y por la suite de contrato del adapter con Testcontainers; si cambia de backend (RustFS, S3), se repite.
- **Sin antimalware en producción** (si la pregunta 2 se responde con (a) o (b)): mitigado por la allowlist estricta, la inspección estructural y la entrega solo como adjunto; el owner es el único que sube y descarga.
- **Deriva de la cuota:** contadores desnormalizados; recalculados a diario con métrica de deriva.
- **Portabilidad en dos pasos:** el owner puede olvidar restaurar los contenidos; la UI muestra los documentos `CONTENT_PENDING` y el aviso del export lo recuerda.

## Plan de migración

Solo expand, no destructiva: `CREATE SCHEMA documents`; tres tablas con RLS forzada (`USING`/`WITH CHECK` con `platform.current_workspace_id()` en la forma vigente, fail-closed `PF002`), grants, política `retention_scan` para `pf_maintenance` y registro en `platform.workspace_scoped_table`; columnas nullable en `iam.workspace_export` (`contents_*`). Timestamp posterior a la última migración de `main`. El movimiento del cifrado a `@pf/platform/crypto` es un refactor de código sin datos. Rollback de aplicación: la versión N-1 ignora el schema `documents` y las columnas nuevas. Buckets: `migrate` (local/CI) y `pfos-bootstrap-storage.sh` (producción) crean la cuarentena de forma idempotente.

## Preguntas abiertas

Numeradas para consolidarlas en el doc de preguntas de Phase 6. **[B]** = bloquea el grupo indicado.

1. **[B: grupos 3–6] Descarga solo por la API (cambia FR-DOCUMENTS-004, NFR-SEC-012 y ADR-0009).** a) **Cifrado de sobre de la aplicación y descarga en streaming por la API, sin presigned GET** (como el export, decisión 5 de `add-workspace-export`). b) Presigned GET de 60 s y cifrado solo del lado del almacenamiento (SeaweedFS no tiene SSE-KMS validado; las réplicas en B2 quedarían en claro salvo cifrado de B2). c) Ambos: cifrado de aplicación y un proxy de descarga presignado (complejidad sin beneficio). **Recomendación: a** y un ADR que matice ADR-0009.
2. **[B: exit criterion y tarea 7.3] Antimalware en Phase 6** (docs/12 §17 pregunta 4; FR-DOCUMENTS-008 es Could de Phase 9). a) Sin escáner; EICAR sale de la suite hasta Phase 9. b) **Puerto + adapter ClamAV, deshabilitado en producción (host de 2 GB, D51) y habilitado solo en la suite maliciosa del nightly**; el exit criterion se verifica con y sin escáner. c) ClamAV en producción (exige subir el host a 4 GB, ≈ USD +10/mes, fuera del rango de D51). **Recomendación: b.**
3. **[B: grupo 8] Documentos en el export del workspace.** a) Solo metadatos y vínculos. b) Binarios en el mismo ZIP con export e import en streaming y un límite mayor que 200 MB (cambia D100). c) **Metadatos y vínculos en el ZIP principal y contenidos en un archivo aparte opcional, restaurable en un segundo paso idempotente** (D100 intacta). **Recomendación: c.**
4. **Endpoint público para la subida en producción** (no bloquea implementar; bloquea desplegar). a) **Hostname propio `PF_DOMAIN_FILES` en Caddy limitado a PUT firmados al bucket de cuarentena.** b) Ruta en el dominio de la app (envía la cookie de sesión al almacenamiento, mezcla orígenes). c) Subida por la API (contradice FR-DOCUMENTS-001). **Recomendación: a** (un registro DNS más, certificado automático).
5. **Límites por defecto.** FR-DOCUMENTS-002 dice 15 MB; docs/12 §8 dice 25 MiB; docs/13 §11 dice 20 MB para imports. a) **15 MiB documentos, 20 MiB extractos a importar, tope duro 25 MiB, cuota 5 GiB por workspace, 20 subidas pendientes, 20 adjuntos por elemento.** b) 25 MiB para todo. **Recomendación: a.**
6. **Purga de documentos sin vínculo (FR-DOCUMENTS-007).** a) **Se purgan los disponibles, sin vínculo y no archivados tras 30 días; la UI avisa y archivar los conserva.** b) Solo se purgan los `IMPORT_SOURCE` sin vínculo; los demás nunca. c) Sin purga automática. **Recomendación: a** (archivar es la forma explícita de conservar; un comprobante suelto suele ser una subida abandonada).
7. **PDF con contraseña.** a) **Rechazar los que exigen contraseña para abrirse; aceptar los que solo tienen contraseña de propietario.** b) Aceptarlos como adjunto (sin inspección posible) y rechazarlos solo como extracto a importar. c) Rechazar todo PDF cifrado. **Recomendación: a.**
8. **Metadatos EXIF de imágenes (docs/12 §8.4, "propuesto").** a) **Conservar el original** (la suma y la deduplicación siguen valiendo; el owner es el único usuario). b) Quitar la geolocalización re-codificando (altera la evidencia). **Recomendación: a**, a revisar antes de abrir a usuarios compartidos.
9. **Tipos de destino.** FR-DOCUMENTS-003 nombra 7; docs/08 §5.11 suma `CREDIT_CARD_STATEMENT`, `GOAL` y `RECONCILIATION`. a) **Los 7 de FR ahora; el CHECK se amplía cuando haya un uso.** b) Los 10. **Recomendación: a.**
10. **(Para `add-import-pipeline`) Ruta multipart del CSV básico.** a) **Se conserva sin cambios y se marca `deprecated` cuando la UI use `documentId`.** b) La multipart guarda el CSV como documento del lado del servidor (otra vía de ingreso de binarios por la API). c) Quitarla (rompe el contrato; no permitido). **Recomendación: a.**
11. **XLS (Excel 97-2003).** No está en la allowlist de FR-DOCUMENTS-002 (OLE2, macros). a) **Fuera; se reevalúa si un banco del owner solo exporta XLS (change 41, tarea pendiente del owner).** b) Admitirlo con inspección OLE2. **Recomendación: a.**

## Dependencias

- **Requiere aplicados:** `add-workspace-export` (formato `PFXE`, llavero, `PortabilityRegistry`), `fix-rls-fail-closed-gaps` (patrón `pf_maintenance` + `retention_scan`, D308–D310), `add-basic-csv-import` (contexto IMPORTS para `ImportJobExistenceQuery`), `add-lifecycle-timeline`, `add-global-audit-view`, `fix-phase-2-gaps` (idempotencia y cuota `costly`).
- **Habilita:** `add-import-pipeline` (decisión 14: subida, lectura en streaming, vínculo `IMPORT_JOB`, retención) — este change va **antes** de la etapa Upload del pipeline; el pipeline puede avanzar en paralelo con parsers sobre fixtures. Sin relación con `add-rule-engine`, `add-banking-providers` (los providers de API no suben archivos) ni `optimize-consumer-throughput` (no agrega consumidores).
- **Coordinación:** si `add-import-pipeline` agrega consumidores de `documents.*`, el presupuesto de conexiones es suyo; la recomendación de la decisión 14 evita ese consumidor.

## Cambios a docs compartidos

No se editan en este change (reglas de la sesión de diseño); quedan para la consolidación:

- **ADR nuevo (número a asignar):** "Documentos cifrados por la aplicación y descarga por la API" — matiza ADR-0009 (descarga por presigned GET ⇒ por la API; SSE ⇒ cifrado de sobre de la aplicación; verificación síncrona en la confirmación con plan B en el worker). Borrador: contexto (sin KMS ni SSE en N1, réplica a B2), decisión (decisiones 3, 6 y 7), consecuencias (sin URLs de descarga reutilizables; la API transporta los bytes; crypto-shredding; dependencia del llavero).
- **docs/01:** FR-DOCUMENTS-002 (15 MiB/20 MiB/25 MiB y `qfx`), FR-DOCUMENTS-004 (descarga por la API en streaming tras autorizar), FR-DOCUMENTS-008 (puerto y adapter adelantados como Could, según la pregunta 2).
- **docs/02:** NFR-SEC-012 (presigned solo para PUT; la descarga de documentos y exports va por la API).
- **docs/05 §2.11:** API pública (`CompleteUpload`, `DownloadDocument`/`OpenContent` en lugar de `GetDownloadUrl`), eventos (`AttachmentUploaded`, `DocumentRejected`; sin `DocumentQuarantined` ni `AttachmentLinked`), dependencias (`EnvelopeCipher`, registro de destinos). §2.12: IMPORTS no consume `documents.AttachmentUploaded` (decisión 14).
- **docs/08 §5.11:** columnas nuevas de `document`, estados `CONTENT_PENDING` y `UPLOADED`, `purpose` sin `EXPORT`, `target_type` con los 7 de FR, tabla `storage_usage`, única de vínculo con `workspace_id`; §13.2 secciones de documentos del export y columnas `contents_*`.
- **docs/10:** rutas `W/documents*` (tabla de Contratos), códigos nuevos y retiro de `UPLOAD_CHECKSUM_MISMATCH` del catálogo de documents; `includeDocumentContents` en exports.
- **docs/11:** payload de `documents.AttachmentUploaded.v1` y nuevo `documents.DocumentRejected.v1`.
- **docs/12:** §3 (object storage: cifrado de aplicación, descarga por API), §8 (cuarentena en bucket propio sin versioning, verificación síncrona, controles por formato de la decisión 4, endpoint público limitado), §10 (cifrado en reposo de documentos), §16 (suite de 18 casos, TC-SECURITY-UPLOAD-022), §17 pregunta 4 (respuesta).
- **docs/13:** §1 y §4.1 (Upload vía DOCUMENTS con `documentId`), §4.2 (secuencia sin presigned emitido por IMPORTS), §13 (TTL 5 min).
- **docs/18:** métricas de la decisión 12. **docs/19/20:** bucket de cuarentena y perfil `clamav`. **docs/30:** respaldo del llavero de documentos, réplica a B2 solo del bucket cifrado, límite del crypto-shredding frente a backups. **ADR-0027 / docs/21:** `PF_DOMAIN_FILES` en Caddy y CSP. **docs/config-reference.md:** variables de la decisión 15 (`pnpm config:docs`). **docs/03 §7:** posición del change en Phase 6. **docs/28:** componente "Adjuntos" y página `/documentos`. **docs/38:** estado del change.
