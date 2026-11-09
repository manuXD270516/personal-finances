# Tareas

> Phase 7. Requiere `planning/budgets`, `planning/budget-templates` y `planning/financial-periods` (archivados) y `identity/workspace-portability`. La pregunta 1 de design.md bloquea los grupos 2 a 6. Las preguntas 2 a 5 no bloquean el diseño; la 5 fija el orden dentro de Phase 7. Sin consumidores nuevos (D249).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los deltas de `planning/budgets` e `identity/workspace-portability` y las preguntas 1–5 de design.md; registrar las respuestas en el doc de decisiones de Phase 7; `openspec validate add-historical-budgets --strict` (2026-11-05: respuestas del owner D390–D394 en docs/62; `openspec validate --all --strict` en verde)
- [x] 1.2 Revisar TC-PLANNING-HISTBUDGET-001..031 contra los scenarios con cifras a mano: (2026-11-05: cifras verificadas por los tests de dominio y de API; los 31 TC pasan a `automated` y `requirement_status: confirmed`)
  - 5980.00 ÷ 4 = 1495.00;
  - Q1 1420.00, Q3 1610.00, valla superior 1895.00 y 7400.00 ÷ 5 = 1480.00;
  - 6804.50 ÷ 3 = 2268.17;
  - 11350.00 ÷ 6 = 1891.67;
  - 1000.15 × 1.10 = 1100.165 → 1100.16;
  - 125.00 ÷ 50 = 2.5 → 100.00.

  Pasar a `ready` y `requirement_status: confirmed` al aprobar.

## 2. DOMAIN (TDD)

- [x] 2.1 VO `SuggestionWindow` sobre `PeriodCalendar`: últimos N terminados antes de hoy y del objetivo, `IN_PROGRESS`, `BEFORE_FIRST_ACTIVITY` e `INCOMPLETE` por la primera actividad, y periodo del año anterior. Test-first (TC-PLANNING-HISTBUDGET-003, -005, -007, -013) (2026-11-05: `domain/suggestion-window.ts`)
- [x] 2.2 DS `HistoricalBudgetEstimator` (puro, `Decimal`), test-first (TC-PLANNING-HISTBUDGET-001, -002, -004, -006, -008, -009, -010, -011, -012, -014, -015): (2026-11-05: `domain/historical-budget-estimator.ts`)
  - cero como valor y `NO_RATE` por línea;
  - mínimo ⌈N/2⌉;
  - Tukey con cuartiles por medianas de las mitades y n ≥ 4;
  - exclusión e inclusión manual;
  - promedio → ajuste → escala → múltiplo con HALF_EVEN; mediana informada.
- [x] 2.3 PBT del estimador (TC-PLANNING-HISTBUDGET-031, timeout explícito): (2026-11-05: PBT con 200 corridas y timeout de 60 s)
  - permutar los periodos no cambia el resultado;
  - la sugerencia sin ajuste está entre el mínimo y el máximo de los usados;
  - un valor atípico nunca es el único usado.
- [x] 2.4 VO `HistoryBasis` (`schemaVersion 1`, montos como texto decimal) y `BudgetLine` que la conserva al editar y no la copia al clonar ni al propagar. Test-first (TC-PLANNING-HISTBUDGET-024, -025) (2026-11-05: `domain/history-basis.ts`; `BudgetLine.withHistoryBasis`; el clonado no la copia)

## 3. APPLICATION

- [x] 3.1 Extraer de `BudgetCalculator` la función `lineActual` (objetivo → flujos → consolidado con `FlowValuation`) sin cambio de comportamiento; los TC de `add-budgets` (TC-PLANNING-ACTUAL-*, TC-PLANNING-BUDGET-*) siguen en verde (2026-11-05: `lineActual` en `budget-calculator.ts`; los TC de add-budgets siguen en verde)
- [x] 3.2 `HistoricalActualsLoader`: una sola consulta `summarizeNominalFlows` para toda la ventana (y el año anterior) y un solo lote de tasas; real por periodo y línea (TC-PLANNING-HISTBUDGET-005, -006) (2026-11-05: `HistoricalActualsLoader`)
- [x] 3.3 `BudgetSuggestionService.preview`, sin efectos (TC-PLANNING-HISTBUDGET-016, -017, -018, -019): (2026-11-05: `BudgetSuggestionService.preview`)
  - líneas del plan o descubrimiento de categorías raíz sin plan;
  - `extraTargets` con validación de solapamiento;
  - `NOT_APPLICABLE` para porcentaje de ingresos;
  - token SHA-256.
- [x] 3.4 `BudgetSuggestionService.confirm` en una unidad de trabajo (TC-PLANNING-HISTBUDGET-020, -021, -022, -027, -028): (2026-11-05: `BudgetSuggestionService.confirm`. El token cubre toda la vista previa; se recalculan todas las líneas (misma consulta única) y se compara el token completo además del sugerido de cada línea elegida)
  - bloqueo del plan, recálculo de las elegidas y `BUDGET_SUGGESTION_STALE`;
  - creación del plan `EMPTY` si falta;
  - validaciones de línea existentes y `overridden` en líneas de template;
  - `history_basis`, auditoría con `operationId` común y reevaluación de umbrales.
