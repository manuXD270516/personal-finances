# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: FR-IDENTITY-010, NFR-PORT-009, NFR-REL-014, NFR-COMP-002, NFR-SEC-006; docs/30 §10 (formato `pfos-export` v1, manifiesto con sha256, operación asíncrona, presigned URL, expiración 7 días, `REPEATABLE READ`, IDs preservados) y §11 (cifrado de exports: SSE-KMS; contraseña del usuario Phase 7+); docs/08 §13.2 (ZIP en `exports/{ws}/{opId}.zip`, OWNER, auditado) y §OPERATION; docs/12 §4 (re-autenticación reciente para exportar), §5 (`workspace:admin` solo OWNER), §7 (CSV injection), §13.2 (export auditado), §13.3 (exportación completa); docs/10 §8 (202 + operation) y §10 (10 exports/min); ARCHITECTURE §9 (hard delete prohibido en datos financieros).

Este change introduce la capability `identity/workspace-portability` en el contexto **IDENTITY** (dueño del workspace) como **orquestador**: no lee tablas de otros contextos; cada contexto exporta e importa su propia sección mediante puertos públicos, preservando la arquitectura hexagonal (ARCHITECTURE §6–§7, docs/06).

| Capa | Cambios |
|---|---|
| domain | IDENTITY: agregados `WorkspaceExport` (`REQUESTED → RUNNING → READY | FAILED`; `READY → EXPIRED | DISCARDED`) y `WorkspaceImport` (`RECEIVED → VALIDATING → IMPORTING → VERIFYING → SUCCEEDED | FAILED`); VO `ExportManifest`, `SectionDescriptor`, `IdRemap`. Shared-kernel: `CsvWriter` con neutralización (ya existe para el export del recorrido, D52). |
| application | `RequestWorkspaceExport`, `RunWorkspaceExport` (job), `DownloadWorkspaceExport`, `DiscardWorkspaceExport`, `ExpireWorkspaceExports` (job), `RequestWorkspaceImport`, `RunWorkspaceImport` (job). Puertos: `WorkspaceDataExporter`/`WorkspaceDataImporter` (uno por contexto, registrados en un `PortabilityRegistry`), `ExportKeyProvider`, `ExportObjectStore`, `ReauthPolicy` (lee `auth_time`), `AuditPort`, `NotificationPort` opcional. |
| infrastructure | Exporters/importers Kysely por contexto; cifrado de sobre (Node `crypto`, AES-256-GCM por bloques); adapter S3 al bucket de exports; migraciones. |
| interface | Controllers `W/exports` y `/workspace-imports` (multipart con límite); descarga `application/zip` en streaming; BFF: flujo de re-autenticación (`max_age=0`/`prompt=login`) al recibir `REAUTHENTICATION_REQUIRED`. UI en configuración del workspace. |

## Objetivos / No objetivos

**Objetivos:** export completo, consistente, versionado y cifrado; import a workspace nuevo con verificación; criterio de salida "export→import round-trip reproduce saldos".

**No objetivos:** documentos (Phase 6), export programado, contraseña del usuario en el archivo descargado, formatos de terceros, import parcial/fusión, borrado de workspace.

## Decisiones

