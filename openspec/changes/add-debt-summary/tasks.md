# Tareas

> Requiere aplicados `add-loans` (contexto `@pf/debt`, `LoanPortfolioQuery` con las ampliaciones L1–L2 de design.md § Dependencias) y `add-credit-cards` (`CardPortfolioQuery`, `AccountMovementsQuery`, L3), además de `add-basic-dashboard`, `add-budgets` (`FlowValuation`, `REPORTING_RATE_VALIDITY_WINDOW`) y `add-classification`. Sin preguntas bloqueantes; confirmar las preguntas 1–6 de design.md antes de cerrar la spec.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `debt/loans` y `reporting/dashboard` y las preguntas abiertas 1–6; `openspec validate add-debt-summary --strict`
- [ ] 1.2 Acordar con `add-loans` las ampliaciones L1–L2 de `LoanPortfolioQuery` (cuenta y nombre, cuota próxima con pendiente y atraso, última cuota no pagada, interés imputado por rango) y verificar L3 con `add-credit-cards`; registrar el acuerdo en design.md
- [ ] 1.3 Revisar TC-DEBT-SUMMARY-001..010 contra los scenarios (cifras a mano: 45000.00 + 1120.50 + 2000.00 = 48120.50 BOB; 100.00 × 9.80 = 980.00 ⇒ 49100.50 BOB; 12.00 × 9.75 = 117.00 ⇒ 3367.40 BOB; 48120.50 − 1120.50 = 47000.00 BOB) con `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores

## 2. DOMAIN (TDD)

- [ ] 2.1 `DebtSummaryCalculator` (agrupación préstamo/tarjeta/otros, totales por moneda sin mezclar monedas, saldo a favor aparte, estados `NO_LIABILITIES`/`NO_DEBT`/`ACTIVE`) test-first: TC-DEBT-SUMMARY-001, -003, -010; PBT: Σ de los saldos listados por moneda = total por moneda
- [ ] 2.2 `InterestAttribution` (préstamos + tarjetas + otros = total por moneda; `attributionConsistent`) test-first: TC-DEBT-SUMMARY-004, -005; PBT de la suma
- [ ] 2.3 `DebtFreeDateEstimator` (préstamo, tarjeta con y sin cuotas, no estimables, sin deudas) test-first: TC-DEBT-SUMMARY-006
- [ ] 2.4 `UpcomingDebtDues` (uno por deuda, atrasados primero, emitido vs ciclo abierto estimado) test-first: TC-DEBT-SUMMARY-007

## 3. APPLICATION

- [ ] 3.1 Query `GetDebtSummary` (lecturas en lote, "hoy" y año en la zona del workspace, una sola resolución de tasas con `FlowValuation` para el total —fecha de hoy— y el interés —fecha de cada flujo—, `windowDays` de REPORTING): TC-DEBT-SUMMARY-001..007
- [ ] 3.2 Degradación sin préstamos o sin tarjetas implementados (cuentas `loan`/`credit_card` como "otros pasivos" no estimables): test de aplicación con dobles de puertos

## 4. INFRASTRUCTURE

- [ ] 4.1 Adapters de los puertos externos ya existentes (`AccountCatalogQuery`, `AccountBalancesQuery`, `NominalFlowQuery`, `CategoryCatalogQuery`, `FxValuationPort`, `WorkspaceCalendarQuery`) y de `AccountMovementsQuery` en el módulo de Debt; regla dependency-cruiser (solo `contracts` de otros contextos)
- [ ] 4.2 Test de integración Testcontainers: aislamiento entre workspaces (TC-DEBT-SUMMARY-008) y consistencia del total con los pasivos del patrimonio neto de `reporting/net-worth` (TC-DEBT-SUMMARY-001)

## 5. API

- [ ] 5.1 OpenAPI `getDebtSummary` y schema `DebtSummary` (design.md § Contratos); `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 5.2 Controller `debts` (VIEWER+, `ETag`) con tests de API: TC-DEBT-SUMMARY-001, -002, -008

## 6. UI

- [ ] 6.1 Tarjeta "Deudas" del Home (total consolidado con aviso de monedas sin convertir, interés del año, "libre de deudas en <mes año>" con excluidas, próximo vencimiento con enlace; estados sin pasivos y sin deudas pendientes sin ceros): TC-DEBT-SUMMARY-009, -010
- [ ] 6.2 `/debts` pestaña Resumen: tabla accesible por deuda y moneda, saldos a favor, desglose del interés, supuestos de la fecha estimada, todos los próximos vencimientos; i18n es/en/pt; axe y móvil

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E: con un préstamo, "Visa Oro" bimoneda y un pasivo manual, el Home muestra la tarjeta "Deudas" con las cifras de TC-DEBT-SUMMARY-009; pagar la tarjeta actualiza el total (TC-DEBT-SUMMARY-003)
- [ ] 7.2 Rendimiento: `GET W/debts/summary` p95 ≤ 300 ms con el seed `large`; regresión del Home (TC-REPORTING-DASHBOARD-*) en verde

## 8. DOCS

- [ ] 8.1 Aplicar § Cambios a docs compartidos de design.md (lo consolida el lead) y actualizar `docs/17`
- [ ] 8.2 Estados de TC-DEBT-SUMMARY-* a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-debt-summary --strict`
