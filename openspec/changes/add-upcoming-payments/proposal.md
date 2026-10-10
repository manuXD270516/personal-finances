# Propuesta: add-upcoming-payments

## Why

El Home de PFOS declara desde Phase 1 que Q4 ("¿Cuánto está comprometido?") y Q8 ("¿Qué pagos vienen?") **aún no están disponibles** (`reporting/dashboard`, requirement "Preguntas del Home sin datos o no disponibles"). Con el motor de recurrencia de Phase 3 (`add-recurrence-engine`, capability `commitments/recurrence-engine`) ya existen ocurrencias con fecha, tipo de monto, moneda, cuenta y estado; falta **mostrarlas** donde el usuario decide: la lista simple de próximos pagos en el dashboard (FR-REPORTING-016, Must, Phase 3) y la tarjeta del total comprometido del periodo (FR-COMMITMENTS-011, insumo de Q4). El objetivo de Phase 3 es "anticipar todos los pagos conocidos" (docs/24 §5.3) y su criterio de salida exige **0 pagos recurrentes sorpresa en un mes** (SM-07, docs/00 §8), que hoy nadie mide. Además, el "saldo proyectado" (saldo contable + transacciones `pending`, FR-LEDGER-013) ya pertenece a `reporting/cash-flow-calendar` y es un insumo directo de "¿qué pagos vienen y me alcanza?": encaja aquí sin traer el calendario de Phase 7.

## What Changes

- **Capability nueva `reporting/cash-flow-calendar`** en su **versión simple de Phase 3** (sin calendario): lista de próximos pagos, total comprometido del periodo en el Home, saldo proyectado por cuenta e indicador de pagos sorpresa.
- **Lista de próximos pagos (Q8)** para una ventana de N días desde hoy en la zona del workspace (por defecto 30, de 1 a 90): ocurrencias de egreso **no resueltas** que informa Commitments (`SCHEDULED`, `DUE`, `OVERDUE`) y transacciones `PENDING` de egreso, **sin doble conteo** (una ocurrencia materializada como transacción pendiente aparece una sola vez, como la transacción). Las vencidas sin resolver se muestran primero y marcadas.
- **Montos según el tipo**: `FIXED` exacto, `ESTIMATED` marcado como estimado, `MIN_MAX` con el rango y el **máximo** en los totales (FR-COMMITMENTS-004), `VARIABLE` sin monto, excluido de los totales y contado aparte ("N pagos sin monto"); nunca se inventa un monto ni se usa 0.
- **Valoración en la moneda de reporte** con la valoración compartida `FlowValuation` del shared-kernel (docs/33 D109): agregado por moneda, una conversión por agregado con la tasa vigente al consultar (equivale a `conv_v(hoy)` de docs/14 §3), ventana `REPORTING_RATE_VALIDITY_WINDOW`, sin tasa ⇒ monto sin convertir y total incompleto (nunca 1:1), HALF_EVEN solo al presentar.
- **Total comprometido del periodo financiero (Q4)** en el Home: el total que informa Commitments para el periodo que contiene hoy (ocurrencias no resueltas de egreso con fecha en el periodo + pendientes de egreso, FR-COMMITMENTS-011), valorado en la moneda de reporte, con el desglose y, aparte, lo **vencido de periodos anteriores**.
- **Saldo proyectado por cuenta** (FR-LEDGER-013, traído desde Phase 7 por ser trivial y útil aquí): saldo contable + transacciones `pending` (ingresos suman, egresos restan), siempre diferenciado del saldo contable.
- **Tarjetas del Home**: Q4 (total comprometido) y Q8 (próximos 7 días, hasta 5 ítems, con enlace a la vista completa `/pagos-proximos`); sin compromisos ni pendientes, ambas declaran "sin datos" con la acción de crear un compromiso, sin mostrar 0.00 BOB.
- **Indicador de pagos sorpresa (SM-07, Should)**: por periodo, cuántos egresos resueltos por una ocurrencia **no estaban en la lista antes de su fecha** (la ocurrencia se generó el mismo día del pago o después: definición creada a posteriori o anticipación insuficiente), con el detalle.
- **Frescura**: lectura de la fuente de verdad (contratos de Commitments, Transactions, Ledger y FX en una transacción de lectura, como el resumen del Home), con la versión de datos del workspace incrementada también por los eventos de Commitments para el `ETag`.
- **API**: `GET W/reports/upcoming-payments` y `GET W/reports/surprise-payments` (VIEWER); `getReportSummary` informa Q4/Q8 como disponibles.
- **Fuera de alcance:** cash-flow calendar 7/30/60/90 con saldo esperado diario, saldo más bajo esperado y riesgo de déficit (FR-REPORTING-014 y FR-REPORTING-015, **Phase 7**, docs/24 §5.7); proyección `reporting.commitment_occurrence` (Phase 7); ingresos esperados en la lista (solo egresos en Phase 3; el calendario de Phase 7 los incluye); cuotas de préstamo y vencimientos de tarjeta (Phase 4, `debt/*`, FR-DEBT-013); "disponible para gastar" con compromisos (safe to spend de docs/14 §4.2, Phase 4/7); compromisos dentro del plan mensual (pregunta abierta 3); notificaciones nuevas (el aviso de pago próximo lo agrega `add-recurrence-engine`); detección automática de recurrencias no modeladas (Phase 6+).

## Capabilities