1. **Capability propia `identity/workspace-portability`** en lugar de `identity/workspace-membership` (donde docs/01 ubicaba FR-IDENTITY-010): la membresía y la portabilidad evolucionan por separado y la spec de membresía no tiene nada de export. Se actualizan ARCHITECTURE §14 y docs/01 en este change; aceptada por el owner (docs/33 D108).
2. **Orquestación por puertos.** `PortabilityRegistry` lista secciones `{ context, section, schemaId, order }`. Export: abre una única transacción `READ ONLY, ISOLATION LEVEL REPEATABLE READ` (rol `pf_worker`, `SET LOCAL app.workspace_id`) y llama a cada `WorkspaceDataExporter.exportSection(tx, sink)` en orden; todos leen la misma instantánea. Import: orden topológico (iam → fx → classification → accounts → ledger → transactions → planning → audit/lifecycle).
3. **Formato v1** (docs/30 §10 con precisiones): `manifest.json` (`format: "pfos-export"`, `formatVersion: 1`, `workspaceId`, `workspaceName`, `exportedAt`, `snapshotAt`, `pfosVersion`, `baseCurrency`, `timezone`, `sections[{ name, file, schema, count, sha256 }]`, `verification { accountBalances[{ accountId, currency, balance }], trialBalance[{ ledgerAccountId, currency, balance }] }`, `actors[{ userId, displayName }]`); `json/<section>.jsonl` (una línea por registro; JSON para secciones pequeñas), cada registro valida contra `contracts/export/v1/<section>.schema.json` (JSON Schema 2020-12, publicado y versionado con el contrato); `csv/transactions.csv` (una fila por split: fecha, cuenta, tipo, estado, descripción, contraparte, categoría, tags, monto, moneda, custom fields) y `csv/account-balances.csv`. Montos y tasas como string decimal con la escala de su moneda; instantes ISO-8601 UTC y fechas `AAAA-MM-DD`.
4. **Cifrado de sobre en reposo.** Por export: clave de datos aleatoria de 256 bits; el ZIP se cifra en streaming con AES-256-GCM en bloques de 64 KiB (nonce = prefijo aleatorio de 64 bits + contador de 32 bits; tag por bloque; último bloque marcado) — formato propio documentado en `contracts/export/v1/ENCRYPTION.md`. La clave de datos se envuelve con la clave maestra activa (`ExportKeyProvider.wrap`) y se guarda `{ keyId, wrappedKey }` en `iam.workspace_export` (nunca en el bucket). Local/CI: keyring por variables `EXPORT_ENCRYPTION_KEYS` (JSON `{ keyId: base64 }`, secreto) y `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`; cloud: adapter KMS (`GenerateDataKey`/`Decrypt`). Rotación: nueva clave activa; las anteriores siguen en el keyring hasta que expiren sus exports (≤ 7 días). Además SSE del bucket (docs/30 §11). Cualquier fallo de autenticación GCM ⇒ `EXPORT_FILE_CORRUPTED`, sin bytes parciales enviados (se valida cada bloque antes de emitirlo y la respuesta se aborta en el primer fallo).
5. **Descarga por la API, no por presigned URL** (cambio respecto a docs/30 §10): el objeto está cifrado a nivel de aplicación, así que el descifrado ocurre en la API en streaming (`GET W/exports/{id}/download`, `Content-Disposition: attachment`, cabecera `Digest`/`Repr-Digest: sha-256=…` del ZIP en claro). Se actualiza docs/30 §10. El tráfico pasa por el BFF (mismo dominio, cookie de sesión).
6. **Re-autenticación reciente**: la API lee el claim `auth_time` del access token; si `now − auth_time > REAUTH_MAX_AGE` (por defecto 10 min, docs/12 §4) responde 403 `REAUTHENTICATION_REQUIRED`; el BFF inicia una autorización con `max_age=0` y reintenta. Aplica a solicitar export, descargar e importar. Keycloak local emite `auth_time`; se verifica en el IdP cloud elegido (ADR-0027).
7. **Retención**: `EXPORT_RETENTION` (por defecto `P7D`); job horario `identity.export-retention` borra el objeto y marca `EXPIRED` (actor `SYSTEM`, auditado); lifecycle del bucket a 8 días como red de seguridad. `discard` hace lo mismo a pedido del OWNER (`DISCARDED`). El registro (fechas, tamaño, sha256, actor) se conserva: es metadato, no el contenido. Borrar el objeto no viola "sin hard delete de datos financieros" (ARCHITECTURE §9): el export es una copia temporal derivada.
8. **Importación a workspace nuevo con remapeo total de IDs.** Se generan UUIDv7 nuevos que conservan el instante del original (orden temporal estable); el mapa `oldId → newId` vive durante el job y se guarda comprimido en `iam.workspace_import.report` para trazabilidad. Todo valor UUID presente en el mapa se reemplaza también dentro de estructuras JSON (diffs de auditoría, recorridos, `changes`). Las referencias a usuarios (`actor_user_id`, `created_by`) **no** se remapean: se conservan los IDs originales y `manifest.actors` resuelve sus nombres (sin FK cross-schema, NFR-DATA-015). Alternativa descartada: preservar IDs (choca cuando el workspace original existe en la misma instancia, que es el caso del test de ida y vuelta).
9. **Inserción de historia sin re-ejecutar comandos**: los importadores insertan filas tal cual (asientos, postings, reversas, revisiones, auditoría, transiciones) — no se re-postea por el traductor ni se generan eventos de negocio; se agrega **un** registro de auditoría nuevo `identity.workspace.restored` y la transición de creación del workspace. Al final: `RebuildBalanceSnapshots`, `VerifyLedgerIntegrity` (invariant checker, NFR-DATA-008 "tras cada restore") y verificación contra `manifest.verification`.
10. **Atomicidad del import**: una sola transacción de BD para todas las inserciones y la verificación (objetivo ≤ 10 min con 50k transacciones; `statement_timeout` del job ampliado). El workspace se crea con `status = RESTORING` (no listado al usuario) y pasa a `ACTIVE` en el mismo commit; cualquier fallo ⇒ rollback completo. Tamaño máximo del archivo 200 MB (decisión 11). Confirmado por el owner (docs/33 D100): sin inserción por lotes ni purga parcial en Phase 2.
11. **Validación previa del archivo** (antes de abrir la transacción): manifiesto presente, `format`/`formatVersion` soportados (`EXPORT_FORMAT_UNSUPPORTED`), sha256 de cada archivo (`EXPORT_FILE_CORRUPTED`), validación JSON Schema de cada registro, conteos. Tamaño máximo `WORKSPACE_IMPORT_MAX_BYTES` (200 MB, docs/33 D100) ⇒ 413 `UPLOAD_TOO_LARGE` (código del catálogo de docs/10 §9), sin crear nada. Manifiesto con `isDemo: true` ⇒ `EXPORT_FORMAT_UNSUPPORTED` (decisión 13). El archivo subido se guarda cifrado igual que un export hasta terminar y luego se elimina.
12. **Periodos cerrados en el import**: los asientos se insertan **antes** que los bloqueos de periodo del workspace nuevo, para que el trigger `PF004` no los rechace; los snapshots de cierre (pf-p2a) se insertan como historia inmutable.
13. **Demo**: el export de un workspace demo lleva `isDemo: true` en el manifiesto y **su importación se rechaza** con `EXPORT_FORMAT_UNSUPPORTED` en la validación previa (decisión 11), sin crear nada: los datos demo nunca entran a un workspace real (D36; decisión del owner docs/33 D99).
14. **Límites operativos**: una exportación en curso por workspace (único parcial en `iam.workspace_export`), rate limit 10/min (docs/10 §10), una importación en curso por usuario.

