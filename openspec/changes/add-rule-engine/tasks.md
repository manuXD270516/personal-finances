# Tareas

> Phase 6. Requiere Phase 1–2 (`classification/*`, `transactions/bulk-edit`, `identity/workspace-portability`). Las preguntas 1 y 2 de design.md bloquean los grupos 2 y 3. La integración con la vista previa del import y la medición del criterio de salida (7.5) requieren `add-import-pipeline` (design § Dependencias); el resto no. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `rules/rule-engine`, los deltas de `transactions/transaction-recording` e `identity/workspace-portability` y las preguntas 1–7 de design.md; registrar las respuestas en el doc de decisiones de Phase 6; `openspec validate add-rule-engine --strict` Hecho 2026-10-30: decisiones D333–D339 en `docs/57-phase-6-consolidation-decisions.md`.
- [x] 1.2 Revisar TC-RULES-ENGINE-001..058 contra los scenarios (cifras a mano: 148 ÷ 200 = 0.7400; 145 ÷ 198 = 0.7323; 41 ÷ 57 = 0.7193; 185.40 + 60.00 + 300.00 = 545.40 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar Hecho 2026-10-30: TC-RULES-ENGINE-001..058 revisados y con front matter actualizado (047 queda `not_automated`, evidencia del owner en 7.5).
- [x] 1.3 Verificación cruzada con `add-import-pipeline`: el orden alias → reglas → categoría por defecto, el uso de `RuleEvaluationQuery` y `ImportedClassificationDto` en `RecordImportedTransactions` quedan en su design y tasks; registrar el resultado aquí Hecho 2026-10-30: `add-import-pipeline/design.md` (líneas 10, 51 y 114) usa el mismo orden alias → reglas → categoría por defecto y consume `RuleEvaluationQuery.evaluate`; `add-bulk-imported-transactions/design.md` (líneas 37 y 66) anticipa `ImportedClassificationDto`, que ya entra por `RecordImportedTransactions.recordBatch` con su prueba de equivalencia lote vs individual.
- [x] 1.4 JSON Schema del DSL `contracts/rules/conditions.v1.schema.json` y `contracts/rules/actions.v1.schema.json` (sin propiedades de monto, moneda, cuenta, fecha, tipo ni estado en las acciones) con ejemplos válidos e inválidos Hecho 2026-10-30: `contracts/rules/conditions.v1.schema.json` y `actions.v1.schema.json` con ejemplos válidos e inválidos (`dsl-schema.test.ts`).

## 2. DOMAIN (TDD)

- [x] 2.1 `normalizeText` a `@pf/shared-kernel` (`text/normalize`), re-exportado por Classification sin cambio (TC-CLASSIFICATION-* en verde) Hecho 2026-10-30: `normalizeText` vive en `@pf/shared-kernel/text`; Classification lo re-exporta.
- [x] 2.2 VO `Condition` (matriz operador × tipo, monto con moneda y `Decimal`, fecha, día de la semana y del mes) y `RuleDefinition` (1–20 condiciones, 1–10 acciones, un nivel de grupos) test-first (TC-RULES-ENGINE-002, -004, -005, -006, -007, -008, -009, -012, -017) Hecho 2026-10-30.
- [x] 2.3 VO `Action` y su aplicabilidad (destino archivado, tipo de categoría, multi-split, modo completar, exclusión solo en importación) test-first (TC-RULES-ENGINE-013, -014, -015, -016, -023, -024) Hecho 2026-10-30.
- [x] 2.4 `RegexGuard` con motor de tiempo lineal (verificar licencia contra NFR-COMP-003 y registrarla aquí): límites, construcciones prohibidas, peor caso acotado test-first (TC-RULES-ENGINE-010, -011) Hecho 2026-10-30: motor `re2js` 2.8.8 (puerto JS de RE2, tiempo lineal), licencia MIT compatible con NFR-COMP-003; `LinearRegex` en shared-kernel (patrón ≤ 200, texto ≤ 500; sin retroreferencias ni lookaround) y `RegexGuard` en Rules.
- [x] 2.5 DS `RuleEvaluator` (orden total, primer escritor gana por campo y por etiqueta, `stopProcessing`, omisiones con motivo, origen por campo) test-first; PBT: mismo resultado con cualquier orden de carga y 100 repeticiones (TC-RULES-ENGINE-019, -020, -021, -022) Hecho 2026-10-30: incluye PBT de orden de carga con 100 repeticiones.
- [x] 2.6 AR `Rule` (estados activo, inactivo, archivado; versión de definición vs cambios auditados sin versión; `needsAttention`) test-first (TC-RULES-ENGINE-001, -039, -040, -041, -043) Hecho 2026-10-30: `needsAttention` se calcula dinámicamente al leer (no hay máquina de estados del ciclo de vida para `Rule`).
- [x] 2.7 TRANSACTIONS: origen de la categoría en `Split` y marca de revisión en `Transaction` (sin efecto en el ledger; el cambio manual pone `MANUAL`) test-first (TC-RULES-ENGINE-018, -055, -056, -057) Hecho 2026-10-30.

## 3. APPLICATION

- [x] 3.1 `RulesService`: crear, actualizar (versión e `If-Match`), activar, desactivar, archivar, reordenar; validación de referencias con `ClassificationValidator`; límite de 500; auditoría en la misma unidad de trabajo (TC-RULES-ENGINE-001, -003, -042, -043, -049, -052) Hecho 2026-10-30.
- [x] 3.2 `RuleEvaluationQuery.evaluate` (contrato público; una consulta de reglas y una de ids activos; ≤ 5 000 sujetos; sin efectos) (TC-RULES-ENGINE-013, -031, -053) Hecho 2026-10-30.
- [x] 3.3 `previewRule` (definición guardada o no, transacción o ejemplo, condiciones con resultado, sin auditoría) (TC-RULES-ENGINE-025, -026) Hecho 2026-10-30.
- [x] 3.4 `RuleDryRunService` (sujetos por keyset, modos, truncado, token) y `applyRuleDryRun` (≤ 500, recálculo del token parcial, `RULE_DRY_RUN_STALE`) (TC-RULES-ENGINE-027, -028, -029, -030) Hecho 2026-10-30: la aplicación recibe `items` con la versión de cada transacción y el token cubre ids y versiones de las reglas más el modo; discrepancia ⇒ `RULE_DRY_RUN_STALE` o `CONCURRENCY_CONFLICT`.
- [x] 3.5 TRANSACTIONS: `RuleSuggestionPort` en `createTransaction` (`applyRules`, solo campos vacíos, solo `INCOME`/`EXPENSE`/`REFUND`) (TC-RULES-ENGINE-034, -035, -036) Hecho 2026-10-30: puerto `RuleSuggestionPort` en Transactions, adaptado de forma perezosa en `identity-wiring` (`deferred.rules`) para evitar el ciclo.
- [x] 3.6 TRANSACTIONS: `recordBatch` con `ImportedClassificationDto` (origen, `ruleRefs`, validación set-based por lote; sin clasificación ⇒ comportamiento de Phase 3) (TC-RULES-ENGINE-032, -033, -055) Hecho 2026-10-30.
- [x] 3.7 TRANSACTIONS: `RuleClassificationCommand.applyBatch` reutilizando el dominio de la edición masiva; `ClassificationSubjectsQuery`; `ClassificationCoverageQuery` (TC-RULES-ENGINE-029, -044, -045, -046) Hecho 2026-10-30.
- [x] 3.8 `getRuleCoverage` y estadísticas por regla (nombres, archivadas, sin uso en 90 días) (TC-RULES-ENGINE-044, -046, -048) Hecho 2026-10-30: la API de cobertura usa `count` y `byOrigin` (camelCase, por Spectral).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: schema `rules`, `rule` y `rule_version` con RLS forzada, grants y `platform.workspace_scoped_table`; tests de RLS, fail-closed (`PF002`) y permisos (TC-RULES-ENGINE-053) Hecho 2026-10-30: migración `20261030100000_rules_schema.sql`.
- [x] 4.2 Migración expand de `txn.transaction_split` y `txn.transaction` (columnas nulas) y migraciones aparte con índices `CONCURRENTLY`; matriz de TC-SECURITY-RLS-007 en verde Hecho 2026-10-30: migraciones `20261030100100`, `20261030100200` y `20261030100300` (índices `CONCURRENTLY`).
- [x] 4.3 `PgRuleRepository` (orden por prioridad, índice parcial, versiones append-only) y adaptador de `RuleSuggestionPort` en la composición de `apps/api` (`pnpm arch:check` sin ciclos) Hecho 2026-10-30.
- [x] 4.4 Secciones `rules` y `rule-versions` y columnas nuevas de Transactions en el export e import del workspace; test de cobertura de tablas (TC-RULES-ENGINE-058) Hecho 2026-10-30: secciones `rules` y `rule-versions` con esquemas de export regenerados.
- [x] 4.5 Config `RULES_*` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`); confirmar que no cambia el presupuesto de conexiones (sin consumidores ni colas nuevas) Hecho 2026-10-30: variables `RULES_*`; sin consumidores ni colas nuevas, el presupuesto de conexiones no cambia (API 22 + worker 34).

## 5. API

- [x] 5.1 Operaciones de design.md § Contratos en `contracts/openapi/finance-api.v1.yaml` (tag Rules, `x-rate-limit: costly` en dry-run y aplicación, `If-Match`, `Idempotency-Key`), campos aditivos de Transactions, códigos `RULE_INVALID_REGEX`, `RULE_LIMIT_EXCEEDED`, `RULE_DRY_RUN_STALE` en `ErrorCode` con mensajes es/en/pt; `pnpm contract:breaking` limpio, Spectral y Redocly sin errores Hecho 2026-10-30.
- [x] 5.2 Tests de API: 405 en `DELETE`, 412, 422, 409, `INSUFFICIENT_ROLE`, cuota costosa, respuestas validadas contra el OpenAPI (TC-RULES-ENGINE-002, -003, -009, -010, -030, -040, -042, -049, -052) Hecho 2026-10-30.

## 6. UI

- [x] 6.1 Pantalla "Reglas" (docs/28): lista ordenable por arrastre con estado, disparadores, estadísticas y "requiere atención"; editor de condiciones y acciones con vista previa en vivo; historial de versiones; i18n es/en/pt Hecho 2026-10-30.
- [x] 6.2 Dry-run con diff por transacción, modo completar o reemplazar, aplicación por páginas de 500 con progreso y manejo de `RULE_DRY_RUN_STALE` Hecho 2026-10-30.
- [x] 6.3 Cobertura (rango o import) con desglose por origen y meta 0.7000; origen por campo en el detalle de la transacción; filtro y acción "pendientes de revisión" en Transacciones; `applyRules` en el formulario (TC-RULES-ENGINE-037, -057) Hecho 2026-10-30.
- [x] 6.4 (Could) "Crear regla desde esta fila o transacción" con la descripción normalizada sin números de referencia (TC-RULES-ENGINE-054) Hecho 2026-10-30.

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-RULES-ENGINE-001..058 (salvo 047) con el TC-ID en el nombre; actualizar front matter Hecho 2026-10-30.
- [x] 7.2 Integración con PostgreSQL real: crear reglas ⇒ evaluar 3 filas ⇒ `recordBatch` con clasificación ⇒ origen y auditoría ⇒ cobertura; dry-run y aplicación con periodo cerrado no aplicable; aislamiento entre workspaces (TC-RULES-ENGINE-029, -031, -044, -053) Hecho 2026-10-30: `pg-rules.int.test.ts` y `rules.api.test.ts`.
- [x] 7.3 Benchmarks nightly (`pnpm perf:bench`): 5 000 filas × 200 reglas ≤ 3 s y peor caso informativo (500 × 20); +≤ 20 ms al p95 del registro manual con 200 reglas (TC-RULES-ENGINE-050, -051); timeouts explícitos en CI Hecho 2026-10-30: `apps/api/test/perf/rules.perf.ts`; 5 000 filas × 200 reglas ≈ 135 ms contra PostgreSQL; Δp95 del registro manual ≈ 3 ms.
- [x] 7.4 E2E (con `PF_E2E_PROJECT`): crear la regla "Supermercado", importar un extracto con la fila de Hipermaxi, ver la regla en la vista previa, aprobar y ver la cobertura; dry-run y aplicación sobre septiembre Hecho 2026-10-30: `tests/e2e/specs/rules.spec.ts` (la parte de import real con la fila de Hipermaxi depende de la vista previa de `add-import-pipeline`, aún en curso).
- [ ] 7.5 **Evidencia del owner (criterio de salida de Phase 6):** importar 3 meses de extractos reales con sus reglas y registrar aquí `ruleCoverage` del rango (sin montos ni descripciones); si es ≥ 0.7000, TC-RULES-ENGINE-047 pasa a `automation_status: manual` con la fecha (TC-RULES-ENGINE-047) _Abierta 2026-10-30: es evidencia del propio owner con datos reales; TC-RULES-ENGINE-047 sigue `not_automated`._

## 8. DOCUMENTATION

- [x] 8.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 05, 08, 10, 11, 13, 24, 28, ARCHITECTURE §7, config-reference, docs/38), runbook "Crear y probar reglas" y la matriz de trazabilidad; `pnpm spec:validate` y `pnpm traceability:check` (0 errores, 0 advertencias) Hecho 2026-10-30.
- [ ] 8.2 Al archivar, reemplazar el `## Purpose` "TBD" de `rules/rule-engine` por un propósito real _Pendiente del archivado (no se archiva mientras 7.5 siga abierta)._
