# Tareas

> Phase 7. Requiere el código de `add-rule-engine` (en `main`) y Phase 1–2 (`classification/*`, `transactions/*`, `identity/workspace-portability`). Archivar **después** de `add-rule-engine`, que crea `rules/rule-engine`. Las preguntas 1–3 y 5 de design.md no bloquean el diseño; la 4 decide si Phase 7 suma otro change; la 5 fija el orden de implementación. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los deltas de `rules/rule-engine` e `identity/workspace-portability` y las preguntas 1–5 de design.md; registrar las respuestas en el doc de decisiones de Phase 7; `openspec validate add-rule-suggestions --strict`
  > 2026-11-05: el owner respondió las preguntas 1–5 en docs/62 (D395–D399, todas = recomendación); `openspec validate add-rule-suggestions --strict` en verde.
- [x] 1.2 Revisar TC-RULES-SUGGEST-001..028 contra los scenarios con cifras a mano (4 ÷ 5 = 0.8000; 3 ÷ 4 = 0.7500; 5 ÷ 6 = 0.8333; ventana de 180 días hasta el 2026-11-04 = desde el 2026-05-08; prioridad 100 − 1 = 99); pasar a `ready` y `requirement_status: confirmed` al aprobar
  > 2026-11-05: cifras a mano verificadas en los tests (4 ÷ 5 = 0.8000, 3 ÷ 4 = 0.7500, 5 ÷ 6 = 0.8333, ventana de 180 días hasta el 2026-11-04 = desde el 2026-05-08, prioridad 100 − 1 = 99); los 28 TC pasan a `requirement_status: confirmed` y `automated` (el 026 con el E2E, el 024 con el benchmark `rules.perf.ts`). Las prioridades de los requirements que eran Could pasan a Should por D399.

## 2. DOMAIN (TDD)

- [x] 2.1 VO `DescriptionKey` y `ProposalFingerprint`, test-first, con los vectores de TC-RULES-ENGINE-054 más los nuevos (TC-RULES-SUGGEST-007)
  > 2026-11-05: `descriptionKey` (vectores de TC-RULES-ENGINE-054 más los nuevos) y `proposalFingerprint` en `domain/rule-proposal.ts`. El SHA-256 es puro (`domain/sha256.ts`, verificado contra `node:crypto` en `infrastructure/sha256.test.ts`) porque `domain-only-shared-kernel` impide importar `node:crypto` en el dominio.
- [x] 2.2 DS `RuleProposalMiner`, test-first (TC-RULES-SUGGEST-001, -002, -003, -009, -010, -011, -012):
  - agrupación por patrón y `kind`;
  - apoyo y confianza (`Decimal`, HALF_EVEN);
  - empate sin sugerencia;
  - deduplicación descripción ⊆ contraparte;
  - orden y límite de 50.
  > 2026-11-05: `mineProposals` (agrupación por `(tipo, valor, kind)`, confianza con `MoneyDecimal` HALF_EVEN, empate sin sugerencia, deduplicación descripción ⊆ contraparte, orden y límite) en `domain/rule-proposal.test.ts`.
- [x] 2.3 Cobertura y conflictos con `RuleEvaluator` en `triggerFilter: 'ANY'` y categoría vacía: cubierto, conflicto, prioridad propuesta y `CANNOT_OUTRANK`. Test-first (TC-RULES-SUGGEST-013, -014)
  > 2026-11-05: `assessCoverage` y `proposedPriority` (cubierto, conflicto, prioridad propuesta y `CANNOT_OUTRANK`) y `CompiledRuleSet.compile(…, { triggerFilter: 'ANY' })` (los demás llamadores no cambian: TC-RULES-ENGINE-001..054 en verde).
- [x] 2.4 PBT (timeout explícito): misma evidencia en cualquier orden ⇒ mismas sugerencias, huellas y orden; ninguna sugerencia con apoyo < 3 o confianza < 0.8000 (TC-RULES-SUGGEST-027)
  > 2026-11-05: PBT con timeout explícito: mismo resultado en cualquier orden de la evidencia, ninguna sugerencia con apoyo < 3 o confianza < 0.8000 y confianza igual a la aritmética entera HALF_EVEN.

