# Tareas

> Requiere aplicados: `add-event-outbox`, `add-audit-trail`, `add-api-conventions`, `add-classification`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-market-rate-providers`, `add-basic-dashboard` y **`add-financial-periods`** (Phase 2, sibling). Habilita `add-budget-templates`, `add-alerts` y `add-month-closing`. No iniciar la implementación con preguntas abiertas de design.md sin resolver que afecten el grupo (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `planning/budgets` y las preguntas abiertas 1–8 de design.md; registrar las decisiones en docs/31 (sección Phase 2) y verificar con `openspec validate add-budgets --strict`
- [ ] 1.2 Revisar TC-PLANNING-BUDGET-001..021, TC-PLANNING-ACTUAL-001..007 y TC-PLANNING-THRESHOLD-001..007 contra los scenarios (cifras a mano, fechas fijas, `FixedClock` en America/La_Paz); pasar a `ready` y `requirement_status: confirmed` tras la revisión; verificar con `pnpm traceability:check` que todo requirement Must tiene ≥ 1 TC
- [ ] 1.3 Coordinar con `add-financial-periods` y `add-month-closing` (pf-p2a): estados no cerrados, `PeriodQuery`, payloads de `planning.MonthClosed.v1`/`PeriodReopened.v1` y el uso de `BudgetVsActualQuery` en el snapshot

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 Extraer `FlowValuation` de `ConsolidationService.consolidateFlows` (Reporting) a `@pf/shared-kernel` sin cambio de comportamiento: TC-REPORTING-KPI-001..010 y TC-REPORTING-DASHBOARD-* siguen en verde; `pnpm arch:check` sin ciclos
- [ ] 2.2 `Budget`/`BudgetLine` con validaciones (montos, moneda, escala, tipo por naturaleza, objetivo duplicado) y `TargetOverlapPolicy`: tests primero de TC-PLANNING-BUDGET-001, -004, -007, -008
- [ ] 2.3 `BudgetProgressCalculator` (planificado efectivo, restante, % con HALF_EVEN a 1 decimal, proyección lineal en TZ del workspace, estados, disponible para gastar): tests primero de TC-PLANNING-BUDGET-005, -006, -009, -010, -011; PBT: `availableToSpend ≥ 0` y Σ de líneas sin doble conteo
- [ ] 2.4 `ThresholdEvaluator` (umbrales válidos, cruce `actual ≥ t × ref`, máximo + `alsoCrossed`, sin re-emisión): tests primero de TC-PLANNING-THRESHOLD-001, -002, -003, -004, -006, -007; PBT: para toda secuencia de gastados, cada umbral se emite a lo sumo una vez
- [ ] 2.5 Tipos Should/Could: `MINIMUM`, `RANGE`, `PERCENT_OF_INCOME` (redondeo HALF_EVEN), `RolloverCalculator` (políticas, tope, piso 0, encadenado) y modo base cero: tests primero de TC-PLANNING-BUDGET-015, -016, -017, -019, -020

## 3. APPLICATION

- [ ] 3.1 `CreateBudget`, `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine`, `SetZeroBasedMode` con `AuditPort` en la UoW, rol EDITOR/OWNER y rechazo `PERIOD_CLOSED`; evaluación síncrona de umbrales al editar; tests con dobles de TC-PLANNING-BUDGET-002, -012, -013 y TC-PLANNING-THRESHOLD-007
- [ ] 3.2 `GetBudgetVsActual` (pública como `BudgetVsActualQuery.getForPeriod` en `@pf/planning/contracts`) orquestando `PeriodQuery`, `NominalFlowQuery`, `CategoryTreeQuery`, `FxValuationPort` (`windowDays` del setting de REPORTING) y `Clock`: tests de TC-PLANNING-BUDGET-003, -014, -021 y TC-PLANNING-ACTUAL-001..006
- [ ] 3.3 Consumidor `planning.budget-thresholds` (inbox, `key_strict_fifo` por workspace, `SELECT … FOR UPDATE` del plan, `ON CONFLICT DO NOTHING`, un evento al outbox) y `planning.rollover-finalizer` (`MonthClosed`/`PeriodReopened`): tests de TC-PLANNING-THRESHOLD-005 y TC-PLANNING-BUDGET-018
- [ ] 3.4 Ampliaciones aditivas de contratos: `NominalFlowQuery` (`categoryIds?`, `tagIds` por fila) en Transactions y `categoryTree` en Classification, con tests de contrato entre módulos

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand `planning.budget`, `planning.budget_line`, `planning.budget_threshold_crossing` (RLS forzada, grants, `forbid_mutation` en cruces, `platform.workspace_scoped_table`); tests de integración Testcontainers: aislamiento entre workspaces, append-only de cruces, unicidad `(workspace_id, period_id)`
- [ ] 4.2 Repositorios y adapters; agregar `REPORTING_RATE_VALIDITY_WINDOW` al `worker` (config-reference); test de integración con PG real de TC-PLANNING-ACTUAL-004/-005 (tasa del provider simulado) y TC-PLANNING-THRESHOLD-005 (dos workers concurrentes, un solo cruce y un solo evento)
- [ ] 4.3 Esquemas `contracts/events/planning/BudgetCreated.v1` y `BudgetThresholdReached.v1` + test de contrato de eventos (payload validado al escribir en el outbox)

## 5. API

- [ ] 5.1 Endpoints de design.md § Contratos (`budgets`, `periods/{id}/budget`, líneas) con `Idempotency-Key`, `If-Match`, ETag y problem+json; tests de API con TC-PLANNING-BUDGET-001, -007, -012, -013 y validación contra el OpenAPI consolidado (`pnpm contract:breaking` sin cambios incompatibles)
- [ ] 5.2 Benchmark nightly con seed `large`: `GET W/budgets/{id}` p95 ≤ 300 ms con 30 líneas y 12 meses de historia (referencia NFR-PERF-004)

## 6. UI

- [ ] 6.1 Pantalla "Presupuestos" del periodo: líneas con planificado/gastado/restante/%/proyección y estado con texto + icono (NFR-USAB-104), tasas usadas y montos sin convertir, disponible para gastar, rollover provisional/definitivo, edición inline con validaciones mapeadas desde `code` (NFR-USAB-009); textos vía i18n (es; claves listas para en/pt)
- [ ] 6.2 `BudgetProgressWidget` en el Home (Q3 + Q5 parcial: disponible para gastar) y "no disponible" cuando el periodo no tiene plan

## 7. TESTS automatizados y E2E

- [ ] 7.1 Test cruzado Home ↔ presupuesto: el gastado de una categoría coincide con su monto en `/reports/summary` para el mismo rango (incluye USD con tasa `PARALLEL` y EUR sin tasa); agregar TC-PLANNING-ACTUAL-004 y -006 a la Financial Regression Suite
- [ ] 7.2 PBT de TC-PLANNING-ACTUAL-007 (INV-034: replay de eventos ⇒ gastado = Σ splits posteados por categoría y periodo)
- [ ] 7.3 E2E Playwright: crear el plan de noviembre, agregar "Restaurantes" máximo 600.00 BOB, registrar gastos hasta cruzar 50 % y 90 %, verificar progreso y cruces; viewport móvil incluido

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/04 §3.6 (`Budget` por periodo, tipos y rollover como atributo), docs/08 §5.6 (tablas as-built y unicidad por periodo), docs/10 (§rutas `budgets`, catálogo de errores planning), docs/11 (payload de `BudgetThresholdReached.v1` y `BudgetCreated.v1`), docs/14 (budget utilization/pace con la valoración compartida) y config-reference
- [ ] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
