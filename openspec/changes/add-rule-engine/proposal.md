# Propuesta: add-rule-engine

## Why

El objetivo de Phase 6 es reducir la captura manual (docs/24 §5.6), y su criterio de salida pide que, al importar 3 meses de extractos reales del owner, **al menos el 70 % de las transacciones quede clasificado por reglas**. Hoy toda transacción importada nace "sin categoría" (D9, `add-basic-csv-import`) y la única ayuda es la sugerencia de categoría por contraparte al llenar el formulario (`classification/counterparties`). FR-RULES-001..010 (Must y Should, Phase 6) piden un motor de reglas WHEN/THEN con prioridad determinista, vista previa, dry-run histórico, aplicación al importar y al crear, y trazabilidad de la regla y versión que clasificó cada split. El contexto RULES está previsto en docs/05 §2.13 y docs/08 §5.13 pero no existe en el código.

## What Changes

- **Contexto nuevo RULES** (`@pf/rules`, schema `rules`): reglas por workspace con nombre, descripción, prioridad, disparadores (importación, creación manual, ejecución retroactiva), modo `ALL`/`ANY` con grupos de un nivel, 1–20 condiciones y 1–10 acciones en un DSL JSON versionado; activar, desactivar y archivar (nunca borrar); versiones inmutables por cada cambio de definición.
- **Condiciones** sobre descripción, contraparte, monto (con moneda obligatoria, comparación exacta), moneda, cuenta, tipo, fecha, día de la semana, día del mes, categoría actual, etiquetas, fuente externa y campos personalizados; operadores de FR-RULES-003; texto sin acentos ni mayúsculas; `matches_regex` con motor de tiempo lineal y límites (`RULE_INVALID_REGEX`).
- **Acciones**: categoría, agregar o quitar etiquetas, contraparte, campo personalizado y marcar para revisión (Must); reemplazar descripción, agregar nota y excluir del import (Should). Nunca montos, moneda, cuenta, fecha, tipo ni estado.
- **Semántica**: evaluación acumulativa en orden de prioridad donde, por campo, **gana la primera regla que lo fija**; `stopProcessing` corta la cadena; acciones no aplicables (destino archivado, tipo de categoría, varios splits) se omiten con motivo sin bloquear a las siguientes. Determinista.
- **Vista previa** de una regla (guardada o sin guardar) contra una transacción o un ejemplo; **dry-run** retroactivo sobre hasta 366 días y 5 000 transacciones (modo "completar vacíos" por defecto o "reemplazar"); **aplicación** del diff como edición masiva auditada (≤ 500 por operación, `RULE_DRY_RUN_STALE`).
- **Importación**: puerto público `RuleEvaluationQuery` (sin efectos, set-based, ≤ 5 000 filas) que `add-import-pipeline` llama en la vista previa, con el orden alias → reglas → categoría por defecto de la contraparte; la clasificación aprobada viaja con su origen a `RecordImportedTransactions`.
- **Creación manual**: las reglas con disparador de creación manual completan solo los campos vacíos, en la misma operación (puerto `RuleSuggestionPort` de Transactions con adaptador en la composición); `applyRules: false` lo evita.
- **Trazabilidad**: cada split guarda el origen de su categoría (`MANUAL`, `RULE`, `COUNTERPARTY_DEFAULT`, `SYSTEM_DEFAULT`; `UNKNOWN` para lo anterior) y la regla y versión por campo; la auditoría lo incluye. **Marca de revisión** en la transacción con filtro y resolución auditada.
- **Cobertura**: `GET W/rules/coverage` informa, por rango o por import, cuántas transacciones importadas tienen hoy su categoría fijada por reglas, el desglose por origen y el cociente con 4 decimales frente a la meta 0.7000: es la medida del criterio de salida. Estadísticas por regla (transacciones clasificadas, última aplicación, sin uso en 90 días).
- **Portabilidad**: reglas, versiones, origen de la clasificación y marcas de revisión en el export e import del workspace.
- **Sin consumidores de eventos nuevos** (presupuesto de conexiones, D249) ni eventos nuevos.
- **UI**: pantalla de reglas (lista ordenable, editor con vista previa, dry-run con aplicación por páginas, cobertura), origen por campo en el detalle de la transacción, filtro "pendientes de revisión", "crear regla desde esta fila" (Could).
- **Fuera de alcance:** sugerir reglas desde recategorizaciones (FR-RULES-011, Phase 7); acciones "split por porcentajes" y "vincular a meta" (pregunta 3); reglas sobre transferencias y conversiones y la acción "marcar como transferencia" (pregunta 4); aplicación asíncrona posterior a la creación (pregunta 6); staging, vista previa y persistencia del import (`add-import-pipeline`); ML o IA.

## Capabilities

### New Capabilities
- `rules/rule-engine`: definición, condiciones, operadores, regex acotadas, combinación, acciones, protección de datos financieros, prioridad y resolución, `stopProcessing`, referencias no aplicables, vista previa, dry-run y su aplicación, evaluación en la importación, aplicación en la creación manual, trazabilidad, estados, versionado, cobertura, estadísticas, límites y rendimiento, permisos y creación desde una fila (24 requirements: 18 Must, 5 Should, 1 Could).

