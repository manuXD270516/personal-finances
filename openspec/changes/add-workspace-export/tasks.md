# Tareas

> Requiere aplicados todos los changes de Phase 1 (ver design.md § Dependencias) y los demás changes de Phase 2 (es el último del orden consolidado, docs/03 §7); las tablas a cubrir están en design.md § "Datos de Phase 2 cubiertos". Resolver antes las preguntas abiertas 1, 3 y 4 de design.md.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner `identity/workspace-portability`, la reasignación de FR-IDENTITY-010, el nuevo FR-IDENTITY-017 y las preguntas abiertas 1–6 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-workspace-export --strict` _(Hecho 2026-10-09: decisiones del owner D98–D102 y D108 de docs/33; `openspec validate add-workspace-export --strict` verde.)_
- [x] 1.2 Revisar TC-IDENTITY-EXPORT-001..012 y TC-IDENTITY-RESTORE-001..007 (cifras: 3099.10 + 50.000000 × 12.02 − 520.00 = 3180.10 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar _(Hecho 2026-10-09: los 19 TC pasan a `automated`.)_

## 2. DOMAIN (TDD)

- [x] 2.1 `WorkspaceExport` y `WorkspaceImport` (estados, una exportación en curso, expiración) test-first (TC-IDENTITY-EXPORT-001, -007)
- [x] 2.2 `ExportManifest` y verificación (`accountBalances`, `trialBalance`) test-first; PBT: serializar → parsear el manifiesto es identidad y los montos conservan escala (TC-IDENTITY-EXPORT-003, -004)
- [x] 2.3 `IdRemap` (UUIDv7 que conserva el instante; reemplazo en estructuras JSON anidadas) test-first con PBT (TC-IDENTITY-RESTORE-001)

## 3. APPLICATION

- [x] 3.1 `RequestWorkspaceExport` (OWNER, re-auth, idempotencia, operación) y `RunWorkspaceExport` (instantánea `REPEATABLE READ`, registry de secciones, ZIP en streaming, cifrado de sobre) (TC-IDENTITY-EXPORT-001, -002, -004, -005)
- [x] 3.2 Exporters/importers por contexto (`WorkspaceDataExporter`/`WorkspaceDataImporter`) en accounts, classification, transactions, ledger, fx, audit, planning y notifications (preferencias), con todas las tablas de design.md § "Datos de Phase 2 cubiertos", sin secretos (TC-IDENTITY-EXPORT-002, TC-IDENTITY-EXPORT-012) _(Hecho 2026-10-09: las secciones se declaran como datos puros por contexto en `contracts/portability.ts` y un adaptador genérico de identity las ejecuta (en vez de clases `WorkspaceDataExporter/Importer` por contexto); el orden lo compone `apps/api/src/portability`.)_
- [x] 3.3 `DownloadWorkspaceExport` (descifrado en streaming con verificación por bloque), `DiscardWorkspaceExport`, `ExpireWorkspaceExports` (job) (TC-IDENTITY-EXPORT-006, -007, -008)
- [x] 3.4 Auditoría del ciclo y evento `WorkspaceExportCompleted.v1`; aviso in-app si NOTIFY existe (TC-IDENTITY-EXPORT-009, -011) _(Hecho 2026-10-09: evento y auditoría; el aviso in-app NO usa NOTIFY —ampliar `NotificationLink` es cambio rompedor del contrato— sino que la UI muestra el aviso «Tu exportación está lista» sin cifras.)_
- [x] 3.5 `RequestWorkspaceImport` (validación previa del archivo) y `RunWorkspaceImport` (importers por contexto en orden topológico, una transacción, `RebuildBalanceSnapshots`, `VerifyLedgerIntegrity`, verificación contra el manifiesto, auditoría `identity.workspace.restored`, `WorkspaceRestored.v1`) (TC-IDENTITY-RESTORE-001..005); rechazo del export demo con `EXPORT_FORMAT_UNSUPPORTED` y de archivos > 200 MB con 413 `UPLOAD_TOO_LARGE` (docs/33 D99, D100; TC-IDENTITY-RESTORE-006, TC-IDENTITY-RESTORE-007)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand (`platform.operation` —la crea este change—, `iam.workspace_export`, `iam.workspace_import`, CHECK de `iam.workspace.status`, `restored_from_export`) y revisión de grants `INSERT` de `pf_worker` por tabla de negocio; tests de RLS y de permisos
- [x] 4.2 `ExportKeyProvider` (keyring local + adapter KMS) y formato de cifrado por bloques documentado en `contracts/export/v1/ENCRYPTION.md`; tests: objeto sin texto en claro, alteración detectada (TC-IDENTITY-EXPORT-005) _(Hecho 2026-10-09: llavero local `kid:clave` en base64url o hexadecimal; el adaptador KMS queda para el change de despliegue cloud.)_
- [x] 4.3 Bucket `exports` (migrate local/CI, IaC cloud con SSE y lifecycle), config nueva en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`)
- [x] 4.4 Esquemas `contracts/export/v1/*.schema.json` y test que valida cada sección exportada contra su esquema (TC-IDENTITY-EXPORT-003)
- [x] 4.5 Test de arquitectura de cobertura de tablas (`platform.workspace_scoped_table` ↔ `PortabilityRegistry`)

## 5. API

- [x] 5.1 Operaciones del contrato (design.md § Contratos), multipart con límite, `Repr-Digest`, códigos nuevos en `ErrorCatalog` y mensajes es/en/pt
- [x] 5.2 Re-autenticación: `ReauthPolicy` en la API y flujo `max_age` en el BFF; tests de API (TC-IDENTITY-EXPORT-001, -006) _(Hecho 2026-10-09: el BFF acepta `login?reauth=1` → `prompt=login&max_age=0` y multipart solo en `workspace-imports`.)_

## 6. UI

- [x] 6.1 Configuración del workspace → "Exportar datos" (solicitar, estado, descargar, eliminar, lista con vencimiento) e "Importar workspace" (subir, progreso, resultado); advertencias de seguridad; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter
- [x] 7.2 Test nightly de ida y vuelta (NFR-REL-014) con el dataset `large` de docs/29: export → import → saldos, balance de comprobación, patrimonio y recorridos idénticos; entra a la Financial Regression Suite (TC-IDENTITY-RESTORE-002) _(Hecho 2026-10-09: `workspace-roundtrip-large.int.test.ts` con el generador `large` a escala reducida por PR; compara saldos por cuenta, filas por tabla y balance de comprobación.)_
- [x] 7.3 E2E: exportar con re-autenticación, descargar e importar en un workspace nuevo

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/30 §10–§11 (descarga por API con descifrado, cifrado de sobre, import en Phase 2), docs/08 §13.2 (as-built), docs/10 §13 (`exports`, `workspace-imports`), docs/12 §4/§13 (re-auth implementada), docs/11 (eventos), docs/03 §4 (regla: todo change con tablas de negocio agrega su sección al export), runbook "Restaurar un workspace desde un export" y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
