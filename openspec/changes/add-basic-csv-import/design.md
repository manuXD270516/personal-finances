# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: docs/01 FR-IMPORTS-001..012 (FR-IMPORTS-003 Could, Phase 3; el resto Phase 6), FR-TRANSACTIONS-031/032; docs/02 NFR-DATA-016, NFR-PERF-007/008, NFR-SEC-011/012/015; docs/08 §IMPORTS (`import_job`, `staged_transaction`, `row_link`) y la fila `txn.transaction` (índice planificado sobre `external_ref`); docs/09 INV-014; docs/11 (`imports.ImportCompleted.v1`); docs/12 §7 (CSV injection al exportar); **docs/13 completo** (agregado, máquina de estados, pipeline, `RowFingerprint` §7.2, `row_link`, encoding y locale §12, seguridad §13, tablas §14, API §15, testing §16); docs/24 A6 (CSV básico sin DOCUMENTS) y §5.3/§5.6; docs/28 §4.7 (preview); docs/33 **D112** (throughput de consumidores, `improve-event-throughput`) y **D113** (cuota `costly`, idempotencia multipart, `fix-phase-2-gaps`); D9 (categorías "sin categoría"), D65/D69 (periodos cerrados), D100 (patrón multipart con límite y `UPLOAD_TOO_LARGE`).

Crea el contexto **IMPORTS** (`@pf/imports`, schema `imports`) con un **subconjunto** del diseño de docs/13 elegido para que Phase 6 lo **extienda** (más estados, más formatos, documentos, perfiles, reglas) sin migraciones destructivas ni cambios rompedores de API.

| Capa | Cambios |
|---|---|
| domain | AR `ImportJob` (estados, contadores, mapeo, transiciones, versión); VO `CsvMapping` (forma `imports.mapping.v1`, subconjunto del `MappingProfile` de docs/13 §5.1), `DecimalFormat`, `DateFormat`, `SignConvention`; servicios puros `CsvSniffer` (encoding, delimitador), `RowNormalizer` (fecha, monto `Decimal`, descripción), `RowValidator`, `RowFingerprint` (docs/13 §7.2 con `occurrenceIndex`), `DuplicateClassifier` (exacto por vínculo, probable por candidato, asignación 1:1 determinista), `ImportBatchPlanner` (lotes de 200). Sin Nest/Kysely. |
| application | `CreateCsvImport`, `SetImportMapping`, `GetImport`, `ListImports`, `GetImportPreview`, `DecideImportRow`, `ApproveImport`, `PersistImport` (worker), `RetryImport`, `AcceptImportErrors`, `CancelImport`, `ExpireImports` y `PurgeImportStaging` (jobs). Puertos: `ImportJobRepository`, `StagingRepository`, `RowLinkRepository`, `AccountsPort` (`@pf/accounts/contracts`), `PeriodStatusPort` (`@pf/planning/contracts` `PeriodQuery`), `BalancePort` (`@pf/ledger/contracts`), `ImportedTransactionsPort`, `DuplicateCandidatesPort`, `TransactionStatusPort` (`@pf/transactions/contracts`), `AuditPort`, `Clock`, `UnitOfWork`. |
| infrastructure | Repos Kysely (`imports.*`, inserción multi-fila por chunks de 1 000), parser CSV en streaming sobre el buffer (RFC 4180), decodificador UTF-8/windows-1252, migraciones, secciones del export del workspace. |
| interface | `ImportsController` (multipart con límite, `Idempotency-Key` con payload `{fileSha256, accountId}`, `If-Match`, `x-rate-limit: costly`), consumidor `imports.persist`, jobs `imports.expire-reviews` y `imports.purge-staging`; web: asistente "Importar CSV". |

## Objetivos / No objetivos

**Objetivos:** cargar histórico real de una cuenta desde un CSV con control total del usuario, sin duplicados y sin degradar la entrega de eventos; base compatible con el pipeline de Phase 6.

**No objetivos:** ver "Fuera de alcance" en proposal.md (DOCUMENTS, perfiles, reglas, otros formatos, fusionar, transferencias desde el import, reconciliación, deshacer, pipeline reanudable por etapas en el worker).

## Decisiones

