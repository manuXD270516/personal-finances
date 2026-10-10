# Tareas

> Requiere aplicado **`add-recurrence-engine`** (contexto `@pf/commitments`, queries `UpcomingPaymentsQuery`, `CommittedQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, eventos de Commitments y `PendingFlowQuery` en Transactions; ver design.md § Contratos) y los changes de Phase 1/2 de Reporting (`add-basic-dashboard`, `add-financial-periods`, `add-net-worth-evolution`). Resolver antes la pregunta abierta 2 de design.md (bloqueante para la decisión 3).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `reporting/cash-flow-calendar` (versión simple) y las preguntas abiertas 1–7 de design.md; verificar con `openspec validate add-upcoming-payments --strict` _(2026-10-10: Preguntas abiertas cerradas por el owner en docs/35 (D115, D117, D127, D145-D148); `openspec validate` en verde.)_
- [x] 1.2 Coordinar con `add-recurrence-engine` los contratos de design.md § Contratos (lista unificada sin doble conteo, total del periodo con `overdueBefore`, `generatedAt` de la ocurrencia, `PendingFlowQuery`) y los nombres de eventos; ajustar la tabla si cambian _(2026-10-10: Contratos de `@pf/commitments/contracts` y `@pf/transactions/contracts` usados tal cual (`UpcomingPaymentsQuery`, `CommittedQuery.getForRange`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, `PendingFlowQuery`); sin extensiones. Matices en design.md § "Decisiones del owner y as-built".)_
- [x] 1.3 Revisar TC-REPORTING-UPCOMING-001..021 contra los scenarios (cifras a mano, `FixedClock` 2026-10-20T10:00:00-04:00 en America/La_Paz, USD/BOB `PARALLEL` 12.00); pasar a `ready` y `requirement_status: confirmed` al aprobar; `pnpm traceability:check` sin errores _(2026-10-10: TC-REPORTING-UPCOMING-001..022 `confirmed` y `automated`; `pnpm traceability:check` sin errores.)_
- [x] 1.4 Delta MODIFIED de `reporting/dashboard` ("Preguntas del Home sin datos o no disponibles") y actualización de TC-REPORTING-DASHBOARD-005 en el mismo commit (design.md § "Cambios a docs compartidos") _(2026-10-10: Delta MODIFIED en `specs/reporting/dashboard/spec.md`; TC-REPORTING-DASHBOARD-005 actualizado (el scenario conserva su nombre: un MODIFIED no puede renombrarlo).)_

## 2. DOMAIN (TDD)

- [x] 2.1 `UpcomingPaymentsAssembler` test-first: orden por fecha y nombre, vencidos con días de atraso, pendientes no vencidas, exclusión de ingresos (TC-REPORTING-UPCOMING-001, -002, -003, -005) _(2026-10-10: Dominio `UpcomingPaymentsAssembler` y `UpcomingWindow` (upcoming-payments.ts) con TDD.)_
- [x] 2.2 Tipo de monto test-first: `FIXED`, `ESTIMATED`, `MIN_MAX` (máximo en totales), `VARIABLE` (sin monto, `withoutAmountCount`), monto editado de una ocurrencia (TC-REPORTING-UPCOMING-006); PBT: el total nunca incluye ítems sin monto y nunca es menor que la suma de los mínimos _(2026-10-10: PBT con fast-check en `upcoming-payments.test.ts`.)_
- [x] 2.3 Deduplicación ocurrencia ↔ pendiente (fallback de la decisión 3) test-first (TC-REPORTING-UPCOMING-007, -008); PBT: cada `occurrenceId` aparece a lo sumo una vez _(2026-10-10: PBT: cada `occurrenceId` aparece a lo sumo una vez; si coinciden ocurrencia y pendiente gana la pendiente (monto real).)_
- [x] 2.4 Ventana y "hoy" en la zona del workspace test-first con `FixedClock` cerca de medianoche (TC-REPORTING-UPCOMING-012) _(2026-10-10: `UpcomingWindow.of` con la fecha local del workspace.)_
- [x] 2.5 Valoración con `FlowValuation` (fecha = hoy, una conversión por moneda, sin tasa ⇒ incompleto, HALF_EVEN al presentar) test-first (TC-REPORTING-UPCOMING-009, -010, -011) _(2026-10-10: `UpcomingValuation` sobre `FlowValuation` (fecha = hoy).)_
- [x] 2.6 Total comprometido del periodo y vencidos de periodos anteriores, con día de inicio 1 y 25 (TC-REPORTING-UPCOMING-013, -014, -015) _(2026-10-10: `CommittedPeriod` (periodo que contiene hoy, vencidos aparte).)_
- [x] 2.7 `ProjectedBalanceCalculator` test-first (TC-REPORTING-UPCOMING-016) _(2026-10-10: `ProjectedBalanceCalculator`.)_
- [x] 2.8 `SurprisePaymentClassifier` test-first (generación en fecha local ≥ fecha del pago; omitidas fuera; periodo parcial) (TC-REPORTING-UPCOMING-021) _(2026-10-10: `SurprisePaymentClassifier`.)_
- [x] 2.9 `homeQuestions`: Q4/Q8 `AVAILABLE` / `NO_DATA` + `CREATE_COMMITMENT` (TC-REPORTING-UPCOMING-018) _(2026-10-10: `homeQuestions` con `hasCommitments` y `CREATE_COMMITMENT`.)_

## 3. APPLICATION

- [x] 3.1 Puertos `UpcomingCommitmentsPort` y `PendingTransactionsPort` en `application/ports`; `GetUpcomingPayments` en la `ReportingUnitOfWork` de lectura con periodos, saldos, pendientes, ocurrencias y tasas (TC-REPORTING-UPCOMING-001, -013, -016, -017) _(2026-10-10: `UpcomingPaymentsQueries` (`upcoming-payments.queries.ts`) en la `ReportingUnitOfWork` de lectura; los puertos `UpcomingCommitmentsPort` y `PendingTransactionsPort` se declaran en `application/ports`.)_
- [x] 3.2 `GetSurprisePayments` (periodo por etiqueta, `RESOURCE_NOT_FOUND`) (TC-REPORTING-UPCOMING-021) _(2026-10-10: `getSurprisePayments` con 62 días de holgura sobre el vencimiento de la ocurrencia.)_
- [x] 3.3 `REPORTING_INVALIDATING_EVENTS` + eventos de Commitments y `transactions.TransactionCreated.v1`; `ETag` con el día local (TC-REPORTING-UPCOMING-019) _(2026-10-10: `REPORTING_INVALIDATING_EVENTS` con los eventos de Commitments y `TransactionCreated`; ETag = versión + hash del contenido.)_

## 4. INFRASTRUCTURE

- [x] 4.1 Adapters en la composición de `apps/api` hacia `@pf/commitments/contracts` y `@pf/transactions/contracts`; tests de contrato de los adapters con dobles y con PG (RLS: TC-REPORTING-UPCOMING-020) _(2026-10-10: Adapters en `identity-wiring.ts` (resolución tardía, COMMITMENTS se compone después de REPORTING); RLS y aislamiento cubiertos por `upcoming-payments.api.test.ts` contra PostgreSQL real (los adapters son delegaciones directas, sin test de contrato aparte).)_
- [x] 4.2 Suscripción del consumidor `reporting.data-version` a los eventos nuevos; test de integración (duplicado no incrementa) _(2026-10-10: Cubierta en `reports.api.test.ts` (evento nuevo aplicado una vez y duplicado descartado).)_

## 5. API

- [x] 5.1 `getUpcomingPayments` y `getSurprisePayments` en `contracts/openapi/finance-api.v1.yaml` (aditivo, `x-openspec-capability: reporting/cash-flow-calendar`, VIEWER), `actionHint: CREATE_COMMITMENT`; oasdiff sin cambios rompedores _(2026-10-10: OpenAPI aditivo; `pnpm contract:breaking` sin cambios incompatibles.)_
- [x] 5.2 Tests de API: ventana fuera de rango `INVALID_FILTER`, 304 con `If-None-Match`, VIEWER, otro workspace (TC-REPORTING-UPCOMING-004, -019, -020) _(2026-10-10: `upcoming-payments.api.test.ts` (INVALID_FILTER, 304 vs 200 tras omitir, VIEWER, otro workspace, respuestas validadas contra el contrato).)_

## 6. UI

- [x] 6.1 Tarjeta Q8 del Home (7 días, hasta 5 ítems + "y N más" + enlace) y tarjeta Q4 (total del periodo, desglose, vencidos anteriores, pagos sin monto); estados sin datos y semana vacía; orden móvil de docs/28 §3 (TC-REPORTING-UPCOMING-017, -018) _(2026-10-10: Tarjetas Q4/Q8 en `CommitmentsHomeView.tsx`, sección tras el dinero disponible.)_
- [x] 6.2 Vista `/pagos-proximos`: selector 7/14/30/60/90, lista con estados y tipos de monto, totales con tasas ("valorado con la tasa de hoy"), comprometido del periodo, saldo proyectado por cuenta rotulado como proyección, indicador de pagos sorpresa con su limitación; enlaces a Recurrentes para aprobar/omitir/vincular; i18n es/en/pt; accesibilidad (tabla con encabezados, estados no solo por color) _(2026-10-10: `/pagos-proximos` (`UpcomingFullView.tsx`); i18n es/en/pt (namespace `Upcoming`); la entrada de la sidebar es Pagos recurrentes.)_

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-REPORTING-UPCOMING-001..021 con el TC-ID en el nombre; actualizar front matter (`automated_tests`, `status`) _(2026-10-10: Todos los TC automatizados con su ID en el nombre del test.)_
- [x] 7.2 E2E: crear una definición mensual, ver el pago en la tarjeta Q8 y en Q4, aprobarlo y verificar que sale de la lista en la siguiente consulta (TC-REPORTING-UPCOMING-019) _(2026-10-10: `tests/e2e/specs/upcoming-payments.spec.ts` (también actualiza `dashboard.spec.ts`).)_
- [x] 7.3 Benchmark del Home con seed `large` + 60 definiciones: `getUpcomingPayments?days=7` y `getReportSummary` en paralelo, p95 ≤ 300 ms (NFR-PERF-004) _(2026-10-10: `apps/api/test/perf/upcoming-payments.perf.ts` (nightly): 60 definiciones (~2 000 ocurrencias) y un pendiente, Home en paralelo, p95 51 ms (presupuesto 300 ms); sin el seed `large`.)_

## 8. DOCUMENTATION

- [x] 8.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 10, 11, 14, 24, 28, ARCHITECTURE §14) y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check` _(2026-10-10: docs/01, 03, 10, 11, 14, 18, 24, 28 y ARCHITECTURE §14 actualizados.)_

## 9. OBSERVABILIDAD (docs/35 D117)

- [x] 9.1 Métricas `reporting_upcoming_payments_duration_seconds` y `reporting_upcoming_payments_rows` y alerta `UpcomingPaymentsReadModelRecommended` (p95 > 300 ms 15 min o > 5 000 ocurrencias) en la configuración de alertas de docs/18; enlace a design.md § "Evolución a read model" (TC-REPORTING-UPCOMING-022) _(2026-10-10: Métricas `reporting_upcoming_payments_duration_seconds`/`_rows` y regla `UpcomingPaymentsReadModelRecommended` (`evaluateReadModelAlert`, docs/18 §8).)_