- [x] 3.5 Verificar que la creación automática de periodos y planes, el template predeterminado, el clonado, la propagación y el rollover no llaman al servicio (TC-PLANNING-HISTBUDGET-023, -024, -025) (2026-11-05: ningún camino de creación de periodos o planes importa el servicio; verificado por los tests de plantilla predeterminada, clonado y edición posterior)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand `planning.budget_line.history_basis jsonb NULL` con CHECK `NOT VALID` + `VALIDATE`, con timestamp posterior a la última de `main`; test de migración e integración (RLS sin cambios, aislamiento entre workspaces: TC-PLANNING-HISTBUDGET-026) (2026-11-05: `20261105100000_planning_budget_line_history_basis.sql`; RLS sin cambios)
- [x] 4.2 `PgBudgetRepository` lee y escribe `history_basis`; export e importación del workspace con la base (TC-PLANNING-HISTBUDGET-030) (2026-11-05: `PgBudgetRepository`; el export genérico incluye la columna y el import remapea los ids de periodo del jsonb; esquema `contracts/export/v1/budget-lines.schema.json` regenerado)
- [x] 4.3 Configuración `PLANNING_HISTORY_*` en `@pf/platform` con validación y documentación (`pnpm config:docs:check`) (2026-11-05: cinco variables `PLANNING_HISTORY_*`; `config:docs:check` en verde)

## 5. API

- [x] 5.1 OpenAPI aditivo: `previewBudgetSuggestions`, `confirmBudgetSuggestions`, esquemas nuevos, `historyBasis` en `BudgetLine` y `BUDGET_SUGGESTION_STALE` en `ErrorCode` con mensajes es/en/pt. Verificar los nombres de los esquemas reutilizados; `pnpm contract:breaking`, Spectral y Redocly limpios (2026-11-05: oasdiff sin cambios incompatibles, Redocly y Spectral sin errores; el esquema de línea reutilizado es `BudgetLineTarget`)
- [x] 5.2 Controller `budget-suggestions` con roles (`x-required-role`), `Idempotency-Key` en la confirmación y errores del contrato. Tests de API: TC-PLANNING-HISTBUDGET-016, -019, -020, -021, -022, -026, -027, -028 (2026-11-05: `interface/budget-suggestions-http.ts`; tests de API contra PostgreSQL real)

## 6. UI

- [x] 6.1 Pantalla "Sugerir desde el historial" en el plan del periodo: (2026-11-05: `SuggestionsPanel.tsx`, namespace `Suggestions` es/en/pt)
  - método, N, ajuste y redondeo;
  - tabla con monto vigente, sugerido, diferencia y estado;
  - selección por línea y monto editable;
  - confirmación con resumen de lo que cambia.

  i18n es/en/pt, formato es-BO y estado no solo por color.
- [x] 6.2 Explicación desplegable por línea armada desde códigos (periodos, estados, promedio, mediana, ajuste y redondeo); excluir o reincluir periodos desde la explicación (TC-PLANNING-HISTBUDGET-010, -011, -016) (2026-11-05)
- [x] 6.3 Indicador "sugerido desde el historial" en la línea del plan, con "modificado después" cuando el vigente difiere del aplicado; aviso de `BUDGET_SUGGESTION_STALE` con "volver a calcular" (2026-11-05)

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Integración con PostgreSQL real (dos corridas seguidas en verde): ventana, primera actividad, tasas faltantes, confirmación atómica y token obsoleto con un gasto concurrente (TC-PLANNING-HISTBUDGET-005, -006, -020, -022) (2026-11-05: `budget-suggestions.api.test.ts` y `budget-suggestions-portability.api.test.ts` contra PostgreSQL real; `pnpm test:integration` completo en verde dos veces seguidas, 86 archivos y 849 tests; una corrida anterior falló por tiempos de espera con otros stacks de Docker activos y pasó en aislamiento)
- [x] 7.2 E2E (con `PF_E2E_PROJECT`): pedir sugerencias, excluir un periodo, editar un monto, confirmar dos de tres líneas y ver el indicador y el historial (TC-PLANNING-HISTBUDGET-020, -028) (2026-11-05: `tests/e2e/specs/budget-suggestions.spec.ts` con axe y viewport móvil, `PF_E2E_PROJECT=pfos-e2e-histbudget`; en verde junto con `budgets` y `templates`)
- [x] 7.3 Benchmark nightly `budget-suggestions.perf.ts` con N = 12 y 60 líneas sobre el seed `large`: p95 ≤ 800 ms (TC-PLANNING-HISTBUDGET-029) (2026-11-05: `apps/api/test/perf/budget-suggestions.perf.ts`, agregado a `PERF_SUITE_ORDER`; verificado a escala 0,05 del Large Seed con p95 dentro de 800 ms; la medición a escala 1 corre en el nightly)

## 8. DOCUMENTATION

- [x] 8.1 Aplicar "Cambios a docs compartidos" de design.md (docs/01, 08, 10, 11, 14, 25, 28, config-reference, 03 §7, 38) (2026-11-05: docs/01, 08, 10, 11, 14, 25, 28, config-reference, 38; la fila de 03 §7 ya existía)
- [x] 8.2 Matriz de trazabilidad (`pnpm traceability:check` sin errores ni advertencias), `pnpm spec:validate` y `pnpm format:check` (2026-11-05: traceability, spec:validate y format:check en verde)
- [x] 8.3 Al archivar, verificar que `planning/budgets` e `identity/workspace-portability` conservan su `## Purpose` *(2026-11-09: verificado al archivar)*
