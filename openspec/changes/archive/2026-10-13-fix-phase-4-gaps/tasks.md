# Tareas

> Alcance de D222 (por omisión, revertible). Sin deltas sobre `debt/loans` ni `debt/amortization` hasta el archivado encadenado de Phase 4 (D219). Sin preguntas bloqueantes (design.md, preguntas 1 y 2).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas de `debt/credit-cards` y `goals/savings-goals`; `openspec validate fix-phase-4-gaps --strict` Nota 2026-10-13: `openspec validate fix-phase-4-gaps --strict` válido.
- [x] 1.2 Revisar TC-DEBT-CARD-038..040, TC-GOALS-SAVINGS-051..053, TC-DEBT-LOAN-053..054 y TC-DEBT-AMORT-045 contra los scenarios (cifras a mano: 0.00 + 350.00 + 1200.00 = 1550.00 BOB; 600.00 − 1000.00 = −400.00 BOB) con `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` Nota 2026-10-13: los 9 TC pasan a `requirement_status: confirmed` y `automated`; cifras revisadas con `FixedClock` en America/La_Paz.

## 2. DOMAIN (TDD)

- [x] 2.1 `CardCycleCalculator`: el asiento de apertura de la cuenta entra en "otros movimientos" del ciclo que contiene su fecha; test-first TC-DEBT-CARD-040; PBT de la identidad del ciclo con saldos iniciales aleatorios Nota 2026-10-13: `computeCycleFigures` acepta `openingNet`; TC-DEBT-CARD-040 y PBT con saldos iniciales aleatorios en verde.
- [x] 2.2 `NextDueResolver` (próximo vencimiento ≥ hoy, ciclos sin estado emitido excluidos, estados atrasados aparte); test-first TC-DEBT-CARD-038, TC-DEBT-CARD-039; PBT: el resultado nunca es anterior a hoy Nota 2026-10-13: `resolveNextDue` (domain/next-due-resolver.ts); TC-DEBT-CARD-038 y -039 y PBT (nunca anterior a hoy) en verde.
- [x] 2.3 `VoidImpactCalculator` (fondos por meta y cuenta tras anular un aporte o un retiro); test-first TC-GOALS-SAVINGS-051 Nota 2026-10-13: `calculateVoidImpact` (domain/void-impact-calculator.ts); TC-GOALS-SAVINGS-051 y PBT en verde.

## 3. APPLICATION

- [x] 3.1 Vista de tarjeta con `nextDueDate` de `NextDueResolver` y `overdueStatements[]`; revisar los consumidores de `CardPortfolioQuery` (Q5, Q8, resumen de deudas) Nota 2026-10-13: `nextDueOf` en card-views.ts; `CardPortfolioQuery` (Q5, Q8 y resumen de deudas) no usaba `nextDueDate` (usa último estado y ciclo abierto), sin cambios; detalle de tarjeta calcula con `historyCycles` y el listado con 1 ciclo cerrado (los atrasados más antiguos solo salen en el detalle).
- [x] 3.2 Query `PreviewTransactionVoidImpact` y `negativeFunds[]` en la vista de la meta (TC-GOALS-SAVINGS-051, TC-GOALS-SAVINGS-052) Nota 2026-10-13: `GoalsQueries.previewVoidImpact` y `negativeFunds[]` (en `Goal`, así lista y detalle); TC-GOALS-SAVINGS-051 y -052 en verde.
- [x] 3.3 `ListLoans` con los campos de la lista (próxima cuota, saldo de la cuenta, principal pendiente) sin cambiar su conducta (TC-DEBT-LOAN-053) Nota 2026-10-13: `LoansQueries.list` devuelve `LoanListItemView` con `figuresOf` compartido con `get` (mismas cifras por construcción); sin cambio en specs de `debt/loans`.

## 4. INFRASTRUCTURE

- [x] 4.1 Lectura de los asientos de apertura por cuenta y rango desde LEDGER por contrato público (`OpeningBalanceQuery` aditiva o el dato en `AccountMovementsQuery`); `pnpm arch:check` sin violaciones Nota 2026-10-13: `LedgerOpeningEntriesQuery` (ledger/contracts, aditiva) y `PgLedgerOpeningEntriesQuery`; `pnpm arch:check` sin violaciones.
- [x] 4.2 Test de integración: ciclo con saldo inicial cuadrado y métrica `debt_card_cycle_mismatch_total` sin incrementar (TC-DEBT-CARD-040) Nota 2026-10-13: tests de integración escritos (ledger `pg-ledger.int.test.ts` y debt `pg-cards.int.test.ts`); sin Docker en este entorno, los valida CI. La métrica `debt_card_cycle_mismatch_total` no existe en el código (el motor solo expone `consistent`), por lo que se verifica `consistent = true`.