### Contratos (OpenAPI)

| Operación | Ruta | Rol / requisitos | Respuesta |
|---|---|---|---|
| `requestWorkspaceExport` | `POST W/exports` | OWNER, re-auth, `Idempotency-Key` | 202 `Location: W/operations/{id}` + `WorkspaceExport` |
| `listWorkspaceExports` | `GET W/exports` | OWNER | `WorkspaceExport[]` (sin URL) |
| `getWorkspaceExport` | `GET W/exports/{id}` | OWNER | `{ id, status, requestedAt, completedAt, expiresAt, sizeBytes, sha256, formatVersion, counts }` |
| `downloadWorkspaceExport` | `GET W/exports/{id}/download` | OWNER, re-auth | 200 `application/zip` (streaming) · 409 `EXPORT_NOT_READY` · 410 `EXPORT_EXPIRED` · 422 `EXPORT_FILE_CORRUPTED` |
| `discardWorkspaceExport` | `POST W/exports/{id}/discard` | OWNER | 200 |
| `requestWorkspaceImport` | `POST /workspace-imports` (multipart `file`) | usuario autenticado, re-auth, `Idempotency-Key` | 202 + `WorkspaceImport` · 413 `UPLOAD_TOO_LARGE` (> 200 MB, D100) · 422 `EXPORT_FORMAT_UNSUPPORTED` (incluye export demo, D99)/`EXPORT_FILE_CORRUPTED` (validación síncrona del manifiesto) |
| `getWorkspaceImport` | `GET /workspace-imports/{id}` | el solicitante | `{ status, workspaceId?, error?, counts }`; error final `EXPORT_VERIFICATION_FAILED` |

