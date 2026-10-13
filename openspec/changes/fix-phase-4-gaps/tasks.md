# Tareas

> Alcance de D222 (por omisión, revertible). Sin deltas sobre `debt/loans` ni `debt/amortization` hasta el archivado encadenado de Phase 4 (D219). Sin preguntas bloqueantes (design.md, preguntas 1 y 2).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `debt/credit-cards` y `goals/savings-goals`; `openspec validate fix-phase-4-gaps --strict`
- [ ] 1.2 Revisar TC-DEBT-CARD-038..040, TC-GOALS-SAVINGS-051..053, TC-DEBT-LOAN-053..054 y TC-DEBT-AMORT-045 contra los scenarios (cifras a mano: 0.00 + 350.00 + 1200.00 = 1550.00 BOB; 600.00 − 1000.00 = −400.00 BOB) con `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `CardCycleCalculator`: el asiento de apertura de la cuenta entra en "otros movimientos" del ciclo que contiene su fecha; test-first TC-DEBT-CARD-040; PBT de la identidad del ciclo con saldos iniciales aleatorios
- [ ] 2.2 `NextDueResolver` (próximo vencimiento ≥ hoy, ciclos sin estado emitido excluidos, estados atrasados aparte); test-first TC-DEBT-CARD-038, TC-DEBT-CARD-039; PBT: el resultado nunca es anterior a hoy
- [ ] 2.3 `VoidImpactCalculator` (fondos por meta y cuenta tras anular un aporte o un retiro); test-first TC-GOALS-SAVINGS-051

## 3. APPLICATION

- [ ] 3.1 Vista de tarjeta con `nextDueDate` de `NextDueResolver` y `overdueStatements[]`; revisar los consumidores de `CardPortfolioQuery` (Q5, Q8, resumen de deudas)
- [ ] 3.2 Query `PreviewTransactionVoidImpact` y `negativeFunds[]` en la vista de la meta (TC-GOALS-SAVINGS-051, TC-GOALS-SAVINGS-052)
- [ ] 3.3 `ListLoans` con los campos de la lista (próxima cuota, saldo de la cuenta, principal pendiente) sin cambiar su conducta (TC-DEBT-LOAN-053)

## 4. INFRASTRUCTURE

- [ ] 4.1 Lectura de los asientos de apertura por cuenta y rango desde LEDGER por contrato público (`OpeningBalanceQuery` aditiva o el dato en `AccountMovementsQuery`); `pnpm arch:check` sin violaciones
- [ ] 4.2 Test de integración: ciclo con saldo inicial cuadrado y métrica `debt_card_cycle_mismatch_total` sin incrementar (TC-DEBT-CARD-040)

## 5. API

- [ ] 5.1 OpenAPI: `previewTransactionVoidImpact` (`GET W/goals/void-impact`), `CardAccount.overdueStatements[]`, `GoalDetail.negativeFunds[]` e ítems de `LoanList` ampliados; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 5.2 Tests de API: TC-DEBT-CARD-038, TC-DEBT-CARD-039, TC-GOALS-SAVINGS-052, TC-DEBT-LOAN-053

## 6. UI

- [ ] 6.1 Detalle de tarjeta: próximo vencimiento y estados atrasados con su estado y faltante; i18n es/en/pt
- [ ] 6.2 Diálogo de anulación de transacciones: aviso con la meta, la cuenta y los fondos resultantes antes de confirmar; detalle de la meta con el faltante (TC-GOALS-SAVINGS-053)
- [ ] 6.3 Lista de préstamos con una sola llamada y edición del préstamo en borrador con vista previa del cronograma (TC-DEBT-LOAN-053, TC-DEBT-LOAN-054); axe y móvil

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E: anular un aporte con un retiro posterior muestra el aviso, la anulación se completa y la meta muestra el faltante (TC-GOALS-SAVINGS-053); editar un borrador de préstamo (TC-DEBT-LOAN-054); con `PF_E2E_PROJECT`
- [ ] 7.2 Rendimiento: `POST W/loans/payoff-simulations` p95 < 300 ms con 10 préstamos en la suite `perf` nightly, con timeout explícito (TC-DEBT-AMORT-045)
- [ ] 7.3 Regresión en verde: TC-DEBT-CARD-\*, TC-GOALS-SAVINGS-\*, TC-REPORTING-SPENDABLE-\*, TC-REPORTING-UPCOMING-\*, TC-DEBT-SUMMARY-\*

## 8. DOCS

- [ ] 8.1 docs/38 §4: quitar los puntos corregidos (lo hace la sesión principal al cerrar); docs/10 (endpoint y campos nuevos)
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate fix-phase-4-gaps --strict`
