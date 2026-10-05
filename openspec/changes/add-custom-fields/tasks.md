# Tareas

> Requiere aplicados: `add-classification`, `add-transaction-recording`, `add-accounts-management`, `add-audit-trail`. Debe aplicarse antes de `add-bulk-edit` (custom fields en lote) y de `add-workspace-export`. Resolver antes la pregunta abierta 2 de design.md (periodos cerrados).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner `classification/custom-fields`, los MODIFIED de `transactions/transaction-recording` y las preguntas abiertas 1–3 de design.md; verificar con `openspec validate add-custom-fields --strict`
- [ ] 1.2 Revisar TC-CLASSIFICATION-CUSTOMFIELD-001..011 y TC-TRANSACTIONS-CUSTOMFIELD-001..002; pasar a `ready` y `requirement_status: confirmed` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 `CustomFieldDefinition` (clave, tipos, opciones con clave, bloqueos por uso, archivado), test-first (TC-CLASSIFICATION-CUSTOMFIELD-001, -002, -008, -009)
- [ ] 2.2 `CustomFieldValueValidator` puro por tipo, test-first con PBT para `DECIMAL` (ida y vuelta string ↔ Decimal sin pérdida, NFR-DATA-010) y casos borde de `DATE` (TC-CLASSIFICATION-CUSTOMFIELD-003)
- [ ] 2.3 `TransactionSplit.customFields` y copia de valores al regenerar splits en una revisión; `Account.customFields` (TC-CLASSIFICATION-CUSTOMFIELD-004, -005)

## 3. APPLICATION

- [ ] 3.1 Comandos de definición con auditoría y evento `CustomFieldDefinitionChanged.v1`; roles (TC-CLASSIFICATION-CUSTOMFIELD-001, -011)
- [ ] 3.2 Puerto `ValidateCustomFieldValues` con caché por workspace; integración en `RecordTransaction`, `AmendTransaction`, `ApplyClassification`, `OpenAccount`, `UpdateAccount` (TC-CLASSIFICATION-CUSTOMFIELD-004..007, -010)
- [ ] 3.3 Test de INV-033: asignar valores no toca el ledger (TC-CLASSIFICATION-CUSTOMFIELD-007)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de las tres tablas (RLS forzada, grants, índices, `platform.workspace_scoped_table`); tests de integración de aislamiento y del CHECK `num_nonnulls`
- [ ] 4.2 Filtro por custom field en el repositorio del listado; benchmark NFR-PERF-001 (TC-TRANSACTIONS-CUSTOMFIELD-002)

## 5. API

- [ ] 5.1 `W/custom-fields` en el contrato, `customFields` en splits y cuentas, filtro en `listTransactions`; códigos nuevos en `ErrorCatalog` y mensajes es/en/pt
- [ ] 5.2 Tests de API por TC (incluye ida y vuelta TC-TRANSACTIONS-CUSTOMFIELD-001)

## 6. UI

- [ ] 6.1 Configuración "Campos personalizados" (crear, editar, ordenar, archivar), inputs dinámicos en formularios de transacción (por split) y cuenta, columnas/filtros opcionales en el registro; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 E2E: definir "centro_costo", registrar un gasto con "oficina" y filtrarlo

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/04 §3.5 (tipos definitivos), docs/08 §5.4–§5.5 (as-built y `accounts.account_custom_field_value`), docs/10 §13, docs/11 (evento), docs/01 FR-CLASSIFICATION-009 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