Configuración nueva (docs/config-reference): `OBJECT_STORAGE_EXPORTS_BUCKET`, `EXPORT_ENCRYPTION_KEYS` (secreto), `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`, `EXPORT_RETENTION`, `REAUTH_MAX_AGE`, `WORKSPACE_IMPORT_MAX_BYTES`.

### Modelo de datos

| Tabla | Definición | RLS / grants |
|---|---|---|
| `platform.operation` | docs/08 §OPERATION (`id, workspace_id, kind, status, progress_pct, resource_type, resource_id, result, error, requested_by, created_at, updated_at, expires_at`) — **la crea este change** (consolidación 2026-10-05: es el primer y único change de Phase 2 con operaciones asíncronas `202 + operation`; los demás comandos de Phase 2 son síncronos) | WS; `pf_app` SELECT/INSERT, `pf_worker` SELECT/UPDATE |
| `iam.workspace_export` | `id, workspace_id, operation_id, status CHECK IN ('REQUESTED','RUNNING','READY','FAILED','EXPIRED','DISCARDED'), format_version, object_key NULL, size_bytes NULL, sha256 bytea NULL, key_id NULL, wrapped_key bytea NULL, counts jsonb, requested_by, requested_at, completed_at NULL, expires_at NULL, discarded_at/by NULL, expired_at NULL, error jsonb NULL, version`. Único parcial `(workspace_id) WHERE status IN ('REQUESTED','RUNNING')` | WS forzada; `pf_app` SELECT/INSERT/UPDATE; `pf_worker` SELECT/UPDATE |
| `iam.workspace_import` | `id, requested_by, status, object_key, key_id, wrapped_key, source_workspace_id, source_exported_at, format_version, target_workspace_id NULL, report jsonb, error jsonb, created_at, completed_at` | Sin RLS de workspace (aún no existe); acceso solo por la API filtrando por `requested_by`; `pf_worker` SELECT/UPDATE |
| `iam.workspace` | Columnas aditivas `status` admite `RESTORING` (CHECK ampliado) y `restored_from_export jsonb NULL` (`sourceWorkspaceId`, `exportedAt`, `importId`) | sin cambios |

### Eventos

| Evento | Cuándo | Payload | Consumidor |
|---|---|---|---|
| `identity.WorkspaceExportCompleted.v1` | Export `READY` o `FAILED` | `exportId`, `status`, `expiresAt|null` (sin cifras) | NOTIFY (pf-p2b) — aviso in-app |
| `identity.WorkspaceRestored.v1` | Import `SUCCEEDED` | `workspaceId`, `importId`, `sourceExportedAt` | REPORTING (invalidar/reconstruir), NOTIFY |

### Datos de Phase 2 cubiertos (consolidación 2026-10-05)

