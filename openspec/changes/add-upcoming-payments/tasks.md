# Tareas

> Requiere aplicado **`add-recurrence-engine`** (contexto `@pf/commitments`, queries `UpcomingPaymentsQuery`, `CommittedQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, eventos de Commitments y `PendingFlowQuery` en Transactions; ver design.md § Contratos) y los changes de Phase 1/2 de Reporting (`add-basic-dashboard`, `add-financial-periods`, `add-net-worth-evolution`). Resolver antes la pregunta abierta 2 de design.md (bloqueante para la decisión 3).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `reporting/cash-flow-calendar` (versión simple) y las preguntas abiertas 1–7 de design.md; verificar con `openspec validate add-upcoming-payments --strict`
- [ ] 1.2 Coordinar con `add-recurrence-engine` los contratos de design.md § Contratos (lista unificada sin doble conteo, total del periodo con `overdueBefore`, `generatedAt` de la ocurrencia, `PendingFlowQuery`) y los nombres de eventos; ajustar la tabla si cambian
- [ ] 1.3 Revisar TC-REPORTING-UPCOMING-001..021 contra los scenarios (cifras a mano, `FixedClock` 2026-10-20T10:00:00-04:00 en America/La_Paz, USD/BOB `PARALLEL` 12.00); pasar a `ready` y `requirement_status: confirmed` al aprobar; `pnpm traceability:check` sin errores
- [ ] 1.4 Delta MODIFIED de `reporting/dashboard` ("Preguntas del Home sin datos o no disponibles") y actualización de TC-REPORTING-DASHBOARD-005 en el mismo commit (design.md § "Cambios a docs compartidos")

## 2. DOMAIN (TDD)

- [ ] 2.1 `UpcomingPaymentsAssembler` test-first: orden por fecha y nombre, vencidos con días de atraso, pendientes no vencidas, exclusión de ingresos (TC-REPORTING-UPCOMING-001, -002, -003, -005)
- [ ] 2.2 Tipo de monto test-first: `FIXED`, `ESTIMATED`, `MIN_MAX` (máximo en totales), `VARIABLE` (sin monto, `withoutAmountCount`), monto editado de una ocurrencia (TC-REPORTING-UPCOMING-006); PBT: el total nunca incluye ítems sin monto y nunca es menor que la suma de los mínimos
- [ ] 2.3 Deduplicación ocurrencia ↔ pendiente (fallback de la decisión 3) test-first (TC-REPORTING-UPCOMING-007, -008); PBT: cada `occurrenceId` aparece a lo sumo una vez
- [ ] 2.4 Ventana y "hoy" en la zona del workspace test-first con `FixedClock` cerca de medianoche (TC-REPORTING-UPCOMING-012)
- [ ] 2.5 Valoración con `FlowValuation` (fecha = hoy, una conversión por moneda, sin tasa ⇒ incompleto, HALF_EVEN al presentar) test-first (TC-REPORTING-UPCOMING-009, -010, -011)
- [ ] 2.6 Total comprometido del periodo y vencidos de periodos anteriores, con día de inicio 1 y 25 (TC-REPORTING-UPCOMING-013, -014, -015)
- [ ] 2.7 `ProjectedBalanceCalculator` test-first (TC-REPORTING-UPCOMING-016)
- [ ] 2.8 `SurprisePaymentClassifier` test-first (generación en fecha local ≥ fecha del pago; omitidas fuera; periodo parcial) (TC-REPORTING-UPCOMING-021)
- [ ] 2.9 `homeQuestions`: Q4/Q8 `AVAILABLE` / `NO_DATA` + `CREATE_COMMITMENT` (TC-REPORTING-UPCOMING-018)

## 3. APPLICATION

- [ ] 3.1 Puertos `UpcomingCommitmentsPort` y `PendingTransactionsPort` en `application/ports`; `GetUpcomingPayments` en la `ReportingUnitOfWork` de lectura con periodos, saldos, pendientes, ocurrencias y tasas (TC-REPORTING-UPCOMING-001, -013, -016, -017)
- [ ] 3.2 `GetSurprisePayments` (periodo por etiqueta, `RESOURCE_NOT_FOUND`) (TC-REPORTING-UPCOMING-021)
- [ ] 3.3 `REPORTING_INVALIDATING_EVENTS` + eventos de Commitments y `transactions.TransactionCreated.v1`; `ETag` con el día local (TC-REPORTING-UPCOMING-019)

## 4. INFRASTRUCTURE

- [ ] 4.1 Adapters en la composición de `apps/api` hacia `@pf/commitments/contracts` y `@pf/transactions/contracts`; tests de contrato de los adapters con dobles y con PG (RLS: TC-REPORTING-UPCOMING-020)
- [ ] 4.2 Suscripción del consumidor `reporting.data-version` a los eventos nuevos; test de integración (duplicado no incrementa)

## 5. API

- [ ] 5.1 `getUpcomingPayments` y `getSurprisePayments` en `contracts/openapi/finance-api.v1.yaml` (aditivo, `x-openspec-capability: reporting/cash-flow-calendar`, VIEWER), `actionHint: CREATE_COMMITMENT`; oasdiff sin cambios rompedores
- [ ] 5.2 Tests de API: ventana fuera de rango `INVALID_FILTER`, 304 con `If-None-Match`, VIEWER, otro workspace (TC-REPORTING-UPCOMING-004, -019, -020)

## 6. UI

- [ ] 6.1 Tarjeta Q8 del Home (7 días, hasta 5 ítems + "y N más" + enlace) y tarjeta Q4 (total del periodo, desglose, vencidos anteriores, pagos sin monto); estados sin datos y semana vacía; orden móvil de docs/28 §3 (TC-REPORTING-UPCOMING-017, -018)
- [ ] 6.2 Vista `/pagos-proximos`: selector 7/14/30/60/90, lista con estados y tipos de monto, totales con tasas ("valorado con la tasa de hoy"), comprometido del periodo, saldo proyectado por cuenta rotulado como proyección, indicador de pagos sorpresa con su limitación; enlaces a Recurrentes para aprobar/omitir/vincular; i18n es/en/pt; accesibilidad (tabla con encabezados, estados no solo por color)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-REPORTING-UPCOMING-001..021 con el TC-ID en el nombre; actualizar front matter (`automated_tests`, `status`)
- [ ] 7.2 E2E: crear una definición mensual, ver el pago en la tarjeta Q8 y en Q4, aprobarlo y verificar que sale de la lista en la siguiente consulta (TC-REPORTING-UPCOMING-019)
- [ ] 7.3 Benchmark del Home con seed `large` + 60 definiciones: `getUpcomingPayments?days=7` y `getReportSummary` en paralelo, p95 ≤ 300 ms (NFR-PERF-004)

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 10, 11, 14, 24, 28, ARCHITECTURE §14) y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
