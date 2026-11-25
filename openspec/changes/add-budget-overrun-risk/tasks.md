# Tareas

> Change 74 (Phase 9, docs/03 §7, D472). Requiere `add-ml-forecasting-service` (64), `add-expense-forecasts` (65) y `add-predicted-cash-flow-band` (66) fusionados por la lectura del pronóstico; su capability `reporting/predictive-insights` es nueva y no depende del archivado de otros changes. Si se implementa antes que `add-spending-anomaly-detection` (72), introduce él el valor por omisión por tipo de notificación (decisión 8 del design). D478 y D471 son recomendaciones aplicadas por omisión ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)); el owner puede revertirlas antes del grupo 3. Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `reporting/predictive-insights`, `reporting/dashboard` y `notifications/alerts` contra D478; `openspec validate add-budget-overrun-risk --strict`
- [ ] 1.2 Revisar TC-REPORTING-INSIGHT-001..019 y TC-NOTIFICATIONS-BUDGETRISK-001..005 contra los scenarios. Cifras:
  - 280.00 + 280.00 / 10 × 20 = 840.00; 400.00 + 800.00 = 1200.00; 560.00 + 1120.00 = 1680.00.
  - 100.00 + 300.00 + 200.00 = 600.00; 300.00 + 50.00 / 10 × 20 = 400.00.
  - 1400.00 y 1620.00 con la banda; 280.00 + 28.00 × 12 = 616.00 frente a 588.00.
  - 500.00 el 2026-11-20 y 510.00 el 2026-11-21.

  Pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `BudgetOverrunProjector` puro test-first: proyección por ritmo y por pronóstico, gastado variable sin lo resuelto por ocurrencias, niveles `EXCEEDED`, `LIKELY`, `POSSIBLE`, `UNLIKELY` y `NOT_AVAILABLE` con motivos, y `TOO_EARLY` salvo que G + ΣK > R: TC-REPORTING-INSIGHT-001..006 y -009..011
- [ ] 2.2 Fecha estimada con los vencimientos de los pagos conocidos y el reparto diario con Decimal: TC-REPORTING-INSIGHT-007 y -008. PBT con timeout explícito: la proyección esperada nunca es mayor que la alta, y la fecha estimada cae dentro del periodo o no existe
- [ ] 2.3 Plantillas de texto (es/en/pt) sin certeza: TC-REPORTING-INSIGHT-013

## 3. APPLICATION

- [ ] 3.1 REPORTING: `GetBudgetRisk` con `BudgetVsActualQuery`, las ocurrencias del periodo (pendientes con vencimiento y resueltas con su monto, ampliando la query de COMMITMENTS de forma aditiva si hace falta) y `LatestForecastQuery` solo con los pronósticos habilitados; `NO_PLAN`, `NOT_CURRENT_PERIOD` y `DISABLED`: TC-REPORTING-INSIGHT-003..006 y -014
- [ ] 3.2 REPORTING: `ReportSummary.budgetRisk` (hasta 3 líneas `LIKELY` por fecha estimada y `moreCount`), sin cambiar el disponible para gastar: TC-REPORTING-INSIGHT-018 y -019
- [ ] 3.3 REPORTING: paso de avisos en `reporting.cash-flow-watch` (por workspace, aislado del paso del flujo de caja, inserción idempotente en `reporting.budget_overrun_notice`, notificación en la misma unidad de trabajo, sin avisar `EXCEEDED` ni `POSSIBLE`): TC-NOTIFICATIONS-BUDGETRISK-002 y -003
- [ ] 3.4 NOTIFICATIONS: `BudgetOverrunRiskFact`, tipo `BUDGET_OVERRUN_RISK` desactivado por omisión (valor por omisión por tipo, si el change 72 no lo introdujo), destinatarios como el umbral, plantillas es/en/pt y email sin detalles salvo opt-in: TC-NOTIFICATIONS-BUDGETRISK-001, -004 y -005

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de `reporting.budget_overrun_notice` (RLS forzada, D298, registro en `platform.workspace_scoped_table`); timestamp posterior a la última de `main`: TC-REPORTING-INSIGHT-016
- [ ] 4.2 Tests de integración con PostgreSQL real (Testcontainers): riesgo con plan, ocurrencias y pronóstico sembrados; aislamiento; idempotencia del aviso: TC-REPORTING-INSIGHT-005, -016 y TC-NOTIFICATIONS-BUDGETRISK-002
- [ ] 4.3 Arranque del worker con la plantilla del host y la función habilitada: mismos consumidores y conexiones (28 + 4 = 32 de 34): TC-REPORTING-INSIGHT-015
- [ ] 4.4 Variables `REPORTING_BUDGET_RISK_ENABLED` y `REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS` en `variables.ts`, la plantilla del host y `docs/config-reference.md` (`pnpm config:docs:check`)
- [ ] 4.5 `pnpm arch:check`: REPORTING → PLANNING, COMMITMENTS, FORECAST y NOTIFICATIONS solo por contratos, sin ciclos

## 5. API

- [ ] 5.1 Endpoint `getBudgetRisk`, esquemas `BudgetRisk` y `BudgetLineRisk`, `ReportSummary.budgetRisk` y `NotificationType.BUDGET_OVERRUN_RISK` en el contrato (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores): TC-REPORTING-INSIGHT-014, -016, -018 y -019
- [ ] 5.2 Benchmarks: riesgo de un plan de 40 líneas ≤ 300 ms p95, resumen del Home ≤ 300 ms p95 con el bloque de riesgo y duración del paso de riesgo en `reporting.cash-flow-watch` registrada: TC-REPORTING-INSIGHT-017

## 6. UI

- [ ] 6.1 Plan del periodo en curso: indicador de riesgo por línea con tooltip (proyección, proyección alta, fecha estimada y base) y leyenda de «posible», sin tocar la columna de proyección existente; i18n es/en/pt: TC-REPORTING-INSIGHT-012
- [ ] 6.2 Tarjeta Q5: líneas en riesgo con su enlace al plan: TC-REPORTING-INSIGHT-018
- [ ] 6.3 Preferencias de notificaciones con el tipo riesgo de presupuesto apagado por omisión: TC-NOTIFICATIONS-BUDGETRISK-001

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter
- [ ] 7.2 E2E con el dataset Demo y un plan con una línea en riesgo: indicador en el plan y la línea en Q5, sin violaciones serias de axe: TC-REPORTING-INSIGHT-012
- [ ] 7.3 Regresión: TC-PLANNING-THRESHOLD-*, TC-PLANNING-BUDGET-*, TC-REPORTING-SPENDABLE-* y TC-REPORTING-FORECAST-018/019 en verde sin cambios
- [ ] 7.4 Criterio de salida con datos reales (espera al owner, D472): un periodo completo con el plan del owner, registrando cuántas líneas avisó el riesgo y cuántas terminaron excedidas, sin montos ni nombres

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