| Change | Tablas incluidas en export/import | Excluidas (motivo) |
|---|---|---|
| `add-financial-periods` | `planning.financial_period` | — |
| `add-custom-fields` | `classification.custom_field_definition`, `txn.split_custom_field_value`, `accounts.account_custom_field_value` | — |
| `add-reconciliation` | `txn.reconciliation`, `txn.reconciliation_item` (y las columnas `txn.transaction.reconciliation_id` y `reconciliation_mode`, de la que se deriva la marca `RECONCILED_WITHOUT_STATEMENT`, docs/33 D74/D111) | — |
| `add-budgets` | `planning.budget`, `planning.budget_line`, `planning.budget_threshold_crossing` (se importa para no re-emitir umbrales) | — |
| `add-budget-templates` | `planning.budget_template`, `planning.budget_template_version`, `planning.budget_template_line` | — |
| `add-month-closing` | `planning.closing_policy`, `planning.close_snapshot`, `planning.close_snapshot_balance`, `planning.close_snapshot_without_statement` (D111), `planning.period_reopening`, `planning.close_pending_notice`, `ledger.period_lock` (con `period_start`/`period_end`, ADR-0028) | — |
| `add-alerts` | `notifications.notification_preference`, `notifications.user_setting` | `notifications.notification`, `notifications.notification_delivery` (derivadas, retención 12 meses) |
| `add-workspace-export` | — | `iam.workspace_export`, `iam.workspace_import`, `platform.operation` (metadatos técnicos) |
| `add-bulk-edit`, `add-global-audit-view`, `add-net-worth-evolution` | sin tablas nuevas | — |

Orden de importación (extiende la decisión 2): … → `planning.financial_period` → `planning.budget_template*` → `planning.budget` → `planning.budget_line` → `planning.budget_threshold_crossing` → `planning.closing_policy` → `planning.close_snapshot*` → `planning.period_reopening` → `planning.close_pending_notice` → `notifications.*` (preferencias) → audit/lifecycle → `ledger.period_lock` (al final, decisión 12). Las tablas append-only (`forbid_mutation`) se insertan como historia; ninguna se recalcula. Requirement "Datos de Phase 2 en el export" (TC-IDENTITY-EXPORT-012).

### Cobertura de tablas (regla nueva)

Test de arquitectura: toda tabla registrada en `platform.workspace_scoped_table` (ADR-0026) debe estar cubierta por una sección del `PortabilityRegistry` o declarada explícitamente como excluida (técnicas: `platform.outbox`, `platform.inbox`, `platform.idempotency_key`, `iam.bff_session`, cachés derivadas reconstruibles como `ledger.balance_snapshot`). Un change futuro que agregue una tabla sin sección rompe el test.

## Riesgos / Trade-offs

- **Archivo con todo el historial financiero fuera del sistema**: OWNER-only, re-auth, cifrado en reposo, descarga auditada, expiración; el archivo descargado queda en claro en el equipo del usuario (pregunta abierta 2).
- **Transacción larga de importación**: bloquea solo filas del workspace nuevo (invisible); riesgo de `statement_timeout` en volúmenes grandes; el owner confirmó una sola transacción con límite de 200 MB en Phase 2 (docs/33 D100).
- **Deriva de esquema**: cada change que agregue datos debe extender el formato (versión menor compatible: secciones nuevas opcionales); un cambio incompatible sube `formatVersion` y el importador mantiene lectores de versiones anteriores soportadas.
- **Pérdida de la clave maestra local**: los exports vigentes quedan indescifrables; aceptable (temporales, se re-exporta).

## Plan de migración

1. Expand: `platform.operation` (creada aquí), `iam.workspace_export`, `iam.workspace_import`, ampliación del CHECK de `iam.workspace.status` y columna `restored_from_export`; grants `INSERT` de `pf_worker` en tablas de negocio necesarias para el import (lista revisada en la tarea 4.1). No destructiva.
2. Bucket `exports` en local/CI (`migrate` con `OBJECT_STORAGE_ENSURE_BUCKET`) y en IaC (versioning OFF para exports, lifecycle 8 días, SSE).
3. Secretos nuevos en `.env.example` (sin valores) y `pnpm setup:env` (genera una clave local aleatoria).
4. Contrato: operaciones nuevas (MINOR); `exports` pasa de "Phase 7" a Phase 2 en docs/10.
5. Rollback: la versión anterior ignora las tablas; los objetos expiran por lifecycle.

