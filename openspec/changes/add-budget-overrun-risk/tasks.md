# Tareas

> Change 74 (Phase 9, docs/03 §7, D472). Requiere `add-ml-forecasting-service` (64), `add-expense-forecasts` (65) y `add-predicted-cash-flow-band` (66) fusionados por la lectura del pronóstico; su capability `reporting/predictive-insights` es nueva y no depende del archivado de otros changes. Si se implementa antes que `add-spending-anomaly-detection` (72), introduce él el valor por omisión por tipo de notificación (decisión 8 del design). D478 y D471 son recomendaciones aplicadas por omisión ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)); el owner puede revertirlas antes del grupo 3. Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas de `reporting/predictive-insights`, `reporting/dashboard` y `notifications/alerts` contra D478; `openspec validate add-budget-overrun-risk --strict` Nota 2026-11-26: revisado contra D478, D484 y D485; `openspec validate --strict` en verde.
- [x] 1.2 Revisar TC-REPORTING-INSIGHT-001..019 y TC-NOTIFICATIONS-BUDGETRISK-001..005 contra los scenarios. Cifras:
  - 280.00 + 280.00 / 10 × 20 = 840.00; 400.00 + 800.00 = 1200.00; 560.00 + 1120.00 = 1680.00.
  - 100.00 + 300.00 + 200.00 = 600.00; 300.00 + 50.00 / 10 × 20 = 400.00.
  - 1400.00 y 1620.00 con la banda; 280.00 + 28.00 × 12 = 616.00 frente a 588.00.
  - 500.00 el 2026-11-20 y 510.00 el 2026-11-21.

  Pasar a `ready` y `requirement_status: confirmed`. Nota 2026-11-26: las cifras coinciden con los scenarios; TC en `automated` y `requirement_status: confirmed`.

## 2. DOMAIN (TDD)

- [x] 2.1 `BudgetOverrunProjector` puro test-first: proyección por ritmo y por pronóstico, gastado variable sin lo resuelto por ocurrencias, niveles `EXCEEDED`, `LIKELY`, `POSSIBLE`, `UNLIKELY` y `NOT_AVAILABLE` con motivos, y `TOO_EARLY` salvo que G + ΣK > R: TC-REPORTING-INSIGHT-001..006 y -009..011 Nota 2026-11-26: `BudgetOverrunProjector` en `packages/contexts/reporting/src/domain`. Con menos de 7 días y lo conocido ya sobre la referencia, el restante variable se toma en cero (solo lo conocido, sin extrapolar un ritmo ruidoso).
- [x] 2.2 Fecha estimada con los vencimientos de los pagos conocidos y el reparto diario con Decimal: TC-REPORTING-INSIGHT-007 y -008. PBT con timeout explícito: la proyección esperada nunca es mayor que la alta, y la fecha estimada cae dentro del periodo o no existe Nota 2026-11-26: PBT con timeout de 60 s; el reparto por día es exacto (Decimal, sin redondear).
- [x] 2.3 Plantillas de texto (es/en/pt) sin certeza: TC-REPORTING-INSIGHT-013 Nota 2026-11-26: las plantillas de la UI viven en el namespace `BudgetRisk` de `apps/web/messages` y las de la notificación en `@pf/notifications`; ambas en es/en/pt.

## 3. APPLICATION