## 3. APPLICATION

- [x] 3.1 TRANSACTIONS: `ClassificationSubjectsQuery.listEvidence` (contrato aditivo; filtro de evidencia de la decisión 2; orden descendente; `truncated`) (TC-RULES-SUGGEST-004, -005, -006, -008, -023)
  > 2026-11-05: `ClassificationSubjectsQuery.listEvidence` (aditivo; el filtro va en SQL; hydrate reutilizado para etiquetas y campos). Cubierto por `rule-suggestions.api.test.ts` contra PostgreSQL real.
- [x] 3.2 `RuleProposalsService.list`, sin efectos ni auditoría (TC-RULES-SUGGEST-015, -020):
  - ventana y evidencia;
  - categorías activas con `ClassificationValidator`;
  - reglas activas;
  - miner;
  - estado de cada sugerencia frente a las decisiones (`includeDismissed`).
  > 2026-11-05: `RuleProposalsService.list` en `application/rule-proposals.service.ts`: una consulta de evidencia, un lote al catálogo para las categorías activas, una consulta de reglas y la evaluación en memoria. Sin efectos ni auditoría.
- [x] 3.3 Extraer de `RuleDryRunService` la evaluación de un rango con reglas dadas (guardadas o transitorias) sin cambiar el dry-run (TC-RULES-ENGINE-027..030 en verde); `RuleProposalsService.preview` con conteos y ≤ 200 ítems (TC-RULES-SUGGEST-016)
  > 2026-11-05: no hizo falta extraer nada de `RuleDryRunService`: la vista previa compila una regla transitoria sin caché (`CompiledRuleSet.compile`) —el caché por `(id, versión)` de `RulesQueries` se contaminaría— y reutiliza `toSubject` (ahora exportada) y los mismos motivos de no aplicable. El dry-run no cambió (TC-RULES-ENGINE-027..030 en verde).
- [x] 3.4 `RulesService.createRule` con `fromSuggestion`: verificar la huella y escribir la decisión `ACCEPTED` en la misma unidad de trabajo que la regla y su auditoría; `RULE_SUGGESTION_DECIDED` (TC-RULES-SUGGEST-017, -018)
  > 2026-11-05: `RulesService.createRule` con `fromSuggestion`: recalcula la huella (`VALIDATION_FAILED` si no coincide) y RECLAMA la decisión antes de crear la regla, de modo que la segunda aceptación, también la simultánea, responde `RULE_SUGGESTION_DECIDED` y no `NAME_TAKEN`; todo en la misma unidad de trabajo (si algo falla después, la transacción revierte la decisión). Por eso la FK de la decisión a la regla es `DEFERRABLE INITIALLY DEFERRED`.
- [x] 3.5 `dismiss` y `restore` auditados (entidad `RuleSuggestion`) (TC-RULES-SUGGEST-019, -028)
  > 2026-11-05: `dismiss` y `restore` auditados con la entidad `RuleSuggestion` (aggregateId derivado de la huella; allow-list `RULES_AUDIT_POLICY.RuleSuggestion`).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración `rules.rule_suggestion_decision` (RLS forzada y fail-closed, grants, `platform.workspace_scoped_table`), con timestamp posterior a la última de `main`; tests de integración: aislamiento entre workspaces y `PF002` sin contexto (TC-RULES-SUGGEST-022)
  > 2026-11-05: migración `20261106120000_rules_suggestion_decision.sql` (RLS forzada y fail-closed, `pf_app` SELECT/INSERT/DELETE, registro con orden 193). Cambio respecto del diseño: la columna `total` se llama `evidence_count` (la regla ESLint `pf/no-number-money` y la Spectral `pfos-money-via-schema` reservan `total` para montos). Integración en `pg-rules.int.test.ts` (aislamiento, `PF002`, clave primaria concurrente, CHECK, permisos).
