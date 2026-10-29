# Tareas

> Phase 6. Requiere Phase 1–2 (`classification/*`, `transactions/bulk-edit`, `identity/workspace-portability`). Las preguntas 1 y 2 de design.md bloquean los grupos 2 y 3. La integración con la vista previa del import y la medición del criterio de salida (7.5) requieren `add-import-pipeline` (design § Dependencias); el resto no. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `rules/rule-engine`, los deltas de `transactions/transaction-recording` e `identity/workspace-portability` y las preguntas 1–7 de design.md; registrar las respuestas en el doc de decisiones de Phase 6; `openspec validate add-rule-engine --strict`
- [ ] 1.2 Revisar TC-RULES-ENGINE-001..058 contra los scenarios (cifras a mano: 148 ÷ 200 = 0.7400; 145 ÷ 198 = 0.7323; 41 ÷ 57 = 0.7193; 185.40 + 60.00 + 300.00 = 545.40 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar
- [ ] 1.3 Verificación cruzada con `add-import-pipeline`: el orden alias → reglas → categoría por defecto, el uso de `RuleEvaluationQuery` y `ImportedClassificationDto` en `RecordImportedTransactions` quedan en su design y tasks; registrar el resultado aquí
- [ ] 1.4 JSON Schema del DSL `contracts/rules/conditions.v1.schema.json` y `contracts/rules/actions.v1.schema.json` (sin propiedades de monto, moneda, cuenta, fecha, tipo ni estado en las acciones) con ejemplos válidos e inválidos

## 2. DOMAIN (TDD)

- [ ] 2.1 `normalizeText` a `@pf/shared-kernel` (`text/normalize`), re-exportado por Classification sin cambio (TC-CLASSIFICATION-* en verde)
- [ ] 2.2 VO `Condition` (matriz operador × tipo, monto con moneda y `Decimal`, fecha, día de la semana y del mes) y `RuleDefinition` (1–20 condiciones, 1–10 acciones, un nivel de grupos) test-first (TC-RULES-ENGINE-002, -004, -005, -006, -007, -008, -009, -012, -017)
- [ ] 2.3 VO `Action` y su aplicabilidad (destino archivado, tipo de categoría, multi-split, modo completar, exclusión solo en importación) test-first (TC-RULES-ENGINE-013, -014, -015, -016, -023, -024)
- [ ] 2.4 `RegexGuard` con motor de tiempo lineal (verificar licencia contra NFR-COMP-003 y registrarla aquí): límites, construcciones prohibidas, peor caso acotado test-first (TC-RULES-ENGINE-010, -011)
- [ ] 2.5 DS `RuleEvaluator` (orden total, primer escritor gana por campo y por etiqueta, `stopProcessing`, omisiones con motivo, origen por campo) test-first; PBT: mismo resultado con cualquier orden de carga y 100 repeticiones (TC-RULES-ENGINE-019, -020, -021, -022)
- [ ] 2.6 AR `Rule` (estados activo, inactivo, archivado; versión de definición vs cambios auditados sin versión; `needsAttention`) test-first (TC-RULES-ENGINE-001, -039, -040, -041, -043)
- [ ] 2.7 TRANSACTIONS: origen de la categoría en `Split` y marca de revisión en `Transaction` (sin efecto en el ledger; el cambio manual pone `MANUAL`) test-first (TC-RULES-ENGINE-018, -055, -056, -057)

## 3. APPLICATION

- [ ] 3.1 `RulesService`: crear, actualizar (versión e `If-Match`), activar, desactivar, archivar, reordenar; validación de referencias con `ClassificationValidator`; límite de 500; auditoría en la misma unidad de trabajo (TC-RULES-ENGINE-001, -003, -042, -043, -049, -052)
- [ ] 3.2 `RuleEvaluationQuery.evaluate` (contrato público; una consulta de reglas y una de ids activos; ≤ 5 000 sujetos; sin efectos) (TC-RULES-ENGINE-013, -031, -053)
- [ ] 3.3 `previewRule` (definición guardada o no, transacción o ejemplo, condiciones con resultado, sin auditoría) (TC-RULES-ENGINE-025, -026)
- [ ] 3.4 `RuleDryRunService` (sujetos por keyset, modos, truncado, token) y `applyRuleDryRun` (≤ 500, recálculo del token parcial, `RULE_DRY_RUN_STALE`) (TC-RULES-ENGINE-027, -028, -029, -030)
- [ ] 3.5 TRANSACTIONS: `RuleSuggestionPort` en `createTransaction` (`applyRules`, solo campos vacíos, solo `INCOME`/`EXPENSE`/`REFUND`) (TC-RULES-ENGINE-034, -035, -036)
- [ ] 3.6 TRANSACTIONS: `recordBatch` con `ImportedClassificationDto` (origen, `ruleRefs`, validación set-based por lote; sin clasificación ⇒ comportamiento de Phase 3) (TC-RULES-ENGINE-032, -033, -055)
- [ ] 3.7 TRANSACTIONS: `RuleClassificationCommand.applyBatch` reutilizando el dominio de la edición masiva; `ClassificationSubjectsQuery`; `ClassificationCoverageQuery` (TC-RULES-ENGINE-029, -044, -045, -046)
- [ ] 3.8 `getRuleCoverage` y estadísticas por regla (nombres, archivadas, sin uso en 90 días) (TC-RULES-ENGINE-044, -046, -048)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: schema `rules`, `rule` y `rule_version` con RLS forzada, grants y `platform.workspace_scoped_table`; tests de RLS, fail-closed (`PF002`) y permisos (TC-RULES-ENGINE-053)
- [ ] 4.2 Migración expand de `txn.transaction_split` y `txn.transaction` (columnas nulas) y migraciones aparte con índices `CONCURRENTLY`; matriz de TC-SECURITY-RLS-007 en verde
- [ ] 4.3 `PgRuleRepository` (orden por prioridad, índice parcial, versiones append-only) y adaptador de `RuleSuggestionPort` en la composición de `apps/api` (`pnpm arch:check` sin ciclos)
- [ ] 4.4 Secciones `rules` y `rule-versions` y columnas nuevas de Transactions en el export e import del workspace; test de cobertura de tablas (TC-RULES-ENGINE-058)
- [ ] 4.5 Config `RULES_*` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`); confirmar que no cambia el presupuesto de conexiones (sin consumidores ni colas nuevas)

## 5. API

- [ ] 5.1 Operaciones de design.md § Contratos en `contracts/openapi/finance-api.v1.yaml` (tag Rules, `x-rate-limit: costly` en dry-run y aplicación, `If-Match`, `Idempotency-Key`), campos aditivos de Transactions, códigos `RULE_INVALID_REGEX`, `RULE_LIMIT_EXCEEDED`, `RULE_DRY_RUN_STALE` en `ErrorCode` con mensajes es/en/pt; `pnpm contract:breaking` limpio, Spectral y Redocly sin errores
- [ ] 5.2 Tests de API: 405 en `DELETE`, 412, 422, 409, `INSUFFICIENT_ROLE`, cuota costosa, respuestas validadas contra el OpenAPI (TC-RULES-ENGINE-002, -003, -009, -010, -030, -040, -042, -049, -052)

## 6. UI

- [ ] 6.1 Pantalla "Reglas" (docs/28): lista ordenable por arrastre con estado, disparadores, estadísticas y "requiere atención"; editor de condiciones y acciones con vista previa en vivo; historial de versiones; i18n es/en/pt
- [ ] 6.2 Dry-run con diff por transacción, modo completar o reemplazar, aplicación por páginas de 500 con progreso y manejo de `RULE_DRY_RUN_STALE`
- [ ] 6.3 Cobertura (rango o import) con desglose por origen y meta 0.7000; origen por campo en el detalle de la transacción; filtro y acción "pendientes de revisión" en Transacciones; `applyRules` en el formulario (TC-RULES-ENGINE-037, -057)
- [ ] 6.4 (Could) "Crear regla desde esta fila o transacción" con la descripción normalizada sin números de referencia (TC-RULES-ENGINE-054)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-RULES-ENGINE-001..058 (salvo 047) con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 Integración con PostgreSQL real: crear reglas ⇒ evaluar 3 filas ⇒ `recordBatch` con clasificación ⇒ origen y auditoría ⇒ cobertura; dry-run y aplicación con periodo cerrado no aplicable; aislamiento entre workspaces (TC-RULES-ENGINE-029, -031, -044, -053)
- [ ] 7.3 Benchmarks nightly (`pnpm perf:bench`): 5 000 filas × 200 reglas ≤ 3 s y peor caso informativo (500 × 20); +≤ 20 ms al p95 del registro manual con 200 reglas (TC-RULES-ENGINE-050, -051); timeouts explícitos en CI
- [ ] 7.4 E2E (con `PF_E2E_PROJECT`): crear la regla "Supermercado", importar un extracto con la fila de Hipermaxi, ver la regla en la vista previa, aprobar y ver la cobertura; dry-run y aplicación sobre septiembre
- [ ] 7.5 **Evidencia del owner (criterio de salida de Phase 6):** importar 3 meses de extractos reales con sus reglas y registrar aquí `ruleCoverage` del rango (sin montos ni descripciones); si es ≥ 0.7000, TC-RULES-ENGINE-047 pasa a `automation_status: manual` con la fecha (TC-RULES-ENGINE-047)

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 05, 08, 10, 11, 13, 24, 28, ARCHITECTURE §7, config-reference, docs/38), runbook "Crear y probar reglas" y la matriz de trazabilidad; `pnpm spec:validate` y `pnpm traceability:check` (0 errores, 0 advertencias)
- [ ] 8.2 Al archivar, reemplazar el `## Purpose` "TBD" de `rules/rule-engine` por un propósito real