- [x] 3.1 REPORTING: `GetBudgetRisk` con `BudgetVsActualQuery`, las ocurrencias del periodo (pendientes con vencimiento y resueltas con su monto, ampliando la query de COMMITMENTS de forma aditiva si hace falta) y `LatestForecastQuery` solo con los pronósticos habilitados; `NO_PLAN`, `NOT_CURRENT_PERIOD` y `DISABLED`: TC-REPORTING-INSIGHT-003..006 y -014 Nota 2026-11-26: no hizo falta ampliar la query de COMMITMENTS: `listForCashFlow` (pendientes con categoría) y `listResolved` (resueltas con categoría y monto) ya existían. `BudgetRiskLine` agrega `targetName` y `BudgetRisk` agrega `budgetId` (aditivos; el enlace del aviso lo exige).
- [x] 3.2 REPORTING: `ReportSummary.budgetRisk` (hasta 3 líneas `LIKELY` por fecha estimada y `moreCount`), sin cambiar el disponible para gastar: TC-REPORTING-INSIGHT-018 y -019 Nota 2026-11-26: `ReportSummary.budgetRisk` solo con las líneas `LIKELY`.
- [x] 3.3 REPORTING: paso de avisos en `reporting.cash-flow-watch` (por workspace, aislado del paso del flujo de caja, inserción idempotente en `reporting.budget_overrun_notice`, notificación en la misma unidad de trabajo, sin avisar `EXCEEDED` ni `POSSIBLE`): TC-NOTIFICATIONS-BUDGETRISK-002 y -003 Nota 2026-11-26: `EvaluateBudgetRiskNotices` corre dentro del job existente, aislado del paso del flujo de caja (try/catch por paso y por workspace) y con su duración en el log del worker (`job.step: budget-risk`).
- [x] 3.4 NOTIFICATIONS: `BudgetOverrunRiskFact`, tipo `BUDGET_OVERRUN_RISK` desactivado por omisión (valor por omisión por tipo, si el change 72 no lo introdujo), destinatarios como el umbral, plantillas es/en/pt y email sin detalles salvo opt-in: TC-NOTIFICATIONS-BUDGETRISK-001, -004 y -005 Nota 2026-11-26: el valor por omisión por tipo ya lo había introducido el change 72; solo se suma `BUDGET_OVERRUN_RISK` a `TYPES_OFF_BY_DEFAULT`. Destinatarios: OWNER, EDITOR y VIEWER (como el umbral).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de `reporting.budget_overrun_notice` (RLS forzada, D298, registro en `platform.workspace_scoped_table`); timestamp posterior a la última de `main`: TC-REPORTING-INSIGHT-016 Nota 2026-11-26: migración `20261126100500_reporting_budget_overrun_notice.sql` (purga demo 205; `pf_worker` inserta, sin llaves a PLANNING).
- [x] 4.2 Tests de integración con PostgreSQL real (Testcontainers): riesgo con plan, ocurrencias y pronóstico sembrados; aislamiento; idempotencia del aviso: TC-REPORTING-INSIGHT-005, -016 y TC-NOTIFICATIONS-BUDGETRISK-002 Nota 2026-11-26: `apps/api/test/events/budget-risk.int.test.ts` (PostgreSQL real, worker real).
- [x] 4.3 Arranque del worker con la plantilla del host y la función habilitada: mismos consumidores y conexiones (28 + 4 = 32 de 34): TC-REPORTING-INSIGHT-015 Nota 2026-11-26: la prueba de arranque existente (`event-throughput.int.test.ts`) valida 28 consumidores + 4 = 32 de 34 con la función habilitada.
- [x] 4.4 Variables `REPORTING_BUDGET_RISK_ENABLED` y `REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS` en `variables.ts`, la plantilla del host y `docs/config-reference.md` (`pnpm config:docs:check`) Nota 2026-11-26: `variables.ts` y `docs/config-reference.md`; ninguna es obligatoria en la plantilla del host (valores por omisión).
- [x] 4.5 `pnpm arch:check`: REPORTING → PLANNING, COMMITMENTS, FORECAST y NOTIFICATIONS solo por contratos, sin ciclos Nota 2026-11-26: `pnpm arch:check` sin violaciones.

## 5. API

- [x] 5.1 Endpoint `getBudgetRisk`, esquemas `BudgetRisk` y `BudgetLineRisk`, `ReportSummary.budgetRisk` y `NotificationType.BUDGET_OVERRUN_RISK` en el contrato (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores): TC-REPORTING-INSIGHT-014, -016, -018 y -019 Nota 2026-11-26: oasdiff sin cambios incompatibles; Redocly y Spectral sin errores.
- [x] 5.2 Benchmarks: riesgo de un plan de 40 líneas ≤ 300 ms p95, resumen del Home ≤ 300 ms p95 con el bloque de riesgo y duración del paso de riesgo en `reporting.cash-flow-watch` registrada: TC-REPORTING-INSIGHT-017 Nota 2026-11-26: `apps/api/test/perf/budget-risk.perf.ts` en el nightly (no bloquea PR).

## 6. UI

- [x] 6.1 Plan del periodo en curso: indicador de riesgo por línea con tooltip (proyección, proyección alta, fecha estimada y base) y leyenda de «posible», sin tocar la columna de proyección existente; i18n es/en/pt: TC-REPORTING-INSIGHT-012 Nota 2026-11-26: columna «Riesgo de exceder» con texto e icono, detalle visible (y `title`) y leyenda; la columna de proyección lineal no cambia.
- [x] 6.2 Tarjeta Q5: líneas en riesgo con su enlace al plan: TC-REPORTING-INSIGHT-018 Nota 2026-11-26: tarjeta «Presupuestos en riesgo» justo después de la de Q5 (mismo `Dashboard`).
- [x] 6.3 Preferencias de notificaciones con el tipo riesgo de presupuesto apagado por omisión: TC-NOTIFICATIONS-BUDGETRISK-001 Nota 2026-11-26: tipo listado en las preferencias, apagado en los dos canales.

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter Nota 2026-11-26: cada TC con su id en el nombre del test y el front matter actualizado.
- [ ] 7.2 E2E con el dataset Demo y un plan con una línea en riesgo: indicador en el plan y la línea en Q5, sin violaciones serias de axe: TC-REPORTING-INSIGHT-012
- [x] 7.3 Regresión: TC-PLANNING-THRESHOLD-*, TC-PLANNING-BUDGET-*, TC-REPORTING-SPENDABLE-* y TC-REPORTING-FORECAST-018/019 en verde sin cambios Nota 2026-11-26: suites de PLANNING (umbrales y presupuestos), REPORTING (disponible y FORECAST-018/019) sin cambios y en verde.
- [ ] 7.4 Criterio de salida con datos reales (espera al owner, D472): un periodo completo con el plan del owner, registrando cuántas líneas avisó el riesgo y cuántas terminaron excedidas, sin montos ni nombres

## 8. DOCUMENTATION

- [x] 8.1 Aplicar design.md § «Cambios a docs compartidos» Nota 2026-11-26: docs 01, 05, 06, 10, 14, 15, 17, 25, 38 y config-reference.
- [x] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check` Nota 2026-11-26: `spec:validate`, `traceability:check` y `format:check` en verde.