- [x] 4.2 Consulta de `listEvidence` con `EXPLAIN` sobre el seed `large`; índice parcial `CONCURRENTLY` en migración aparte solo si el plan lo justifica (registrar aquí el resultado)
  > 2026-11-05: `EXPLAIN (ANALYZE, BUFFERS)` de `listEvidence` con 300 000 transacciones (3 años; ventana de 180 días; 29 043 de evidencia): 331 ms de ejecución, 885 296 buffers en caché; el planificador recorre los splits por categoría (`transaction_split_category_idx`) y busca cada transacción por clave primaria. El índice parcial propuesto no cambia el costo dominante (176 163 búsquedas por clave primaria) y el volumen del owner es de cientos o miles: **no se crea el índice** (sin migración `CONCURRENTLY`). Se revisa si la evidencia real crece órdenes de magnitud. Medido como superusuario sobre una base de pruebas, no sobre el Large Seed.
- [x] 4.3 `PgRuleProposalDecisionRepository`; sección `rule-suggestion-decisions` del export e importación (TC-RULES-SUGGEST-025)
  > 2026-11-05: `PgRuleProposalDecisionRepository`; sección `rule-suggestion-decisions` (orden 362, esquema JSON generado) con el gancho `rules.suggestion-fingerprint`, que recalcula la huella tras remapear categoría y contraparte (`textRefs: ['pattern_value']`). TC-RULES-SUGGEST-025 en `rules-portability.api.test.ts`.
- [x] 4.4 Configuración `RULES_SUGGEST_*` en `@pf/platform` con validación y documentación (`pnpm config:docs:check`)
  > 2026-11-05: variables `RULES_SUGGEST_*` (8) en `@pf/platform` con validación y `docs/config-reference.md` regenerado (`config:docs:check` en verde).

## 5. API

- [x] 5.1 OpenAPI aditivo:
  - `listRuleSuggestions`, `previewRuleSuggestion`, `dismissRuleSuggestion` y `restoreRuleSuggestion`;
  - esquemas nuevos;
  - `fromSuggestion` en `RuleInput` y `Rule`;
  - `RULE_SUGGESTION_DECIDED` en `ErrorCode` con mensajes es/en/pt.

  Verificar los nombres de los esquemas reutilizados. `pnpm contract:breaking`, Spectral y Redocly limpios.
  > 2026-11-05: OpenAPI aditivo con los esquemas reutilizados verificados contra el YAML (`CategoryOrigin`, `Money`, `LocalDate`, `Instant`, `Uuid`, `RuleSkipReason`). Cambios respecto del diseño: `total` → `evidenceCount` en `RuleSuggestion`; la `definition` de la vista previa se declara completa (misma forma que `RulePreviewInput.definition`); parámetro `RuleSuggestionId` con patrón de 64 hexadecimales.
- [x] 5.2 Rutas en `rules-http.ts`: roles, cuota `costly` en listar y probar, `Idempotency-Key` en descartar. Tests de API: TC-RULES-SUGGEST-015 a -021
  > 2026-11-05: rutas literales antes de `:ruleId` en `rules-http.ts`; roles (VIEWER para listar y probar, EDITOR para descartar y restaurar; `createRule` ya era EDITOR), cuota `costly` e `Idempotency-Key` en descartar vía el contrato. `rule-suggestions.api.test.ts` cubre TC-015 a -023 y -028.

## 6. UI

- [x] 6.1 Pestaña "Sugerencias" en Reglas:
  - tarjetas con patrón, categoría, apoyo, confianza y nivel (texto e icono, no solo color);
  - evidencia y contraejemplos desplegables;
  - conflictos con la prioridad propuesta.

  i18n es/en/pt y formato es-BO.
  > 2026-11-05: pestaña «Sugerencias» (`Suggestions.tsx`) con tarjetas, evidencia y contraejemplos desplegables, conflictos con la prioridad propuesta; es/en/pt.
- [x] 6.2 "Probar" (vista previa con conteos e ítems), "Aceptar…" (abre el editor de reglas prellenado y envía `fromSuggestion`), "Descartar" y el listado de descartadas con "Restaurar"
  > 2026-11-05: «Probar» (`SuggestionPreviewView`), «Aceptar…» (editor prellenado por URL; envía `fromSuggestion`), «Descartar» y «Restaurar» en el listado de descartadas.