1. **Subconjunto de la máquina de docs/13, con un estado nuevo `AWAITING_MAPPING`.** Estados de Phase 3: `AWAITING_MAPPING → AWAITING_REVIEW` (mapeo aplicado; se puede re-mapear) `→ APPROVED → PERSISTING → COMPLETED | PARTIALLY_FAILED`; `PARTIALLY_FAILED → PERSISTING` (reintento) `| COMPLETED_WITH_ERRORS` (aceptar); `AWAITING_MAPPING | AWAITING_REVIEW → CANCELLED` (usuario o expiración). Phase 6 agrega `CREATED/UPLOADED/PARSING/NORMALIZING/VALIDATING/MATCHING/CLASSIFYING/RECONCILING/...` y usa `AWAITING_MAPPING` cuando ningún perfil coincide (asistente de mapeo de docs/13 §5.1). Las fallas de subida son síncronas y **no crean job** (no hace falta `PARSE_FAILED` en Phase 3). La columna `status` es `text` con CHECK ampliable (expand).
2. **Sin Object Storage ni DOCUMENTS (docs/24 A6).** El archivo llega por `multipart/form-data` (≤ `IMPORT_CSV_MAX_BYTES`, 2 MiB por defecto; el límite se aplica al leer el stream, antes de bufferizar más), se calcula SHA-256, se decodifica y se parsea en memoria en la misma petición; sus celdas se guardan como `staged_transaction.raw` (jsonb, arreglo de strings) y el binario **no se guarda**. Phase 6 agrega `document_id`/`object_key` (columnas nullable) y la subida presignada como alternativa (`application/json` en el mismo `POST W/imports`).
3. **Sniffing.** Codificación: BOM UTF-8 ⇒ UTF-8; si no, validación UTF-8 estricta; si falla, windows-1252; NUL o > 1 % de caracteres de control fuera de `\t\r\n` ⇒ `IMPORT_UNSUPPORTED_FORMAT` (binario). Delimitador: el de `, ; \t |` con recuento más consistente en las primeras 20 líneas (fuera de comillas); se puede sobrescribir en el mapeo. Más de `IMPORT_CSV_MAX_COLUMNS` (50) ⇒ `IMPORT_UNSUPPORTED_FORMAT`; más de `IMPORT_CSV_MAX_ROWS` (5 000) filas de datos ⇒ `IMPORT_TOO_MANY_ROWS`. Se normaliza a NFC.
4. **Mapeo manual (`CsvMapping`, JSON Schema `imports.mapping.v1`).** `{ hasHeader, skipRows (0..50), delimiter, columns: { date: {index}, description: {index}, amount: { mode: SIGNED, index, signConvention: NEGATIVE_IS_OUTFLOW | POSITIVE_IS_OUTFLOW } | { mode: DEBIT_CREDIT, debitIndex, creditIndex } }, dateFormat, decimalSeparator: "," | "." }`. El separador de miles es el otro carácter (o espacio) y es opcional. Es la misma forma que `MappingProfile.columns`/`numberFormat` de docs/13 §5.1, de modo que Phase 6 pueda "guardar como perfil". La UI precarga el mapeo del último import de la cuenta (`GET W/imports?accountId=&limit=1`). Re-enviar el mapeo en `AWAITING_REVIEW` recalcula la vista previa y borra las decisiones de filas cuya huella cambió.
5. **Normalización exacta.** Montos: se quitan espacios y el separador de miles solo si aparece en posiciones de miles válidas; signo `-` inicial o final y paréntesis `(1.234,56)` en modo `SIGNED`; el resultado es un string decimal parseado a `Decimal` (nunca `number`, INV-001); escala > `currency.scale` de la moneda de la cuenta ⇒ `IMPORT_INVALID_AMOUNT` (nunca redondear, INV-003); en `DEBIT_CREDIT`, exactamente una de las dos columnas con valor ≠ 0. Fechas: parseo estricto del formato elegido (`dd/MM/yy` con pivote 2000–2099), fecha inexistente ⇒ `IMPORT_INVALID_DATE`; fechas literales (sin hora) como fecha de negocio. Descripción: NFKC→NFC, sin caracteres de control (C0/C1 salvo espacio), espacios colapsados, recorte; > 500 ⇒ truncado + `IMPORT_DESCRIPTION_TRUNCATED` (advertencia, no bloquea); una descripción vacía es válida y se guarda como nula (`description` es nullable en `txn.transaction`), sin texto inventado.
6. **Validación.** Monto 0 ⇒ `IMPORT_INVALID_AMOUNT`; fecha > hoy + 3 días (zona del workspace) ⇒ `IMPORT_FUTURE_DATE`; fecha en periodo `closed` (consulta por fechas distintas al `PeriodQuery`) ⇒ `PERIOD_CLOSED` (D65/D69). Cuenta: activa y no archivada (al crear y al aprobar). Las filas inválidas quedan con `decision = EXCLUDE` fija.
7. **Huella e idempotencia (INV-014, docs/13 §7).** `fingerprint = SHA-256(canonical_json([workspaceId, accountId, bookingDate, signedAmount (escala de la moneda), currency, descriptionKey, "", occurrenceIndex]))`, con `descriptionKey` = NFKC, minúsculas, sin acentos, espacios colapsados, sin dígitos de tarjeta enmascarada (docs/13 §7.2; el `externalId` vacío en Phase 3 deja la tupla lista para OFX). `occurrenceIndex` = ordinal entre filas del **mismo archivo** con igual (fecha, monto, descripción). Tres niveles: (a) archivo: SHA-256 en `import_job.file_checksum` con índice no único ⇒ advertencia `IMPORT_FILE_ALREADY_IMPORTED` (Should); (b) fila: `imports.row_link UNIQUE (workspace_id, account_id, fingerprint) WHERE status = 'ACTIVE'`; (c) BD de Transactions: `external_ref = ('imports.csv-row', hex(fingerprint))` con **índice único parcial** `(workspace_id, account_id, external_ref_namespace, external_ref_id) WHERE external_ref_namespace = 'imports.csv-row' AND status <> 'VOIDED'` (red de seguridad ante reintentos y dos jobs aprobados en paralelo). Un vínculo cuya transacción está `VOIDED` cuenta como `SUPERSEDED`: se verifica contra Transactions (`TransactionStatusQuery.statusOf`) al clasificar —fuente de verdad, sin consumidor de `TransactionVoided`— y se marca `SUPERSEDED` en esa misma unidad de trabajo.
8. **Deduplicación básica (FR-IMPORTS-007 subconjunto, docs/13 §8).** Para las filas sin vínculo exacto, `DuplicateCandidatesQuery.findForImport` (Transactions, set-based con `unnest`) devuelve movimientos no anulados de la cuenta —transacciones `INCOME/EXPENSE/REFUND/ADJUSTMENT` y **patas** de `TRANSFER`/`CONVERSION` sobre la cuenta— con el mismo monto y moneda, la misma dirección y fecha a ±`DUPLICATE_WINDOW_DAYS` (3, la ventana de `transactions/duplicate-detection`), excluyendo los ya vinculados a otra fila activa. No se exige similitud de descripción (las glosas bancarias difieren de las manuales); la similitud solo **ordena** candidatos. Asignación 1:1 greedy por |Δfecha| ascendente y luego id. Decisión obligatoria `CREATE | SKIP`; `SKIP` crea un `row_link` ACTIVE hacia la transacción existente (el sistema "aprende", docs/13 §7.4). Score ponderado, `DUPLICATE_PROBABLE_HIGH` y **fusionar** (`LinkImportedRecord`) quedan para Phase 6.
9. **Transacciones creadas.** Salida ⇒ `EXPENSE` con la categoría de sistema `UNCATEGORIZED`; entrada ⇒ `INCOME` con `UNCATEGORIZED_INCOME` (D9); estado **`POSTED`** (pregunta abierta 2), `source = 'IMPORT'`, `import_job_id`, `external_ref` de la decisión 7, sin contraparte ni medio de pago. Cada una con su asiento (traductor al ledger existente), auditoría con `origin = 'import'` y actor = quien aprobó, recorrido de creación (`audit/lifecycle-timeline`) y eventos de Transactions. La categorización posterior usa la edición masiva existente (`transactions/bulk-edit`).
10. **Persistencia asíncrona por lotes.** `ApproveImport` (OWNER/EDITOR, `Idempotency-Key`, `If-Match`) valida que no queden `DUPLICATE_PROBABLE` sin decisión (`IMPORT_REVIEW_INCOMPLETE` con `pendingDecisions`), asigna `batch_no` a las filas a crear (lotes de `IMPORT_PERSIST_BATCH_SIZE` = 200, orden por fecha y línea), pasa a `APPROVED`, audita y publica `imports.ImportApproved.v1` en la misma transacción (outbox). El consumidor `imports.persist` (concurrencia 1 por worker; timeout de handler 5 min) pasa a `PERSISTING` y procesa lote por lote: **una transacción de BD por lote** con `ImportedTransactionsCommand.recordBatch` (Transactions, en la UoW del llamador) + `staged_transaction.transaction_id` + `row_link` + progreso del job. Un lote con `transaction_id` ya asignado se salta (reanudación tras caída, redelivery del evento). Un error de dominio del lote (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`) hace rollback **solo de ese lote**, se registra en las filas y se continúa; al final `COMPLETED` o `PARTIALLY_FAILED`, `ImportCompleted.v1` (también con errores) y auditoría. Errores transitorios ⇒ reintento del consumidor (backoff de `platform/event-delivery`).
11. **Throughput de eventos (D112).** Cada transacción importada genera los eventos de un registro manual (`transactions.TransactionCreated.v1`, `TransactionPosted.v1`, `ledger.JournalEntryPosted.v1`), cada una en su propio agregado: con los lotes de 10 y concurrencia 4 de `improve-event-throughput` un consumidor drena 5 000 eventos en ≤ 120 s con handler trivial. Riesgo: handlers **no** triviales por evento. El más caro es `planning.budget-thresholds`, que hoy evalúa el workspace completo por evento (`evaluateWorkspace`); este change lo hace **coalescer por workspace dentro de cada lote** (una evaluación por workspace por lote, idempotente por la tabla de cruces), sin cambio de spec (TC-PLANNING-THRESHOLD-* en verde). `reporting.data-version` es trivial (incrementa una fila). Los consumidores de Phase 3 que se suscriban a `TransactionCreated` (p. ej. matching de `add-commitment-matching`) DEBEN medirse con el mismo benchmark (TC-IMPORTS-CSV-029). Imports **no** publica eventos por fila.
12. **Vista previa.** `GET W/imports/{id}/preview?classification=&cursor=` paginada por cursor (50 filas), con totales calculados por SQL sobre el staging: conteos por clasificación y decisión, Σ salidas y Σ entradas de las filas a crear, saldo contable actual (`BalancePort`) y resultante = actual + entradas − salidas (en la moneda de la cuenta). Para una cuenta `LIABILITY` el saldo se presenta con el signo de la UI (deuda positiva), como en reconciliación.
13. **Seguridad.** Textos importados = datos no confiables (docs/13 §13): se guardan sin interpretar; la UI escapa siempre (React); todo CSV que exporte el sistema ya neutraliza `= + - @ \t \r` con el `CsvWriter` del shared-kernel (export del workspace, auditoría, recorrido): este change agrega un test con una descripción importada (TC-IMPORTS-CSV-026). Logs: solo `importJobId`, conteos, códigos y números de línea (NFR-SEC-015); el nombre de archivo original se sanea (sin rutas, ≤ 255) y no se loguea. Límite de tamaño antes de bufferizar; parser sin `eval` ni fórmulas. RLS forzada en `imports.*`.
14. **Cuota `costly` (D113).** `x-rate-limit: costly` en `createImport`, `setImportMapping`, `approveImport` y `retryImport`; la idempotencia multipart usa como payload `{ fileSha256, accountId }` (mecanismo de `fix-phase-2-gaps`); un replay no consume cuota.
15. **Retención y expiración.** `IMPORT_REVIEW_TTL` (P30D): job diario `imports.expire-reviews` cancela `AWAITING_*` vencidos (actor `SYSTEM`, auditado) y borra su staging. `IMPORT_STAGING_RETENTION` (P90D): job `imports.purge-staging` borra las filas de `staged_transaction` de jobs terminados (`COMPLETED*`) o cancelados hace más de 90 días; se conservan `import_job` (conteos, mapeo, checksum) y `row_link` (idempotencia). No es borrado de datos financieros: el staging es dato técnico derivado (docs/13 §11).
16. **Rendimiento.** Subida + parseo + inserción del staging de 5 000 filas: p95 ≤ 3 s. Mapeo (normalizar, validar, huellas, vínculos y candidatos set-based) **síncrono** con límite de 5 000 filas: p95 ≤ 10 s (NFR-PERF-007: ≤ 30 s hasta la vista previa). Persistencia de 5 000 filas: ≤ 20 s (25 lotes). Si el mapeo síncrono supera el presupuesto con datos reales, se mueve al worker con un estado `NORMALIZING` (compatible con docs/13) — pregunta abierta 6.
17. **Concurrencia.** `ImportJob.version` con `If-Match` en mapeo, decisiones y aprobación (412/`CONCURRENCY_CONFLICT`). Dos jobs aprobados en paralelo para la misma cuenta y filas: el índice único de `row_link` y el de `external_ref` hacen que el segundo lote vea las filas como existentes (`recordBatch` devuelve `alreadyExisting`) y las cuente como ya importadas, sin duplicar.

## Contratos

### OpenAPI (aditivo, tag Imports, `x-openspec-capability: imports/import-pipeline`)

| Operación | Ruta | Rol / requisitos | Respuesta |
|---|---|---|---|
| `createImport` | `POST W/imports` (`multipart/form-data`: `file`, `accountId`) | OWNER/EDITOR, `Idempotency-Key`, costly | 201 `ImportJob` (`AWAITING_MAPPING`, `detected {encoding, delimiter}`, `header[]`, `sampleRows[≤20]`, `rowCount`, `warnings[]`, `suggestedMapping?`) · 413 `UPLOAD_TOO_LARGE` · 422 `IMPORT_UNSUPPORTED_FORMAT`/`IMPORT_TOO_MANY_ROWS` · 409 `ACCOUNT_CLOSED`/`ACCOUNT_ARCHIVED` |
| `listImports` | `GET W/imports?accountId=&status=&cursor=` | VIEWER | página de `ImportJobSummary` |
| `getImport` | `GET W/imports/{id}` | VIEWER | `ImportJob` con `status`, `counters`, `progress`, `errors[]`, `ETag` (304 con `If-None-Match`) |
| `setImportMapping` | `PUT W/imports/{id}/mapping` | OWNER/EDITOR, `If-Match`, costly | 200 `ImportJob` (`AWAITING_REVIEW`) + `previewSummary` · 422 `IMPORT_MAPPING_INVALID` · 409 `INVALID_STATUS_TRANSITION` |
| `getImportPreview` | `GET W/imports/{id}/preview?classification=&cursor=` | VIEWER | `{ summary: {counts, outflows: Money, inflows: Money, currentBalance: Money, resultingBalance: Money}, rows: [{ id, lineNumber, date, description, amount: Money, direction, classification, decision, issues[], candidate? }], nextCursor }` |
| `decideImportRow` | `PATCH W/imports/{id}/rows/{rowId}` `{ decision: CREATE \| SKIP \| EXCLUDE }` | OWNER/EDITOR, `If-Match` (versión del job) | 200 fila · 409 `INVALID_STATUS_TRANSITION` (fila inválida o ya importada: decisión fija) |
| `approveImport` | `POST W/imports/{id}/approve` | OWNER/EDITOR, `Idempotency-Key`, `If-Match`, costly | 202 `ImportJob` (`APPROVED`) · 409 `IMPORT_REVIEW_INCOMPLETE` (`pendingDecisions`) / `INVALID_STATUS_TRANSITION` |
| `cancelImport` | `POST W/imports/{id}/cancel` | OWNER/EDITOR, `Idempotency-Key` | 200 · 409 `INVALID_STATUS_TRANSITION` |
| `retryImport` | `POST W/imports/{id}/retry` | OWNER/EDITOR, `Idempotency-Key`, costly | 202 · 409 `INVALID_STATUS_TRANSITION` |
| `acceptImportErrors` | `POST W/imports/{id}/accept-errors` | OWNER/EDITOR, `Idempotency-Key` | 200 (`COMPLETED_WITH_ERRORS`) |

Códigos nuevos en `ErrorCode` (`x-extensible-enum`): `IMPORT_UNSUPPORTED_FORMAT` (422), `IMPORT_TOO_MANY_ROWS` (422), `IMPORT_MAPPING_INVALID` (422), `IMPORT_REVIEW_INCOMPLETE` (409). Enum abierto nuevo `ImportRowIssueCode` (no HTTP): `IMPORT_INVALID_DATE`, `IMPORT_INVALID_AMOUNT`, `IMPORT_FUTURE_DATE`, `PERIOD_CLOSED`, `ACCOUNT_CLOSED`, `IMPORT_DESCRIPTION_TRUNCATED` (advertencia); advertencia de job `IMPORT_FILE_ALREADY_IMPORTED`. docs/13 §15 menciona `IMPORT_FILE_TOO_LARGE` e `IMPORT_INVALID_STATE_TRANSITION`: se reutilizan `UPLOAD_TOO_LARGE` e `INVALID_STATUS_TRANSITION` del catálogo vigente (un solo código por concepto).

Configuración nueva (docs/config-reference): `IMPORT_CSV_MAX_BYTES` (2097152), `IMPORT_CSV_MAX_ROWS` (5000), `IMPORT_CSV_MAX_COLUMNS` (50), `IMPORT_PERSIST_BATCH_SIZE` (200), `IMPORT_REVIEW_TTL` (P30D), `IMPORT_STAGING_RETENTION` (P90D), `IMPORT_FUTURE_DATE_TOLERANCE_DAYS` (3).

### Contratos públicos nuevos de Transactions (aditivos, `@pf/transactions/contracts`)

| Contrato | Firma | Notas |
|---|---|---|
| `ImportedTransactionsCommand.recordBatch` | `({ workspaceId, accountId, importJobId, actorUserId, rows: [{ rowRef, date, direction: IN \| OUT, amount: Money, description \| null, externalRef: {namespace, id} }] }) → { created: [{rowRef, transactionId}], alreadyExisting: [{rowRef, transactionId}] }` | En la UoW del llamador (una transacción de BD por lote); reutiliza el agregado, el traductor al ledger, auditoría (`origin = 'import'`), recorrido y outbox; valida cuenta activa, moneda, escala, periodo cerrado (lanza el error de dominio del lote); `alreadyExisting` por el índice único de `external_ref`. Mismo contrato que usará `RecordImportedTransactions` en Phase 6 (docs/13 §1). |
| `DuplicateCandidatesQuery.findForImport` | `({ workspaceId, accountId, rows: [{rowRef, date, direction, amount}], windowDays, excludeTransactionIds }) → [{ rowRef, candidates: [{ transactionId, kind, date, amount, description, counterpartyName }] }]` | Set-based; incluye patas de transferencias y conversiones de la cuenta. |
| `TransactionStatusQuery.statusOf` | `({ workspaceId, transactionIds }) → [{ transactionId, status }]` | Para vínculos superados (decisión 7). |

### Eventos (nuevos, `contracts/events/imports/`)

| Evento | Cuándo | Payload | Consumidores | Idempotencia |
|---|---|---|---|---|
| `imports.ImportApproved.v1` | `ApproveImport` y `RetryImport` | `importJobId, accountId, attempt` | `imports.persist` (worker) | inbox `(consumer, eventId)` + estado por fila (`transaction_id` asignado ⇒ saltar) |
| `imports.ImportCompleted.v1` | Fin con `COMPLETED`, `PARTIALLY_FAILED` o `COMPLETED_WITH_ERRORS` | docs/11: `importJobId, accountId, sourceType: FILE_CSV, stats {total, imported, duplicates, ignored, errors}, dateRange, status` | ninguno obligatorio en Phase 3 (NOTIFY/REPORTING en Phase 6) | `importJobId` + `status` |

## Modelo de datos (expand-only)

| Tabla | Definición (subconjunto de docs/08 §IMPORTS) | RLS / grants |
|---|---|---|
| `imports.import_job` | `id, workspace_id, target_account_id, source CHECK ('FILE_CSV'), status CHECK (...), original_name, file_checksum bytea, file_size_bytes, encoding, delimiter, row_count, column_count, header jsonb, mapping jsonb NULL, counters jsonb, progress jsonb, errors jsonb, warnings jsonb, approved_by/at, completed_at, cancelled_at/by, expires_at, created_by, created_at, updated_at, version`. Índices `(workspace_id, status)`, `(workspace_id, target_account_id, created_at DESC)`, `(workspace_id, target_account_id, file_checksum)` **no único**. Phase 6 agrega `document_id`, `object_key`, `mapping_profile_id/version`, `connection_id`, `statement` (nullable) | WS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE |
| `imports.staged_transaction` | `id, workspace_id, import_job_id, row_number (línea del archivo), raw jsonb, booking_date NULL, amount numeric(38,18) NULL, currency, direction, description, occurrence_index, fingerprint bytea NULL, classification CHECK (NEW, DUPLICATE_EXACT, DUPLICATE_PROBABLE, INVALID), decision CHECK (CREATE, SKIP, EXCLUDE) NULL, issues jsonb, matched_transaction_id NULL, transaction_id NULL, batch_no NULL, batch_error jsonb NULL`. `UNIQUE (import_job_id, row_number)`; índices `(import_job_id, classification)`, `(workspace_id, fingerprint)` | WS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE/DELETE (purga) |
| `imports.row_link` | `id, workspace_id, account_id, fingerprint bytea, transaction_id, staged_transaction_id NULL (ON DELETE SET NULL), kind CHECK ('CREATED','SKIPPED_AS_DUPLICATE'), status CHECK ('ACTIVE','SUPERSEDED'), created_at, superseded_at NULL`. `UNIQUE (workspace_id, account_id, fingerprint) WHERE status = 'ACTIVE'`; índice `(workspace_id, transaction_id)` | WS forzada; `pf_app`/`pf_worker` SELECT/INSERT/UPDATE (sin DELETE) |
| `txn.transaction` | Columna `import_job_id uuid NULL` (sin FK cross-schema); índice único parcial `transaction_import_ref_uk (workspace_id, account_id, external_ref_namespace, external_ref_id) WHERE external_ref_namespace = 'imports.csv-row' AND status <> 'VOIDED'` (`CONCURRENTLY`) | sin cambios de RLS |

Registro de las tres tablas en `platform.workspace_scoped_table` (purga demo, ADR-0026). **Export del workspace** (regla de cobertura de `add-workspace-export`): secciones `imports.import_job` y `imports.row_link` (IDs remapeados, incluida `transaction_id`) y la columna `import_job_id` en transacciones; `imports.staged_transaction` excluida como dato técnico purgable (declarada en el test de cobertura).

## Riesgos / Trade-offs

- **Ráfaga de eventos (D112)**: 5 000 transacciones ⇒ ~15 000 eventos repartidos entre consumidores; mitigado por los lotes/concurrencia de `improve-event-throughput`, la coalescencia de `planning.budget-thresholds` y el benchmark TC-IMPORTS-CSV-029; límite de 5 000 filas por archivo.
- **Transferencias propias y pagos de tarjeta importados como gasto/ingreso**: distorsionan ingresos y gastos si el usuario no los omite; mitigado con candidatos contra patas de transferencias y una advertencia en la vista previa; la conversión en transferencia llega con reglas (pregunta abierta 4).
- **Mapeo síncrono**: 5 000 filas en la petición; presupuesto 10 s y plan B en el worker (pregunta 6).
- **Subconjunto vs Phase 6**: riesgo de divergencia; mitigado al reutilizar nombres de docs/13 (estados, tablas, huella, eventos, contrato `RecordImportedTransactions`) y listar lo que Phase 6 agrega.
- **Archivos sensibles (RISK-010)**: el binario no se guarda; celdas purgadas a 90 días; sin datos en logs.

## Plan de migración

1. Expand: schema `imports`, tres tablas con RLS y grants, registro en `platform.workspace_scoped_table`; columna `txn.transaction.import_job_id`; índice único parcial `CONCURRENTLY` (sin filas que lo violen: no hay `imports.csv-row` previos).
2. Contrato OpenAPI MINOR (oasdiff), esquemas de eventos, códigos nuevos y mensajes es/en/pt.
3. Config nueva en `@pf/platform` y docs/config-reference (`pnpm config:docs`).
4. Export del workspace: secciones nuevas (versión menor compatible del formato v1: secciones opcionales).
5. Rollback: la versión anterior ignora las tablas y la columna; un job a medio persistir se reanuda al volver a desplegar (estado por fila).

## Dependencias entre changes

- **Requiere aplicados:** Phase 1/2 completos, en particular `add-transaction-recording`, `add-transfers`, `add-manual-conversions` (patas para candidatos), `add-financial-periods`/`add-month-closing` (periodos cerrados), `add-bulk-edit` (categorizar después), `add-workspace-export` (cobertura de tablas), `improve-event-throughput` (D112) y `fix-phase-2-gaps` (cuota `costly` e idempotencia multipart, D113).
- **Independiente de** `add-recurrence-engine`, `add-subscriptions` y `add-upcoming-payments`; **interactúa** con `add-commitment-matching` (las transacciones importadas son candidatas de matching automático: medir su consumidor en el benchmark) y con SM-07 (un pago importado que resuelve una ocurrencia generada después cuenta como sorpresa).
- **Orden recomendado:** último change de Phase 3 (si el owner lo incluye), para no retrasar los Must de la fase.
- **Phase 6** (`imports/import-pipeline` completo): extiende estados, tablas (columnas nullable), API (variante `application/json` con presigned upload), contratos (`RecordImportedTransactions` es este `recordBatch`), y agrega perfiles, reglas, fusionar, reconciliación y deshacer.

## Preguntas abiertas

1. **¿Phase 3 o Phase 6?** (**bloqueante** para planificar la fase; docs/24 pregunta abierta 4)
   - a) **Incluirlo en Phase 3 como último change, opcional (Could): se implementa solo si los Must de Phase 3 están terminados; si no, pasa intacto a Phase 6** (recomendada: carga el histórico real del owner a tiempo para el matching y para medir SM-07 con datos reales, expone temprano los formatos de los bancos del owner —RISK-016— y su diseño es un subconjunto del de Phase 6, así que no se pierde trabajo; `improve-event-throughput` y la cuota `costly` ya están listos).
   - b) Diferirlo a Phase 6 completo (menos alcance en Phase 3; el owner sigue con registro manual y saldos iniciales; matching y SM-07 se validan solo con datos manuales).
   **Recomendación: a.** Si el owner no tiene histórico relevante que cargar (empieza "desde cero" con saldos iniciales), **b**.
2. **Estado inicial de las transacciones importadas.** docs/13 propone `cleared` (vienen de un extracto).
   - a) **`POSTED` en Phase 3** (recomendada: sin saldo de extracto no hay reconciliación al terminar; el usuario concilia después con las sesiones existentes; evita un camino de creación directa en `CLEARED` y su recorrido).
   - b) `CLEARED` desde el import.
   **Recomendación: a**; Phase 6 pasa a `CLEARED` cuando el import traiga `StatementBalance`.
3. **Categoría en la vista previa.**
   - a) **Sin categoría en Phase 3; categorizar después con la edición masiva** (recomendada: la edición masiva ya existe y las reglas llegan en Phase 6).
   - b) Elegir categoría por fila en la vista previa (FR-IMPORTS-009 parcial: más UI y validaciones de clasificación).
   **Recomendación: a.**
4. **Transferencias propias y pagos de tarjeta en el extracto.**
   - a) **Detectarlos como posibles duplicados cuando ya existe la transferencia manual y, si no existe, advertir en la vista previa que se importarán como gasto/ingreso; el usuario los excluye y registra la transferencia a mano** (recomendada).
   - b) Permitir marcar una fila como "transferencia a la cuenta X" (adelanta parte de las reglas de Phase 6).
   **Recomendación: a.** No bloquea.
5. **Recorrido de ciclo de vida del `ImportJob`** (decisión del owner 2026-10-03 sobre trazabilidad tipo máquina de estados).
   - a) **Phase 3: solo auditoría de creación, aprobación, cancelación, expiración y aceptación; la máquina `ImportJob` en `audit/lifecycle-timeline` llega con el pipeline completo de Phase 6** (recomendada: el job de Phase 3 es corto y técnico; las transacciones creadas sí tienen recorrido).
   - b) Declarar ya la máquina `ImportJob` y registrar sus transiciones.
   **Recomendación: a.**
6. **Mapeo síncrono o en el worker.**
   - a) **Síncrono con límite de 5 000 filas y presupuesto p95 ≤ 10 s** (recomendada: menos estados y sin polling hasta la vista previa).
   - b) Asíncrono en el worker con estado `NORMALIZING` (docs/13), con polling.
   **Recomendación: a**, con plan B (b) si el benchmark con archivos reales excede el presupuesto.
7. **Límites por defecto.** docs/13 §11 fija 20 MB y 100 000 filas para Phase 6.
   - a) **2 MiB y 5 000 filas en Phase 3** (recomendada: suficientes para meses de un usuario y acotan memoria, eventos y el mapeo síncrono).
   - b) Los de docs/13 desde ya.
   **Recomendación: a.**

## Cambios a docs compartidos

No se editan en este hilo; para la consolidación:

- **docs/01:** FR-IMPORTS-003 enlaza a `add-basic-csv-import`; nota de que FR-IMPORTS-001/007/010 se cubren parcialmente en Phase 3.
- **docs/03 §7:** `add-basic-csv-import` como último change de Phase 3 (Could), si el owner lo incluye (pregunta 1).
- **docs/05 §IMPORTS:** contexto creado en Phase 3 con el subconjunto CSV; puertos y contratos de § Contratos.
- **docs/08 §IMPORTS:** as-built del subconjunto (columnas de `import_job`, `staged_transaction`, `row_link.kind`), columna `txn.transaction.import_job_id` e índice `transaction_import_ref_uk` (actualizar la fila "Planificado" de `transaction`).
- **docs/10:** rutas `W/imports*` con multipart en Phase 3 y la variante JSON/presigned en Phase 6; códigos nuevos; `UPLOAD_TOO_LARGE` e `INVALID_STATUS_TRANSITION` en lugar de `IMPORT_FILE_TOO_LARGE` e `IMPORT_INVALID_STATE_TRANSITION`.
- **docs/11:** `imports.ImportApproved.v1` (nuevo) e `imports.ImportCompleted.v1` (payload con `status`).
- **docs/13:** estado `AWAITING_MAPPING`; §4.1 etapa Upload sin Object Storage en Phase 3; §7.3 `external_ref_namespace = 'imports.csv-row'`; §8 candidatos con patas de transferencias/conversiones; §15 códigos reutilizados.
- **docs/24 §5.3:** decisión de la pregunta abierta 4 (aquí pregunta 1).
- **docs/28 §4.7:** asistente de 4 pasos sin categoría ni fusionar en Phase 3.
- **docs/config-reference:** variables `IMPORT_*`.
- **ARCHITECTURE §14:** `imports/import-pipeline` activa en Phase 3 (subconjunto).
- **contracts/openapi/finance-api.v1.yaml** y **contracts/events/imports/**: según § Contratos.
- **Export del workspace** (`identity/workspace-portability`): secciones nuevas (tarea de este change, no edición de la spec).
