# Tareas

> Requiere aplicados todos los changes de Phase 1 (ver design.md § Dependencias) y, recomendado, los demás changes de Phase 2 que agregan datos (`add-reconciliation`, `add-custom-fields`, periodos/cierre de pf-p2a, presupuestos/alertas de pf-p2b). Resolver antes las preguntas abiertas 1, 3 y 4 de design.md.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner `identity/workspace-portability`, la reasignación de FR-IDENTITY-010, el nuevo FR-IDENTITY-017 y las preguntas abiertas 1–6 de design.md; verificar con `openspec validate add-workspace-export --strict`
- [ ] 1.2 Revisar TC-IDENTITY-EXPORT-001..011 y TC-IDENTITY-RESTORE-001..005 (cifras: 3099.10 + 50.000000 × 12.02 − 520.00 = 3180.10 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 `WorkspaceExport` y `WorkspaceImport` (estados, una exportación en curso, expiración) test-first (TC-IDENTITY-EXPORT-001, -007)
- [ ] 2.2 `ExportManifest` y verificación (`accountBalances`, `trialBalance`) test-first; PBT: serializar → parsear el manifiesto es identidad y los montos conservan escala (TC-IDENTITY-EXPORT-003, -004)
- [ ] 2.3 `IdRemap` (UUIDv7 que conserva el instante; reemplazo en estructuras JSON anidadas) test-first con PBT (TC-IDENTITY-RESTORE-001)

## 3. APPLICATION

- [ ] 3.1 `RequestWorkspaceExport` (OWNER, re-auth, idempotencia, operación) y `RunWorkspaceExport` (instantánea `REPEATABLE READ`, registry de secciones, ZIP en streaming, cifrado de sobre) (TC-IDENTITY-EXPORT-001, -002, -004, -005)
- [ ] 3.2 Exporters por contexto (`WorkspaceDataExporter`) en accounts, classification, transactions, ledger, fx, audit (y planning cuando exista) sin secretos (TC-IDENTITY-EXPORT-002)
- [ ] 3.3 `DownloadWorkspaceExport` (descifrado en streaming con verificación por bloque), `DiscardWorkspaceExport`, `ExpireWorkspaceExports` (job) (TC-IDENTITY-EXPORT-006, -007, -008)
- [ ] 3.4 Auditoría del ciclo y evento `WorkspaceExportCompleted.v1`; aviso in-app si NOTIFY existe (TC-IDENTITY-EXPORT-009, -011)
- [ ] 3.5 `RequestWorkspaceImport` (validación previa del archivo) y `RunWorkspaceImport` (importers por contexto en orden topológico, una transacción, `RebuildBalanceSnapshots`, `VerifyLedgerIntegrity`, verificación contra el manifiesto, auditoría `identity.workspace.restored`, `WorkspaceRestored.v1`) (TC-IDENTITY-RESTORE-001..005)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand (`platform.operation` si falta, `iam.workspace_export`, `iam.workspace_import`, CHECK de `iam.workspace.status`, `restored_from_export`) y revisión de grants `INSERT` de `pf_worker` por tabla de negocio; tests de RLS y de permisos
- [ ] 4.2 `ExportKeyProvider` (keyring local + adapter KMS) y formato de cifrado por bloques documentado en `contracts/export/v1/ENCRYPTION.md`; tests: objeto sin texto en claro, alteración detectada (TC-IDENTITY-EXPORT-005)
- [ ] 4.3 Bucket `exports` (migrate local/CI, IaC cloud con SSE y lifecycle), config nueva en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`)
- [ ] 4.4 Esquemas `contracts/export/v1/*.schema.json` y test que valida cada sección exportada contra su esquema (TC-IDENTITY-EXPORT-003)
- [ ] 4.5 Test de arquitectura de cobertura de tablas (`platform.workspace_scoped_table` ↔ `PortabilityRegistry`)

## 5. API

- [ ] 5.1 Operaciones del contrato (design.md § Contratos), multipart con límite, `Repr-Digest`, códigos nuevos en `ErrorCatalog` y mensajes es/en/pt
- [ ] 5.2 Re-autenticación: `ReauthPolicy` en la API y flujo `max_age` en el BFF; tests de API (TC-IDENTITY-EXPORT-001, -006)

## 6. UI

- [ ] 6.1 Configuración del workspace → "Exportar datos" (solicitar, estado, descargar, eliminar, lista con vencimiento) e "Importar workspace" (subir, progreso, resultado); advertencias de seguridad; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 Test nightly de ida y vuelta (NFR-REL-014) con el dataset `large` de docs/29: export → import → saldos, balance de comprobación, patrimonio y recorridos idénticos; entra a la Financial Regression Suite (TC-IDENTITY-RESTORE-002)
- [ ] 7.3 E2E: exportar con re-autenticación, descargar e importar en un workspace nuevo

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/30 §10–§11 (descarga por API con descifrado, cifrado de sobre, import en Phase 2), docs/08 §13.2 (as-built), docs/10 §13 (`exports`, `workspace-imports`), docs/12 §4/§13 (re-auth implementada), docs/11 (eventos), docs/03 §4 (regla: todo change con tablas de negocio agrega su sección al export), runbook "Restaurar un workspace desde un export" y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