### New Capabilities
- `reporting/cash-flow-calendar` (versión simple, Phase 3): lista de próximos pagos, montos por tipo, valoración en moneda de reporte, total comprometido del periodo en el Home, saldo proyectado por cuenta, tarjetas Q4/Q8, frescura, acceso de lectura e indicador de pagos sorpresa (FR-REPORTING-016, FR-COMMITMENTS-011, FR-LEDGER-013; 13 requirements: 12 Must, 1 Should).

### Modified Capabilities
- `reporting/dashboard`: delta MODIFIED del requirement "Preguntas del Home sin datos o no disponibles" (Q4 y Q8 dejan de declararse no disponibles y las responde `reporting/cash-flow-calendar`; el scenario de Phase 1 "Pagos próximos aún no disponibles" conserva su nombre y pasa a cubrir solo las preguntas aún no habilitadas, Q5 y Q9) y actualización de TC-REPORTING-DASHBOARD-005 en el mismo cambio.

## Impact

**Specs impactadas:** crea `reporting/cash-flow-calendar` (13 requirements: 12 Must, 1 Should). Lee comportamiento de `commitments/recurrence-engine` (estados de ocurrencia, tipos de monto, total comprometido, materialización como pendiente), `transactions/transaction-recording` (transacción pendiente sin asiento, anulación), `ledger/balances` (saldo contable), `planning/financial-periods` (periodo que contiene hoy, día de inicio), `reporting/dashboard` (valoración, ventana de vigencia, preguntas del Home), `fx/market-rates` (tasa preferida y fallback).

**Componentes/contextos impactados:** REPORTING (`@pf/reporting`): query `GetUpcomingPayments` y `GetSurprisePayments` (application), servicios de dominio puros `UpcomingPaymentsAssembler` (une ocurrencias y pendientes sin doble conteo, aplica tipo de monto) y `SurprisePaymentClassifier`; puertos nuevos `UpcomingCommitmentsPort` (adapter al contrato público de `@pf/commitments`) y `PendingTransactionsPort` (adapter a `@pf/transactions/contracts`); reutiliza `FinancialPeriodsPort`, `AccountBalancesQuery`, `FxValuationPort` y `FlowValuation`; `homeQuestions` habilita Q4/Q8; `REPORTING_INVALIDATING_EVENTS` + eventos de Commitments. `apps/api` (composición de los adapters, controller), `apps/web` (tarjetas Q4/Q8 del Home y vista `/pagos-proximos`, i18n es/en/pt).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo, tag Reporting, `x-openspec-capability: reporting/cash-flow-calendar`): `getUpcomingPayments` (`GET W/reports/upcoming-payments?days=&reportingCurrency=`) y `getSurprisePayments` (`GET W/reports/surprise-payments?period=`); `ReportSummary.homeQuestions` sin cambio de forma (Q4/Q8 pasan a `AVAILABLE` o `NO_DATA` con `actionHint: CREATE_COMMITMENT`, valor nuevo del conjunto abierto). Sin códigos de error nuevos (`INVALID_FILTER` para `days` fuera de rango, `CURRENCY_NOT_ENABLED` y `RESOURCE_NOT_FOUND` existentes).

**Tablas impactadas:** ninguna nueva. `reporting.workspace_data_version` recibe incrementos por los eventos de Commitments. Lectura (vía contratos públicos, nunca join cross-schema) de `commitments.recurring_occurrence`/`recurring_definition`, `txn.transaction` (pendientes), saldos del ledger, `planning.financial_period`, `fx.exchange_rate`.

**Eventos impactados:** ninguno producido. Consumidos (solo para incrementar la versión de datos, consumidor existente `reporting.data-version`): `commitments.OccurrencesGenerated.v1`, `commitments.RecurringOccurrenceMaterialized.v1`, `commitments.RecurringOccurrenceChanged.v1`, `commitments.RecurringDefinitionChanged.v1` (definidos por `add-recurrence-engine`) y `transactions.TransactionCreated.v1` (una pendiente nueva cambia la lista).

**Migraciones requeridas:** ninguna (sin tablas). Sin cambio destructivo.

**Test cases:** AÑADIDOS — TC-REPORTING-UPCOMING-001..022 (001..021 del diseño inicial y 022 de la decisión D117; automatizados, `requirement_status: confirmed` tras las decisiones del owner de docs/35). MODIFICADOS — TC-REPORTING-DASHBOARD-005 (actualizado en este cambio: Q4 y Q8 ya no son "no disponibles"). DEPRECADOS — ninguno.

**Impacto de regresión:** el resumen del Home (`getReportSummary`) cambia solo en `homeQuestions` para Q4/Q8; TC-REPORTING-DASHBOARD-005 y su E2E deben actualizarse en el mismo PR. El consumidor `reporting.data-version` recibe más tipos de evento (volumen bajo: un lote por definición y ventana). NFR-PERF-004 (Home p95 ≤ 300 ms) se mide con las tarjetas nuevas cargadas en paralelo al resumen.

**Riesgos introducidos:** RISK-020 (bordes de fecha y zona horaria: ventana calculada en la zona del workspace, TC dedicado), RISK-022 (consistencia: lectura de la fuente de verdad, no de proyecciones), doble conteo entre ocurrencia y transacción pendiente (regla y TC dedicados), falsa sensación de cobertura en SM-07 (el indicador solo ve pagos vinculados a una ocurrencia; los no modelados quedan fuera, documentado en la UI).

**Invariantes afectadas:** INV-001 (sin float: montos `Decimal`/string), INV-002 (todo monto con moneda), INV-003 (escala al presentar), INV-025 (lectura bajo RLS del workspace). Ninguna escritura.