## 5. API

- [x] 5.1 OpenAPI: `previewTransactionVoidImpact` (`GET W/goals/void-impact`), `CardAccount.overdueStatements[]`, `GoalDetail.negativeFunds[]` e ítems de `LoanList` ampliados; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas Nota 2026-10-13: OpenAPI aditivo (`previewTransactionVoidImpact`, `CardOverdueStatement`, `Goal.negativeFunds` y tres propiedades opcionales en `Loan`: con `allOf` oasdiff las contaba como rotura, por eso no hay esquema `LoanListItem`); Spectral y Redocly sin errores; `pnpm contract:breaking` lo valida CI.
- [x] 5.2 Tests de API: TC-DEBT-CARD-038, TC-DEBT-CARD-039, TC-GOALS-SAVINGS-052, TC-DEBT-LOAN-053 Nota 2026-10-13: tests de API escritos en credit-cards, goals y loans `api.test.ts`; sin Docker, los valida CI.

## 6. UI

- [x] 6.1 Detalle de tarjeta: próximo vencimiento y estados atrasados con su estado y faltante; i18n es/en/pt Nota 2026-10-13: `OverdueStatements` en el detalle y marca en el listado; i18n es/en/pt.
- [x] 6.2 Diálogo de anulación de transacciones: aviso con la meta, la cuenta y los fondos resultantes antes de confirmar; detalle de la meta con el faltante (TC-GOALS-SAVINGS-053) Nota 2026-10-13: `VoidImpactNotice` en el diálogo de anulación de `TransactionDetail` y `NegativeFundsNotice` en el detalle de la meta; i18n es/en/pt.
- [x] 6.3 Lista de préstamos con una sola llamada y edición del préstamo en borrador con vista previa del cronograma (TC-DEBT-LOAN-053, TC-DEBT-LOAN-054); axe y móvil Nota 2026-10-13: `LoansList` hace una sola llamada; `DraftEditPanel` edita todas las condiciones del borrador con `PATCH` + `If-Match` y vista previa en vivo. Verificación axe/móvil en el e2e (CI).

## 7. TESTS AUTOMATIZADOS y E2E

- [x] 7.1 E2E: anular un aporte con un retiro posterior muestra el aviso, la anulación se completa y la meta muestra el faltante (TC-GOALS-SAVINGS-053); editar un borrador de préstamo (TC-DEBT-LOAN-054); con `PF_E2E_PROJECT` Nota 2026-10-13: e2e escritos en goals.spec.ts y loans.spec.ts; sin Docker no corrieron aquí, los valida CI.
- [x] 7.2 Rendimiento: `POST W/loans/payoff-simulations` p95 < 300 ms con 10 préstamos en la suite `perf` nightly, con timeout explícito (TC-DEBT-AMORT-045) Nota 2026-10-13: benchmark en apps/api/test/perf/loan-simulator.perf.ts (nightly) y verificación del cálculo puro en payoff-simulator.test.ts; el perf nightly no corrió aquí (sin Docker).
- [x] 7.3 Regresión en verde: TC-DEBT-CARD-\*, TC-GOALS-SAVINGS-\*, TC-REPORTING-SPENDABLE-\*, TC-REPORTING-UPCOMING-\*, TC-DEBT-SUMMARY-\* Nota 2026-10-13: pruebas unitarias y de aplicación de TC-DEBT-CARD-*, TC-GOALS-SAVINGS-*, TC-DEBT-SUMMARY-*, TC-REPORTING-* en verde; integración y e2e los valida CI.

## 8. DOCS

- [x] 8.1 docs/38 §4: quitar los puntos corregidos (lo hace la sesión principal al cerrar); docs/10 (endpoint y campos nuevos) Nota 2026-10-13: docs/10 actualizado; docs/38 lo actualiza la sesión principal al cerrar.
- [x] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate fix-phase-4-gaps --strict` Nota 2026-10-13: estados de los TC en `automated`; `traceability:check`, `format:check` y `spec validate` en verde.
