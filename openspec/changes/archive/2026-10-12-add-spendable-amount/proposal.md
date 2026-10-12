# Propuesta: add-spendable-amount

## Why

"¿Cuánto puedo gastar?" (Q5) es la pregunta que da sentido a la visión de PFOS ("saber cuánto puedo gastar … con números en los que puedo confiar al centavo", docs/00 §2) y el objetivo de Phase 4 es responderla **completa** (docs/24 §5.4; docs/00 §6: "Disponible líquido − comprometido restante del periodo − aportes planificados a metas − reserva mínima configurada; alternativamente, presupuesto restante por categoría", Planning + Commitments + Goals, Phase 2 / Phase 4). Hoy el Home la declara no disponible: Phase 2 solo dejó el "disponible para gastar" del plan (FR-PLANNING-024, suma de restantes de presupuesto), que ignora el dinero real, los pagos comprometidos y las metas. Con Phase 3 (`reporting/cash-flow-calendar`: comprometido del periodo y pendientes), la reserva mínima del workspace (FR-IDENTITY-005, Phase 1) y `add-savings-goals` (reservado por cuenta y aportes planificados pendientes) ya existen todos los insumos; los pagos de tarjeta y cuotas de préstamo de Phase 4 (`add-credit-cards`, `add-loans`) llegan como ocurrencias del motor y entran solos en el comprometido. Por eso Q5 **cabe como change propio y chico de Phase 4**, sin contexto nuevo: Reporting combina consultas públicas y presenta, igual que hizo con Q4/Q8.

## What Changes

- **Disponible para gastar libre de compromisos** (Q5) del periodo financiero que contiene hoy, por moneda y consolidado en la moneda de reporte: saldo de cuentas líquidas − reservado por metas en ellas (con tope en su saldo) − comprometido pagadero desde cuentas líquidas − aportes planificados pendientes a metas − reserva mínima de liquidez; cada término visible. Los ingresos esperados no suman (conservador, docs/14 §4.2).
- **Comprometido para Q5**: ocurrencias de egreso no resueltas del periodo y vencidas de periodos anteriores, transferencias recurrentes de una cuenta líquida a una no líquida (pago de tarjeta, cuota de préstamo) y transacciones pendientes de egreso hasta el fin del periodo, **solo desde cuentas líquidas**; sin compras cargadas a la tarjeta (se descuentan al pagarla), sin transferencias entre líquidas (D127), sin ocurrencias de compromisos administrados por una meta (cuentan como aporte planificado, sin doble conteo) y sin montos `VARIABLE` (se informa cuántos, D115).
- **Consolidado honesto**: agregación por moneda antes de convertir, tasa de valoración vigente con fuente y antigüedad, sin 1:1, HALF_EVEN al presentar; faltante por moneda con indicación de "conviene convertir"; disponible negativo mostrado con signo y desglose.
- **Segunda vista "según tu presupuesto"**: el disponible del plan del periodo (FR-PLANNING-024 de Phase 2) junto al anterior; sin plan, ofrece crearlo.
- **Home**: Q5 habilitada (MODIFIED "Preguntas del Home sin datos o no disponibles": ya no queda ninguna pregunta no disponible por fase) y endpoint de detalle con el desglose.
- **Fuera de alcance:** horizonte "hasta el próximo ingreso esperado" y saldo esperado diario (cash-flow calendar de Phase 7, FR-REPORTING-014/015); "presupuesto restante de categorías esenciales" (docs/14 §4.2, requiere marcar categorías esenciales; Phase 7); gasto variable predicho (Phase 8); alertas de disponible negativo o riesgo de déficit (FR-REPORTING-015, Phase 7); read model materializado (lectura directa como D117).

## Capabilities

### New Capabilities

Ninguna: Q5 es un KPI del Home (FR-REPORTING-002 "disponible para gastar") y vive en `reporting/dashboard` (pregunta 9).

### Modified Capabilities
- `reporting/dashboard`: Q5 habilitada (MODIFIED "Preguntas del Home sin datos o no disponibles") y 11 requirements ADDED del disponible para gastar (8 Must, 3 Should).

## Impact

**Specs impactadas:** `reporting/dashboard` (1 MODIFIED, 11 ADDED). Lee `reporting/cash-flow-calendar` (mismas reglas de comprometido y valoración), `commitments/recurrence-engine` (ocurrencias no resueltas con cuenta, destino y `managedBy`), `transactions/transaction-recording` (pendientes), `ledger/balances` y `accounts/account-management` (saldos y liquidez), `goals/savings-goals` (reservado por cuenta y aportes planificados, de `add-savings-goals`), `planning/budgets` (disponible del plan), `planning/financial-periods` (periodo vigente), `identity/workspace-membership` (reserva mínima de liquidez), `fx/market-rates` y `fx/market-rate-providers` (valoración).

**Componentes/contextos impactados:** REPORTING: DS puro `SpendableCalculator` (términos por moneda, tope de reservas, exclusiones, faltante por moneda), query `GetSpendable` y bloque `spendable` del resumen del Home; métrica `reporting_spendable_duration_seconds`. COMMITMENTS: método público aditivo `CommittedQuery.listForSpendable` (ítems no resueltos y pendientes con cuenta, destino, liquidez y `managedBy`). IDENTITY: `WorkspaceSettingsQuery.minimumLiquidityReserve` en `contracts` (aditivo). GOALS: sin cambios (consume `GoalReservationsQuery` y `GoalPlansQuery` de `add-savings-goals`). PLANNING: sin cambios (consume `BudgetVsActualQuery`). `apps/web`: tarjeta Q5 del Home y vista de detalle.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `GET W/reports/spendable` (`getSpendable`, VIEWER) nuevo; aditivo: bloque `spendable` en `ReportSummary` y estado de Q5 en `homeQuestions`. Sin códigos de error nuevos.

**Tablas impactadas:** ninguna (lectura directa de las fuentes de verdad; nada se persiste).

**Eventos impactados:** ninguno producido ni consumido.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-REPORTING-SPENDABLE-001..015 (15). MODIFICADOS — TC-REPORTING-DASHBOARD-005 (Q5 deja de estar no disponible; lo actualiza el lead al consolidar). DEPRECADOS — ninguno.

**Impacto de regresión:** el Home ya no declara ninguna pregunta no disponible por fase (TC-REPORTING-DASHBOARD-005, TC-GOALS-SAVINGS-047). El resumen del Home suma una consulta a Commitments, Goals y Planning: vigilar NFR-PERF-004 (TC-REPORTING-KPI-* y TC-REPORTING-UPCOMING-* deben seguir en verde). El disponible del plan (`planning/budgets`) no cambia.

**Riesgos introducidos:** RISK-017 (multi-moneda: nunca 1:1, faltante por moneda), RISK-020 (periodo financiero y "hoy" en la zona del workspace), RISK-022 (lectura directa, sin lag; si el volumen crece, read model como D117), riesgo de producto de **doble conteo** entre comprometido y aportes a metas (excluido por `managedBy = GOAL`) y de **subestimar** gastos con tarjeta sin plan de pago (pregunta 5).

**Invariantes afectadas:** INV-001, INV-002 (Decimal con moneda), INV-025 (aislamiento por workspace). Ninguna escritura en el ledger ni en otras tablas.
