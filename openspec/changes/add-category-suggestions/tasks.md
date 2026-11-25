# Tareas

> Change 73 (Phase 9, docs/03 §7, D472). Requiere `add-rule-engine` (55), `add-import-pipeline` (54) y `add-rule-suggestions` (62) fusionados; se archiva después de ellos (su capability `classification/auto-classification` es nueva, pero lee la evidencia y la `DescriptionKey` de 62). Decisiones D476 y D477 ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)); ninguna pregunta abierta lo bloquea. Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `classification/auto-classification` y `classification/counterparties` contra D476 y D477; `openspec validate add-category-suggestions --strict`
- [ ] 1.2 Revisar TC-CLASSIFICATION-AUTO-001..026 contra los scenarios. Cifras: 9 / 10 = 0.9000; 7 / 10 = 0.7000; 6 / 9 = 0.6667; 4 / 5 = 0.8000; 264 / 300 = 0.8800 y 300 / 400 = 0.7500; 15 / 20 = 0.7500. Pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `CategorySuggester` puro test-first (patrones por contraparte y por `descriptionKey`, conteo por categoría activa compatible, apoyo y confianza con 4 decimales HALF_EVEN, ganador estricto, combinación y desempate, niveles), con PBT y timeout explícito: la confianza está entre 0 y 1 y no cambia al permutar la evidencia: TC-CLASSIFICATION-AUTO-001..004, -007 y -008
- [ ] 2.2 Plantilla del motivo (es/en/pt) con la clave normalizada: TC-CLASSIFICATION-AUTO-017
- [ ] 2.3 Cálculo de precisión y cobertura del backtesting y validación de al menos 3 meses: TC-CLASSIFICATION-AUTO-019 y -020

## 3. APPLICATION

- [ ] 3.1 RULES: `CategorySuggestionService.query` con la evidencia de `listEvidence` (ventana y máximo configurables), caché por workspace con TTL y tope LRU, y evaluación previa de las reglas `MANUAL_CREATE` sobre el borrador (`RULE_APPLIES`): TC-CLASSIFICATION-AUTO-005, -006, -009 y -023
- [ ] 3.2 RULES: `CategorySuggestionQuery.suggestMany` en `@pf/rules/contracts` (un índice por llamada) y `CategorySuggestionFeedbackPort.recordBatch`: TC-CLASSIFICATION-AUTO-010 y -011
- [ ] 3.3 IMPORTS: sugerencias en la etapa de clasificación para las filas sin categoría después de las reglas y del default de la contraparte; recálculo en `reevaluate-rules`; falla sin bloquear: TC-CLASSIFICATION-AUTO-010 y -016
- [ ] 3.4 IMPORTS: aceptación en lote por nivel con `If-Match` (una versión nueva, origen manual) y `acceptedSuggestion` en la decisión por fila; registro de resultados al aprobar: TC-CLASSIFICATION-AUTO-011, -014 y -015
- [ ] 3.5 RULES: registro de resultados del alta manual e informe de la tasa (por canal y nivel, 4 decimales HALF_EVEN): TC-CLASSIFICATION-AUTO-012 y -018
- [ ] 3.6 CLASSIFICATION/web: la sugerencia por historial reemplaza a la última usada de la contraparte cuando existe: TC-CLASSIFICATION-AUTO-025
- [ ] 3.7 Habilitación por instalación (`DISABLED` en la consulta y sin sugerencias en la vista previa): TC-CLASSIFICATION-AUTO-022

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: `rules.category_suggestion_outcome` (RLS forzada, D298, registro en `platform.workspace_scoped_table`) y las columnas `suggested_category` y `suggestion_accepted` del staging de filas del import; timestamp posterior a la última de `main`: TC-CLASSIFICATION-AUTO-023
- [ ] 4.2 Tests de integración con PostgreSQL real (Testcontainers): evidencia sin las clasificaciones de reglas, aislamiento, import con sugerencias, aprobación sin aceptar: TC-CLASSIFICATION-AUTO-005, -010, -011 y -023
- [ ] 4.3 Variables `RULES_CATEGORY_SUGGEST_*` en `variables.ts`, la plantilla del host y `docs/config-reference.md` (`pnpm config:docs:check`)
- [ ] 4.4 Métricas `rules_category_suggestion_*` (consultas, sugeridas por nivel, evidencia truncada, fallas en la etapa del import), sin descripciones ni montos
- [ ] 4.5 `pnpm arch:check`: IMPORTS → RULES solo por contratos; sin ciclos; el arranque del worker mantiene consumidores y conexiones (TC-PLATFORM-THROUGHPUT-009)

## 5. API

- [ ] 5.1 Endpoints `queryCategorySuggestion`, `recordCategorySuggestionOutcome`, `getCategorySuggestionStats` y `acceptImportCategorySuggestions`; `ImportPreviewRow.suggestedCategory` e `ImportRowDecisionRequest.acceptedSuggestion` (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores): TC-CLASSIFICATION-AUTO-009, -014, -015, -018, -021, -022 y -024
- [ ] 5.2 Runner `pnpm rules:category-suggestions:backtest -- --workspace <id> --months <n>` y fila bloqueante del nightly con el Large Seed (últimos 3 meses de su ventana, precisión ≥ 0.8500, informe sin descripciones ni montos): TC-CLASSIFICATION-AUTO-019
- [ ] 5.3 Medir la fila del nightly con el Large Seed. Si no alcanza 0.8500 por cómo el seed genera las categorías y no por el algoritmo, registrar la medición, dejar la fila como informativa y preguntar al owner antes de cambiar el umbral (D477)
- [ ] 5.4 Benchmarks: import de 5000 filas hasta la vista previa ≤ 30 s con las sugerencias, y la consulta del alta manual ≤ 150 ms p95 con caché y ≤ 400 ms p95 sin caché: TC-CLASSIFICATION-AUTO-026

## 6. UI

- [ ] 6.1 Formulario de alta: chip de sugerencia con nivel y motivo (consulta `POST` con *debounce*), Aceptar y Otra; aviso «una regla clasificará este gasto»; registro del resultado al guardar; i18n es/en/pt: TC-CLASSIFICATION-AUTO-012 y -013
- [ ] 6.2 Vista previa del import: columna de sugerencia con aceptación por fila, «Aceptar sugerencias de confianza alta» (y la variante con media), filtro «con sugerencia»: TC-CLASSIFICATION-AUTO-014
- [ ] 6.3 Vista de reglas: tarjeta con la tasa de aceptación del mes: TC-CLASSIFICATION-AUTO-018

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter
- [ ] 7.2 E2E con el dataset Demo: sugerencia en el alta manual aceptada y una importación con aceptación en lote de las sugerencias altas, sin violaciones serias de axe: TC-CLASSIFICATION-AUTO-012 a -014
- [ ] 7.3 Regresión: TC-RULES-ENGINE-*, TC-RULES-SUGGEST-*, TC-IMPORTS-PIPELINE-* y TC-CLASSIFICATION-SUGGESTION-001 en verde sin cambios
- [ ] 7.4 Criterio de salida con datos reales (espera al owner, D472 y D477): backtesting con su historia (precisión ≥ 0.8500 en 3 meses) y tasa de aceptación de un mes de uso, registradas sin descripciones ni montos

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
