# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 TC-DEBT-CARD-041, TC-DEBT-CARD-042 y TC-DEBT-LOAN-055 en `tests/cases/debt/` — 2026-11-25: sin delta de spec (el comportamiento ya está definido)

## 2. PRUEBAS primero (rojo)

- [x] 2.1 `[TC-DEBT-CARD-041]` y `[TC-DEBT-CARD-042]` en `cards.service.test.ts`; `[TC-DEBT-LOAN-055]` en `loans.queries.list.test.ts` y en `pg-debt.int.test.ts` — 2026-11-25: 041 en rojo sobre `main` (el listado devolvía `overdueStatements` vacío)

## 3. IMPLEMENTACIÓN

- [x] 3.1 Listado de tarjetas con la ventana completa de ciclos — 2026-11-25
- [x] 3.2 Contador `debt_card_cycle_mismatch_total` y cableado OTel — 2026-11-25
- [x] 3.3 Lectura en lote de cuotas y pagos en `LoansQueries.list` — 2026-11-25: sin migración

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 Gates: format, typecheck, lint, test, build, arch:check, traceability:check, spec:validate, config:docs:check, contract:breaking y `pnpm test:integration` — 2026-11-25: ver el informe de cierre
