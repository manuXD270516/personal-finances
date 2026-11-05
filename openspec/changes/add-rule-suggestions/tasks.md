# Tareas

> Phase 7. Requiere el código de `add-rule-engine` (en `main`) y Phase 1–2 (`classification/*`, `transactions/*`, `identity/workspace-portability`). Archivar **después** de `add-rule-engine`, que crea `rules/rule-engine`. Las preguntas 1–3 y 5 de design.md no bloquean el diseño; la 4 decide si Phase 7 suma otro change; la 5 fija el orden de implementación. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `rules/rule-engine` e `identity/workspace-portability` y las preguntas 1–5 de design.md; registrar las respuestas en el doc de decisiones de Phase 7; `openspec validate add-rule-suggestions --strict`
- [ ] 1.2 Revisar TC-RULES-SUGGEST-001..028 contra los scenarios con cifras a mano (4 ÷ 5 = 0.8000; 3 ÷ 4 = 0.7500; 5 ÷ 6 = 0.8333; ventana de 180 días hasta el 2026-11-04 = desde el 2026-05-08; prioridad 100 − 1 = 99); pasar a `ready` y `requirement_status: confirmed` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 VO `DescriptionKey` y `ProposalFingerprint`, test-first, con los vectores de TC-RULES-ENGINE-054 más los nuevos (TC-RULES-SUGGEST-007)
- [ ] 2.2 DS `RuleProposalMiner`, test-first (TC-RULES-SUGGEST-001, -002, -003, -009, -010, -011, -012):
  - agrupación por patrón y `kind`;
  - apoyo y confianza (`Decimal`, HALF_EVEN);
  - empate sin sugerencia;
  - deduplicación descripción ⊆ contraparte;
  - orden y límite de 50.
- [ ] 2.3 Cobertura y conflictos con `RuleEvaluator` en `triggerFilter: 'ANY'` y categoría vacía: cubierto, conflicto, prioridad propuesta y `CANNOT_OUTRANK`. Test-first (TC-RULES-SUGGEST-013, -014)
- [ ] 2.4 PBT (timeout explícito): misma evidencia en cualquier orden ⇒ mismas sugerencias, huellas y orden; ninguna sugerencia con apoyo < 3 o confianza < 0.8000 (TC-RULES-SUGGEST-027)

## 3. APPLICATION

- [ ] 3.1 TRANSACTIONS: `ClassificationSubjectsQuery.listEvidence` (contrato aditivo; filtro de evidencia de la decisión 2; orden descendente; `truncated`) (TC-RULES-SUGGEST-004, -005, -006, -008, -023)
- [ ] 3.2 `RuleProposalsService.list`, sin efectos ni auditoría (TC-RULES-SUGGEST-015, -020):
  - ventana y evidencia;
  - categorías activas con `ClassificationValidator`;
  - reglas activas;
  - miner;
  - estado de cada sugerencia frente a las decisiones (`includeDismissed`).
- [ ] 3.3 Extraer de `RuleDryRunService` la evaluación de un rango con reglas dadas (guardadas o transitorias) sin cambiar el dry-run (TC-RULES-ENGINE-027..030 en verde); `RuleProposalsService.preview` con conteos y ≤ 200 ítems (TC-RULES-SUGGEST-016)
- [ ] 3.4 `RulesService.createRule` con `fromSuggestion`: verificar la huella y escribir la decisión `ACCEPTED` en la misma unidad de trabajo que la regla y su auditoría; `RULE_SUGGESTION_DECIDED` (TC-RULES-SUGGEST-017, -018)
- [ ] 3.5 `dismiss` y `restore` auditados (entidad `RuleSuggestion`) (TC-RULES-SUGGEST-019, -028)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración `rules.rule_suggestion_decision` (RLS forzada y fail-closed, grants, `platform.workspace_scoped_table`), con timestamp posterior a la última de `main`; tests de integración: aislamiento entre workspaces y `PF002` sin contexto (TC-RULES-SUGGEST-022)
- [ ] 4.2 Consulta de `listEvidence` con `EXPLAIN` sobre el seed `large`; índice parcial `CONCURRENTLY` en migración aparte solo si el plan lo justifica (registrar aquí el resultado)
- [ ] 4.3 `PgRuleProposalDecisionRepository`; sección `rule-suggestion-decisions` del export e importación (TC-RULES-SUGGEST-025)
- [ ] 4.4 Configuración `RULES_SUGGEST_*` en `@pf/platform` con validación y documentación (`pnpm config:docs:check`)

## 5. API

- [ ] 5.1 OpenAPI aditivo:
  - `listRuleSuggestions`, `previewRuleSuggestion`, `dismissRuleSuggestion` y `restoreRuleSuggestion`;
  - esquemas nuevos;
  - `fromSuggestion` en `RuleInput` y `Rule`;
  - `RULE_SUGGESTION_DECIDED` en `ErrorCode` con mensajes es/en/pt.

  Verificar los nombres de los esquemas reutilizados. `pnpm contract:breaking`, Spectral y Redocly limpios.
- [ ] 5.2 Rutas en `rules-http.ts`: roles, cuota `costly` en listar y probar, `Idempotency-Key` en descartar. Tests de API: TC-RULES-SUGGEST-015 a -021

## 6. UI

- [ ] 6.1 Pestaña "Sugerencias" en Reglas:
  - tarjetas con patrón, categoría, apoyo, confianza y nivel (texto e icono, no solo color);
  - evidencia y contraejemplos desplegables;
  - conflictos con la prioridad propuesta.

  i18n es/en/pt y formato es-BO.
- [ ] 6.2 "Probar" (vista previa con conteos e ítems), "Aceptar…" (abre el editor de reglas prellenado y envía `fromSuggestion`), "Descartar" y el listado de descartadas con "Restaurar"
- [ ] 6.3 Tras aceptar, ofrecer "Aplicar a transacciones existentes" con `dryRunRules` y `applyRuleDryRun` sobre la regla nueva; `ruleTextFromDescription` alineada con `DescriptionKey` (mismos vectores)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Integración con PostgreSQL real (dos corridas seguidas en verde): evidencia por origen, anuladas, splits múltiples, administradas por Deudas, ventana y truncado; decisión concurrente (dos aceptaciones simultáneas: una 409) (TC-RULES-SUGGEST-004, -005, -006, -008, -018, -023)
- [ ] 7.2 E2E (con `PF_E2E_PROJECT`): clasificar a mano 3 gastos iguales, ver la sugerencia, probarla, aceptarla con otro nombre y aplicar el dry-run a lo existente (TC-RULES-SUGGEST-026)
- [ ] 7.3 Benchmark nightly del listado con 5 000 transacciones de evidencia y 200 reglas: ≤ 3 s (TC-RULES-SUGGEST-024)

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar "Cambios a docs compartidos" de design.md (docs/01, 05, 08, 10, 11, 13, 25, 28, config-reference, 03 §7, 38)
- [ ] 8.2 Matriz de trazabilidad (`pnpm traceability:check` sin errores ni advertencias), `pnpm spec:validate` y `pnpm format:check`
- [ ] 8.3 Archivar después de `add-rule-engine`; verificar el `## Purpose` de `rules/rule-engine`
