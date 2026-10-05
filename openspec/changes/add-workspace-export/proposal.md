# Propuesta: add-workspace-export

## Why

El owner necesita poder llevarse **todos** sus datos financieros en un formato abierto y recuperarlos sin depender de la infraestructura (backups de plataforma, proveedor cloud): es el requisito de portabilidad FR-IDENTITY-010 (Must, Phase 2), NFR-PORT-009 (formatos abiertos con JSON Schema), NFR-COMP-002 (portabilidad antes de multi-usuario) y NFR-REL-014 ("export + import en workspace vacío reproduce saldos idénticos"). La ida y vuelta export → import es además **criterio de salida de Phase 2** (docs/24 §5.2). docs/30 §10–§11 y docs/08 §13.2 ya diseñaron el formato (`pfos-export`, `formatVersion: 1`, manifiesto con hashes, JSON por agregado + CSV) y la operación asíncrona OWNER-only y auditada; docs/12 §4 exige re-autenticación reciente para exportar. Falta especificar el comportamiento verificable, el cifrado en reposo del archivo, su retención y la importación (que docs/30 había dejado "fuera de alcance inicial" y el criterio de salida trae a Phase 2).

## What Changes

- **Exportación asíncrona** (`POST W/exports` → `202` + operación) solo para el OWNER con autenticación reciente (≤ 10 min, `REAUTHENTICATION_REQUIRED`), idempotente, una en curso por workspace.
- **Contenido completo** del workspace (configuración, monedas, cuentas, catálogos, custom fields, transacciones con todas sus revisiones, ledger completo, bloqueos de periodo, tasas y preferencias, reconciliaciones, auditoría, recorridos y planificación cuando exista) **sin secretos** (tokens, sesiones, claves de idempotencia, outbox, hashes de IP).
- **Formato abierto y versionado**: ZIP con `manifest.json`, `json/` (JSON/JSON Lines validables con JSON Schema publicado en `contracts/export/v1/`) y `csv/` (RFC 4180 UTF-8, punto decimal, neutralización de CSV injection); montos como texto decimal exacto.
- **Instantánea consistente** (una transacción de solo lectura `REPEATABLE READ`) con saldos por cuenta y balance de comprobación en el manifiesto.
- **Cifrado en reposo** del archivo: cifrado de sobre (AES-256-GCM por archivo con clave de datos propia, envuelta por una clave maestra rotable identificada por `keyId`); el almacenamiento nunca tiene el ZIP en claro; integridad verificada al descifrar. Además, SSE del bucket donde exista (docs/30 §11).
- **Descarga** por la API (streaming con descifrado), OWNER con autenticación reciente, auditada, con SHA-256; **retención** de 7 días configurable con purga del objeto (el registro del export se conserva); eliminación anticipada (Should).
- **Importación** (`POST /api/v1/workspace-imports`) de un export válido a un **workspace nuevo** (nunca a uno existente) con identificadores nuevos, preservando asientos, reversas, revisiones, auditoría y recorridos; **verificación** de saldos y balance de comprobación contra el manifiesto antes de hacer visible el workspace; rechazo de archivos alterados o de versión no soportada.
- **Auditoría** de todo el ciclo (solicitud, fin, descargas, eliminación, expiración, importación) y aviso in-app sin cifras al terminar (Should; usa `notifications/alerts` si está disponible).
- **Nueva capability** `identity/workspace-portability` (ARCHITECTURE §14 y docs/01 actualizados en este change: FR-IDENTITY-010 cambia de capability y se agrega FR-IDENTITY-017).
- **Fuera de alcance:** documentos/adjuntos (no existen hasta Phase 6; la sección `documents/` queda reservada en el formato), export programado mensual (Phase 7+), cifrado del archivo descargado con frase de contraseña del usuario (docs/30 §11: Phase 7+; pregunta abierta 2), formatos de terceros (Ledger/hledger, OFX; docs/30 pregunta 6), importación parcial o fusión dentro de un workspace existente, borrado de workspace (FR-IDENTITY-012, Won't now), export de reportes (`reporting/financial-reports`, Phase 7).

## Capabilities

### New Capabilities
- `identity/workspace-portability`: exportación completa, consistente, versionada y cifrada del workspace con retención y auditoría; importación a un workspace nuevo con verificación de la ida y vuelta (FR-IDENTITY-010, FR-IDENTITY-017).

### Modified Capabilities
- Ninguna. (FR-IDENTITY-010 estaba mapeado a `identity/workspace-membership`, pero esa spec no tiene requirements de export; se reasigna a la capability nueva para no mezclar membresía con portabilidad. Pregunta abierta 1.)

## Impact

**Specs impactadas:** crea `identity/workspace-portability` (13 requirements: 11 Must, 2 Should).

**Componentes/contextos impactados:** IDENTITY (`@pf/identity`): orquestador `WorkspaceExportService` / `WorkspaceImportService`, agregados `WorkspaceExport` y `WorkspaceImport`, puerto `ExportKeyProvider` (cifrado de sobre; adapter local por keyring y adapter KMS en cloud), puerto `ExportObjectStore` (S3 API). Cada contexto con datos (accounts, classification, transactions, ledger, fx, audit, planning cuando exista) implementa en su `contracts` los puertos `WorkspaceDataExporter` (lee su sección dentro de la transacción de instantánea) y `WorkspaceDataImporter` (inserta su sección con IDs remapeados), respetando las fronteras hexagonales. PLATFORM: tabla `platform.operation` y endpoint `getOperation` (docs/10 §8) si aún no existen. `apps/worker` (jobs `identity.workspace-export`, `identity.workspace-import`, `identity.export-retention`), `apps/api` (controllers, descarga en streaming), `apps/web` (configuración del workspace → "Exportar datos", "Importar workspace"; re-autenticación vía BFF con `max_age`).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `requestWorkspaceExport` (`POST W/exports`, 202), `listWorkspaceExports` (`GET W/exports`), `getWorkspaceExport` (`GET W/exports/{id}`), `downloadWorkspaceExport` (`GET W/exports/{id}/download`, `application/zip`), `discardWorkspaceExport` (`POST W/exports/{id}/discard`: elimina el archivo, conserva el registro), `requestWorkspaceImport` (`POST /workspace-imports`, multipart, 202), `getWorkspaceImport` (`GET /workspace-imports/{id}`); `getOperation` con `kind: EXPORT`. docs/10 §13 reasigna `exports` de `reporting/financial-reports` (Phase 7) a `identity/workspace-portability` (Phase 2). Códigos nuevos: `REAUTHENTICATION_REQUIRED` (403), `EXPORT_IN_PROGRESS` (409), `EXPORT_NOT_READY` (409), `EXPORT_EXPIRED` (410), `EXPORT_FILE_CORRUPTED` (422), `EXPORT_FORMAT_UNSUPPORTED` (422), `EXPORT_VERIFICATION_FAILED` (422, error de la operación de importación). Esquemas de datos del export en `contracts/export/v1/*.schema.json`.

**Tablas impactadas:** nuevas `iam.workspace_export`, `iam.workspace_import`, `platform.operation` (docs/08 §OPERATION, si no la creó antes otro change); columna `iam.workspace.restored_from_export_id` (aditiva). Lectura de todas las tablas de negocio del workspace; en la importación, inserción en todas ellas para el workspace nuevo (rol `pf_worker`, RLS con el `workspace_id` nuevo).

**Eventos impactados:** nuevo `identity.WorkspaceExportCompleted.v1` (también en falla, con `status`) consumido por NOTIFY (pf-p2b) para el aviso in-app; nuevo `identity.WorkspaceRestored.v1` (workspace creado por importación). Ningún evento de negocio se re-publica al importar (los consumidores reconstruyen proyecciones con `RebuildProjection`).

**Migraciones requeridas:** expand, no destructiva: tablas nuevas con RLS (las de `iam` por workspace; `iam.workspace_import` por `requested_by` sin RLS de workspace, accesible solo por la API con el usuario autenticado), grants de `INSERT` a `pf_worker` en las tablas de negocio que aún no lo tengan (revisión por tabla), bucket `exports` (`OBJECT_STORAGE_EXPORTS_BUCKET`) creado por `migrate` en local/CI y por IaC en cloud, con lifecycle de 7 días como red de seguridad.

**Invariantes afectadas:** INV-001/INV-003 (montos exactos con escala en el archivo), INV-004/INV-022 (saldos y balance reproducidos), INV-007/INV-011 (el import inserta historia inmutable; no actualiza nada), INV-025 (todo lo importado pertenece al workspace nuevo), INV-027 (idempotencia de la solicitud), INV-029 (auditoría).

**Test cases:** AÑADIDOS — TC-IDENTITY-EXPORT-001..011 y TC-IDENTITY-RESTORE-001..005 (`draft`/`ready`, `not_automated`). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** cada change futuro que agregue una tabla de negocio DEBE agregar su sección al export/import y su esquema (regla en docs/03 §4 y test de arquitectura que compara `platform.workspace_scoped_table` con las secciones exportadas). El test nightly de ida y vuelta (NFR-REL-014) entra a la Financial Regression Suite.

**Riesgos introducidos:** RISK-009 (pérdida de datos: un export incompleto da falsa seguridad; mitigado con verificación de la ida y vuelta y test de cobertura de tablas); exposición de datos (archivo con todo el historial financiero: OWNER-only, re-auth, cifrado en reposo, expiración, auditoría); tamaño y duración (objetivo: 50k transacciones exportadas ≤ 3 min, importadas ≤ 10 min, archivo ≤ 200 MB); gestión de la clave maestra (pérdida ⇒ exports no descifrables, aceptable por ser temporales).