- [x] 6.3 Tras aceptar, ofrecer "Aplicar a transacciones existentes" con `dryRunRules` y `applyRuleDryRun` sobre la regla nueva; `ruleTextFromDescription` alineada con `DescriptionKey` (mismos vectores)
  > 2026-11-05: tras guardar, `/reglas?apply=<ruleId>` abre «Ejecutar sobre el historial» solo con esa regla (`ruleIds` en `dryRunRules` y `applyRuleDryRun`, ventana de 180 días); `ruleTextFromDescription` alineada con `DescriptionKey` (mismos vectores en `logic.test.ts`).

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Integración con PostgreSQL real (dos corridas seguidas en verde): evidencia por origen, anuladas, splits múltiples, administradas por Deudas, ventana y truncado; decisión concurrente (dos aceptaciones simultáneas: una 409) (TC-RULES-SUGGEST-004, -005, -006, -008, -018, -023)
  > 2026-11-05: `rule-suggestions.api.test.ts` (evidencia por origen, correcciones de reglas, origen desconocido por `source`, splits múltiples y deudas, ventana, truncado con `RULES_SUGGEST_MAX_EVIDENCE=5`, aceptación simultánea: una 201 y una 409) y `pg-rules.int.test.ts`. `pnpm test:integration` completo (todos los paquetes) en verde dos veces seguidas el 2026-11-05 (salida 0 en ambas).
- [x] 7.2 E2E (con `PF_E2E_PROJECT`): clasificar a mano 3 gastos iguales, ver la sugerencia, probarla, aceptarla con otro nombre y aplicar el dry-run a lo existente (TC-RULES-SUGGEST-026)
  > 2026-11-05: `tests/e2e/specs/rule-suggestions.spec.ts` (TC-RULES-SUGGEST-026) con `PF_E2E_PROJECT=pfos-e2e-rulesug`, axe sin violaciones serias y sin desborde a 360 px.
- [x] 7.3 Benchmark nightly del listado con 5 000 transacciones de evidencia y 200 reglas: ≤ 3 s (TC-RULES-SUGGEST-024)
  > 2026-11-05: benchmark en `apps/api/test/perf/rules.perf.ts` (5 000 transacciones de evidencia sembradas por SQL y 200 reglas de 5 condiciones; mediana de 5 corridas ≤ 3 s). Medición local (2026-11-05): mediana de 5 corridas 166 ms (lectura de la evidencia 129 ms), muy por debajo de 3 s. Sin `ANALYZE` tras el sembrado masivo el plan era malo (≈ 6 s): el benchmark analiza las tablas como lo hace el autovacuum en una base en uso. El job `nightly` no se lanzó.

## 8. DOCUMENTATION

- [x] 8.1 Aplicar "Cambios a docs compartidos" de design.md (docs/01, 05, 08, 10, 11, 13, 25, 28, config-reference, 03 §7, 38)
  > 2026-11-05: docs/01 (FR-RULES-011 as-built y a Should, nota de FR-RULES-005 por D398), 05, 08, 10, 11, 13, 25 (US-232), 28, `config-reference.md` y 38; docs/03 §7 ya tenía la fila del change.
- [x] 8.2 Matriz de trazabilidad (`pnpm traceability:check` sin errores ni advertencias), `pnpm spec:validate` y `pnpm format:check`
  > 2026-11-05: `pnpm traceability:check` sin errores (las 10 advertencias son de otros changes: TC-IMPORTS-STMT, TC-PLANNING-EXIT y TC-FX-PROVIDER), `pnpm spec:validate` (64 de 64), `pnpm format:check`, `pnpm arch:check`, `pnpm config:docs:check` y `pnpm contract:breaking` (oasdiff limpio; Redocly válido; Spectral sin errores) en verde.
- [ ] 8.3 Archivar después de `add-rule-engine`; verificar el `## Purpose` de `rules/rule-engine`
  > 2026-11-05: **pendiente por dependencia, no por trabajo**: `rules/rule-engine` la crea `add-rule-engine`, que sigue sin archivar (falta la 7.5, evidencia del owner del criterio de salida de Phase 6). Este change se archiva después, con `pnpm exec openspec archive add-rule-suggestions --yes`, y se verifica entonces el `## Purpose` de la capability.