## Preguntas abiertas

**Todas resueltas por el owner el 2026-10-08** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md), decisiones D59–D111); cada pregunta indica su decisión. Se conserva el texto original.

1. **Capability nueva.** ¿Se acepta `identity/workspace-portability` en la taxonomía (ARCHITECTURE §14) o se prefiere mantener FR-IDENTITY-010 en `identity/workspace-membership`? **Recomendación:** capability nueva (export e import son una responsabilidad propia, transversal a todos los contextos). → **Resuelta por el owner (2026-10-08): D108** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
2. **Cifrado del archivo descargado.** ¿Phase 2 debe ofrecer cifrar el ZIP descargado con una frase de contraseña del usuario (p. ej. formato `age` con passphrase), que el import pediría? **Recomendación:** no en Phase 2 (docs/30 §11 lo ubica en Phase 7+); el archivo se descarga en claro por canal HTTPS y la UI advierte guardarlo en un lugar seguro. → **Resuelta por el owner (2026-10-08): D98** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
3. **Export de un workspace demo.** ¿Se permite importar un export marcado `isDemo`? **Recomendación:** rechazarlo con `EXPORT_FORMAT_UNSUPPORTED` (los datos demo nunca deben entrar a un workspace real, D36). → **Resuelta por el owner (2026-10-08): D99** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
4. **Atomicidad del import con volúmenes grandes.** ¿Se acepta una única transacción de BD (decisión 10) con el límite de 200 MB, o se prefiere import por lotes con purga del workspace parcial vía la función restringida de ADR-0026? **Recomendación:** única transacción en Phase 2 (volumen de un usuario, ≤ 50k transacciones); revisar si un export real supera 10 min. → **Resuelta por el owner (2026-10-08): D100** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
5. **IDs preservados para recuperación ante desastre.** ¿Se ofrece una opción "preservar IDs" cuando no hay colisión (restauración en una instancia nueva)? **Recomendación:** no; siempre remapear (un solo camino de código, probado por el test nightly). → **Resuelta por el owner (2026-10-08): D101** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
6. **Retención por defecto.** ¿7 días (docs/30) o menos (p. ej. 24 h) dado que el archivo contiene todo? **Recomendación:** 7 días configurable, con eliminación anticipada disponible. → **Resuelta por el owner (2026-10-08): D102** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).

## Dependencias entre changes

- **Requiere aplicados (Phase 1):** `add-workspace-identity`, `add-api-conventions`, `add-event-outbox`, `add-audit-trail`, `add-ledger-core`, `add-classification`, `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-market-rate-providers`, `add-lifecycle-timeline`, `add-demo-data` (`platform.workspace_scoped_table`).
- **Orden consolidado (docs/03 §7): último change de Phase 2 (23).** Debe aplicarse después de los demás changes de Phase 2 que agregan datos — `add-reconciliation`, `add-custom-fields` (este hilo) y los de pf-p2a (`planning/financial-periods`, `planning/month-closing`: periodos, snapshots de cierre) y pf-p2b (`planning/budgets`, `planning/budget-templates`, `notifications/alerts`: presupuestos, templates versionados, preferencias y alertas) — o, si se aplica antes, cada uno de esos changes debe incluir la tarea "agregar su sección al export/import" (regla de cobertura de tablas). Recomendado: último change de Phase 2.
- **pf-p2b (`notifications/alerts`)**: consume `identity.WorkspaceExportCompleted.v1` para el aviso in-app (requirement Should); sin NOTIFY la UI muestra el estado en la pantalla de exportación.
- **`platform.operation`**: la crea este change (ningún change anterior de Phase 2 la necesita; verificado en la consolidación).
