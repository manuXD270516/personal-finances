# Tareas

> Requiere aplicados: `add-classification`, `add-transaction-recording`, `add-accounts-management`, `add-audit-trail`. Debe aplicarse antes de `add-bulk-edit` (custom fields en lote) y de `add-workspace-export`. Resolver antes la pregunta abierta 2 de design.md (periodos cerrados).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner `classification/custom-fields`, los MODIFIED de `transactions/transaction-recording` y las preguntas abiertas 1–3 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-custom-fields --strict`
  - 2026-10-08: resueltas por docs/33 D96 (`MULTI_SELECT` y `MONEY` fuera de Phase 2), D65 (custom fields de transacción rechazados con `PERIOD_CLOSED` en periodos cerrados, extensión de D49) y D97 (sin custom fields en transferencias ni conversiones). `pnpm spec:validate` (strict) en verde.
- [x] 1.2 Revisar TC-CLASSIFICATION-CUSTOMFIELD-001..011 y TC-TRANSACTIONS-CUSTOMFIELD-001..002; pasar a `ready` y `requirement_status: confirmed` al aprobar
  - 2026-10-08: los 13 TC quedan `requirement_status: confirmed` y, al automatizarse, `status: automated`; `pnpm traceability:check` en verde (569 TC, 0 advertencias).

## 2. DOMAIN (TDD)

- [x] 2.1 `CustomFieldDefinition` (clave, tipos, opciones con clave, bloqueos por uso, archivado), test-first (TC-CLASSIFICATION-CUSTOMFIELD-001, -002, -008, -009)
  - 2026-10-08: `packages/contexts/classification/src/domain/custom-field.ts` (+ `custom-field.test.ts`). Sin máquina de estados (solo archivado suave, como los tags).
- [x] 2.2 `CustomFieldValueValidator` puro por tipo, test-first con PBT para `DECIMAL` (ida y vuelta string ↔ Decimal sin pérdida, NFR-DATA-010) y casos borde de `DATE` (TC-CLASSIFICATION-CUSTOMFIELD-003)
  - 2026-10-08: `custom-field-value.ts` (`normalizeCustomFieldValue`, `canonicalDecimal` en `@pf/shared-kernel`); PBT de decimales de hasta 18 decimales y 20 enteros, y de enteros de 15 dígitos; ida y vuelta por `numeric(38,18)` en `apps/api/test/db/custom-fields.int.test.ts`.
- [x] 2.3 `TransactionSplit.customFields` y copia de valores al regenerar splits en una revisión; `Account.customFields` (TC-CLASSIFICATION-CUSTOMFIELD-004, -005)
  - 2026-10-08: `Split.customFields` (copia por posición al regenerar; los splits reemplazados conservan sus filas) y `Account.customFields`; semántica de la entrada: fija o quita (`null`) solo los campos mencionados.

## 3. APPLICATION

- [x] 3.1 Comandos de definición con auditoría y evento `CustomFieldDefinitionChanged.v1`; roles (TC-CLASSIFICATION-CUSTOMFIELD-001, -011)
  - 2026-10-08: `CustomFieldsService` (define, update, archive, unarchive; límite de 50 activas) y `CustomFieldsQueries`; esquema `contracts/events/classification/CustomFieldDefinitionChanged.v1.schema.json` con `examples` validados por Ajv.
- [x] 3.2 Puerto `ValidateCustomFieldValues` con caché por workspace; integración en `RecordTransaction`, `AmendTransaction`, `ApplyClassification`, `OpenAccount`, `UpdateAccount` (TC-CLASSIFICATION-CUSTOMFIELD-004..007, -010)
  - 2026-10-08: `ClassificationValidator.validateCustomFieldValues` (contrato público) invocado por `recordTransaction`/`updateTransaction` (que cubre `ApplyClassification`) y por `openAccount`/`updateAccount` (vía `CustomFieldCatalogPort`, adaptado en `apps/api`). Obligatoriedad no retroactiva (solo en registros nuevos, al editar custom fields o al regenerar splits). Periodos cerrados: `LedgerService.assertPeriodOpen` existente (D65). **Pendiente:** la caché de definiciones por workspace se difiere (cada validación lee ≤ 50 filas por el índice del workspace en la misma transacción); se retomará si el benchmark de escritura lo exige.
- [x] 3.3 Test de INV-033: asignar valores no toca el ledger (TC-CLASSIFICATION-CUSTOMFIELD-007)
  - 2026-10-08: `custom-fields.service.test.ts` (transactions) y `custom-fields.api.test.ts` (huella md5 de asientos y postings, saldo, auditoría `customFields.<clave>` y `TransactionUpdated.v1[customFields]`). La allow-list de AUDIT admite ahora el comodín de prefijo `customFields.*`.

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de las tres tablas (RLS forzada, grants, índices, `platform.workspace_scoped_table`); tests de integración de aislamiento y del CHECK `num_nonnulls`
  - 2026-10-08: `apps/api/db/migrations/20261008130000_classification_custom_fields.sql`; `apps/api/test/db/custom-fields.int.test.ts` (CHECK `num_nonnulls`, clave única solo entre activas, CHECK de opciones, RLS, grants y registro de purga).
- [x] 4.2 Filtro por custom field en el repositorio del listado; benchmark NFR-PERF-001 (TC-TRANSACTIONS-CUSTOMFIELD-002)
  - 2026-10-08: filtro por igualdad y rango tipado en `PgTransactionRepository.list`; escenarios "custom field (igualdad)" y "custom field + año" en `apps/api/test/perf/nightly.perf.ts` (10 000 valores sobre el Large Seed). Verificado a escala reducida (`PF_PERF_SCALE=0.05`, 377 valores, p95 ≈ 33 ms); la corrida con 50 000 transacciones queda para el job nightly.

## 5. API

- [x] 5.1 `W/custom-fields` en el contrato, `customFields` en splits y cuentas, filtro en `listTransactions`; códigos nuevos en `ErrorCatalog` y mensajes es/en/pt
  - 2026-10-08: 6 operaciones, schemas `CustomFieldDefinition*`, `CustomFieldValues(Input)`, parámetro `customField` (`style: deepObject`, soportado ahora por la validación de contrato), 7 códigos en `ErrorCode`/`ErrorCatalog` y en `errors.{es,en,pt}.json`. Spectral 0 errores y `oasdiff` sin cambios incompatibles. `customFields` conserva su forma de mapa por clave del contrato vigente (ver design.md § Contratos).
- [x] 5.2 Tests de API por TC (incluye ida y vuelta TC-TRANSACTIONS-CUSTOMFIELD-001)
  - 2026-10-08: `apps/api/test/api/custom-fields.api.test.ts` (17 pruebas contra PostgreSQL real; respuestas validadas contra el OpenAPI).

## 6. UI

- [x] 6.1 Configuración "Campos personalizados" (crear, editar, ordenar, archivar), inputs dinámicos en formularios de transacción (por split) y cuenta, columnas/filtros opcionales en el registro; i18n es/en/pt
  - 2026-10-08: pestaña `/clasificacion?vista=campos`; `CustomFieldInputs` por tipo en `SplitsEditor` y `AccountForm`; valores en el detalle de transacción y cuenta; valores y filtro (igualdad/rango) en el registro; namespace `CustomFields` en es/en/pt; axe sin violaciones serias en la pestaña nueva y en los formularios con campos.

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter
  - 2026-10-08: 13 TC `automated` (`pnpm traceability:check` en verde).
- [x] 7.2 E2E: definir "centro_costo", registrar un gasto con "oficina" y filtrarlo
  - 2026-10-08: `tests/e2e/specs/custom-fields.spec.ts` (3 pruebas) + `a11y.spec.ts` ampliado; suite E2E (41 pruebas) en verde con `PF_E2E_PROJECT=pfos-e2e-cf` (prefijo de puertos 4); las 3 de este change se repitieron tras ajustar aserciones.

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/04 §3.5 (tipos definitivos), docs/08 §5.4–§5.5 (as-built y `accounts.account_custom_field_value`), docs/10 §13, docs/11 (evento), docs/01 FR-CLASSIFICATION-009 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
  - 2026-10-08: docs actualizados; `pnpm traceability:matrix` regenerada; `pnpm spec:validate` y `pnpm traceability:check` en verde.
