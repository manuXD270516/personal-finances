# Tareas

> Requiere aplicados `add-savings-goals` (consultas `GoalReservationsQuery` y `GoalPlansQuery`, `managedBy = GOAL`, y el delta previo de "Preguntas del Home sin datos o no disponibles"), `add-upcoming-payments`, `add-budgets`, `add-financial-periods`, `add-basic-dashboard` y `add-market-rate-providers`. Conviene aplicar antes `add-credit-cards` y `add-loans` (S4 de design.md) para verificar con los pagos reales del owner. No iniciar la implementación con las preguntas abiertas 1 y 2 de design.md sin resolver (forma de la respuesta y horizonte; docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner el delta de `reporting/dashboard` y las preguntas abiertas 1–10 de design.md; verificar con `openspec validate add-spendable-amount --strict`
- [ ] 1.2 Acordar con Commitments `CommittedQuery.listForSpendable` (S1) y con Identity `WorkspaceSettingsQuery.getMinimumLiquidityReserve` (S2); registrar el acuerdo en design.md
- [ ] 1.3 Revisar TC-REPORTING-SPENDABLE-001..015 contra los scenarios (cifras a mano: 15800 − 5000 − 3179 − 600 − 1500 = 5521.00; 199 + 180 + 300 + 2500 = 3179.00; 5521 − 120 = 5401.00; 15800 − 5000 − 3179 − 1500 − 1500 = 4621.00; 44.01 × 12.00 = 528.12 ⇒ 6049.12; −200 + 100 × 12 = 1000.00; 199 + 300 = 499 ⇒ 8201.00; 5521 − 500 = 5021.00), fechas fijas y `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` tras las decisiones; `pnpm traceability:check` sin errores
- [ ] 1.4 Actualizar TC-REPORTING-DASHBOARD-005 y TC-GOALS-SAVINGS-047 (Q5 deja de estar no disponible) junto con el delta MODIFIED

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 `SpendableCalculator` puro test-first: términos por moneda, tope del reservado por cuenta, exclusiones del comprometido (no líquidas, entre líquidas, `managedBy = GOAL`, `VARIABLE`), vencidos anteriores, pendientes hasta el fin del periodo, faltante por moneda y estado: TC-REPORTING-SPENDABLE-001..008, -010; PBT: el disponible por moneda es exactamente líquido − Σ términos y el consolidado de montos sin tasa nunca se convierte a 1:1
- [ ] 2.2 Consolidación con `FlowValuation`/valoración de saldos del Home (agregar por moneda antes de convertir, HALF_EVEN al presentar, negativos incluidos): TC-REPORTING-SPENDABLE-006, -007

## 3. APPLICATION

- [ ] 3.1 Commitments: `CommittedQuery.listForSpendable` (aditivo) sobre la misma lectura que `getForRange`, con cuentas, liquidez de origen y destino, `managedBy` y `overdueFromPrevious` (S1); tests de que `getForRange` (Q4) no cambia: TC-REPORTING-UPCOMING-* en verde
- [ ] 3.2 Identity: `WorkspaceSettingsQuery.getMinimumLiquidityReserve` (S2)
- [ ] 3.3 Reporting: `GetSpendable` (periodo vigente en la zona del workspace, lecturas por lote de Ledger, Accounts, Commitments, Goals, Planning e Identity en una transacción de lectura, una sola resolución de tasas) y bloque `spendable` + estado de Q5 en el resumen: TC-REPORTING-SPENDABLE-001, -009, -011, -012, -013, -015
- [ ] 3.4 Vista según el presupuesto con `BudgetVsActualQuery` (`NO_PLAN` con acción): TC-REPORTING-SPENDABLE-010

## 4. INFRASTRUCTURE

- [ ] 4.1 Adapters de las consultas nuevas (S1 en el repositorio de Commitments, S2 en Identity) con tests de integración Testcontainers (aislamiento por workspace: TC-REPORTING-SPENDABLE-013)
- [ ] 4.2 Métrica `reporting_spendable_duration_seconds` e inclusión en la expresión de la alerta `UpcomingPaymentsReadModelRecommended` (docs/18)

## 5. API

- [ ] 5.1 `GET W/reports/spendable` y `ReportSummary.spendable` en el contrato (aditivo, Spectral/Redocly válidos, `pnpm contract:breaking` sin rupturas): TC-REPORTING-SPENDABLE-001, -012, -013
- [ ] 5.2 Benchmark: resumen del Home con el bloque `spendable` p95 ≤ 300 ms con 40 cuentas, 300 ocurrencias en el periodo y 20 metas (NFR-PERF-004): TC-REPORTING-SPENDABLE-014

## 6. UI

- [ ] 6.1 Tarjeta Q5 del Home: cifra principal ("libre de compromisos") con desglose de términos, segunda vista "según tu presupuesto" o "Crear presupuesto", faltante por moneda con "conviene convertir", estado de alerta (texto + icono) para negativos, "N pagos sin monto" y "N tarjetas sin pago programado"; enlace a Q8 cerca del fin del periodo; i18n es/en/pt
- [ ] 6.2 Vista de detalle del disponible (ítems comprometidos, reservas por cuenta, aportes planificados por meta, tasas usadas con atribución)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-REPORTING-SPENDABLE-001..015 con el TC-ID en el nombre del test; actualizar el front matter
- [ ] 7.2 E2E: Home con cuentas, compromisos, una meta con reserva y plan, una tarjeta con plan de pago y reserva mínima; verificar la cifra y su desglose, reservar desde la meta y ver el cambio inmediato

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar los cambios de design.md § "Cambios a docs compartidos" (docs/00, 01, 03, 10, 14, 18, 28)
- [ ] 8.2 Actualizar la matriz de trazabilidad; ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