### Modified Capabilities
- `transactions/transaction-recording`: origen de la clasificación de cada split y marca de revisión pendiente (2 requirements ADDED, Must).
- `identity/workspace-portability`: reglas y origen de la clasificación en el export (1 requirement ADDED, Must).

## Impact

**Specs impactadas:** crea `rules/rule-engine` (24 requirements); agrega 2 a `transactions/transaction-recording` y 1 a `identity/workspace-portability`. Lee sin cambios `classification/categories`, `classification/tags`, `classification/counterparties`, `classification/custom-fields`, `transactions/bulk-edit` (reutiliza su semántica), `planning/financial-periods` (periodos cerrados), `audit/audit-trail`, `security/access-control`, `imports/import-pipeline` (la etapa de reglas la agrega `add-import-pipeline`).

**Componentes/contextos impactados:** RULES nuevo (`packages/contexts/rules`: AR `Rule`, VO `RuleDefinition`/`Condition`/`Action`, DS `RuleEvaluator` y `RegexGuard`, `RulesService`, `RuleDryRunService`, `RulesQueries`, `PgRuleRepository`, controller, contratos). TRANSACTIONS: origen en `Split`, marca de revisión, `RuleSuggestionPort`, `applyRules` en la creación, `recordBatch` con clasificación, `RuleClassificationCommand`, `ClassificationSubjectsQuery`, `ClassificationCoverageQuery`. CLASSIFICATION: `normalizeText` movido a `@pf/shared-kernel` (re-exportado). IMPORTS: consume `RuleEvaluationQuery` (implementado en `add-import-pipeline`). `apps/api` (módulo y adaptador), `apps/web` (reglas, cobertura, revisión).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo, tag Rules (`x-openspec-capability: rules/rule-engine`): `listRules`, `createRule`, `getRule`, `updateRule`, `enableRule`, `disableRule`, `archiveRule`, `listRuleVersions`, `reorderRules`, `previewRule`, `dryRunRules`, `applyRuleDryRun`, `getRuleCoverage`. Transactions: `applyRules` en la entrada, `needsReview`/`review` en `Transaction`, `categoryOrigin`/`ruleRefs` en `Split`, `needsReview` en el `PATCH` y en el filtro de `listTransactions`. Códigos nuevos en `ErrorCode`: `RULE_INVALID_REGEX` (422), `RULE_LIMIT_EXCEEDED` (422), `RULE_DRY_RUN_STALE` (409); reutiliza `VALIDATION_FAILED`, `NAME_TAKEN`, `PRECONDITION_FAILED`, `METHOD_NOT_ALLOWED`, `INSUFFICIENT_ROLE`, `REFERENCE_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TAG_ARCHIVED`, `COUNTERPARTY_ARCHIVED`, `CUSTOM_FIELD_ARCHIVED`, `CUSTOM_FIELD_VALUE_INVALID`, `RATE_LIMITED`. JSON Schema del DSL en `contracts/rules/`.

**Tablas impactadas:** nuevas `rules.rule` y `rules.rule_version` (RLS forzada, `platform.workspace_scoped_table`, export); columnas nuevas en `txn.transaction_split` (`category_origin`, `category_rule_id`, `category_rule_version`, `rule_refs`) y en `txn.transaction` (`review_status`, `review_reason`, `review_rule_id`, `review_rule_version`, `review_marked_at`); `audit.audit_log` (detalles con `ruleRefs`).

**Eventos impactados:** ninguno nuevo; sin consumidores nuevos. La aplicación del dry-run emite los mismos eventos que la edición masiva, sin cambio de esquema.

**Migraciones requeridas:** expand, no destructivas: schema `rules` con dos tablas, RLS y grants; columnas nulas sin default en `txn.transaction_split` y `txn.transaction`; índices parciales con `CREATE INDEX CONCURRENTLY` en migraciones aparte; secciones de export `rules` y `rule-versions`.

**Test cases:** AÑADIDOS — TC-RULES-ENGINE-001..058 (`draft`, `provisional`, `not_automated`; carpeta nueva `tests/cases/rules/`). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** el registro manual gana una evaluación síncrona opcional (benchmark de NFR-PERF-003 y TC-TRANSACTIONS-* en verde); `recordBatch` sin `classification` mantiene el comportamiento de Phase 3 (TC-IMPORTS-CSV-* en verde); la edición masiva pasa a fijar el origen `MANUAL` (TC-TRANSACTIONS-BULK-* en verde); export e import del workspace (test de cobertura de tablas); `normalizeText` movido sin cambio (TC-CLASSIFICATION-* en verde).

**Riesgos introducidos:** clasificación masiva errónea por reglas amplias (mitigado con vista previa, dry-run y cobertura que descuenta correcciones); dependencia nueva para regex lineales (licencia, NFR-COMP-003); acoplamiento con `add-import-pipeline` para medir el 70 % (contrato fijado aquí); RISK-016 (descripciones bancarias heterogéneas: normalización y regex acotadas).

**Invariantes afectadas:** INV-001 (montos de condiciones como `Decimal` exacto), INV-019 (categorías referenciadas por id, nunca borradas), INV-025 (RLS en `rules.*`), INV-027 (idempotencia de `createRule` y `applyRuleDryRun`), INV-029 (auditoría en la misma unidad de trabajo). Ninguna regla genera asientos ni cambia montos (INV-004/005 sin cambio).
