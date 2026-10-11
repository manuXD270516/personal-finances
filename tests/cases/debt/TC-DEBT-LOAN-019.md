---
id: TC-DEBT-LOAN-019
title: 'El interés cuenta como gasto del mes y el principal no'
spec: debt/loans
related_specs: ['reporting/dashboard', 'planning/budgets']
requirement: 'Gastos del préstamo en los reportes'
scenario: 'Gasto de noviembre con una cuota pagada'
requirement_status: confirmed
fr: ['FR-DEBT-007', 'FR-DEBT-002']
nfr: []
invariants: ['INV-009']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/transactions/src/application/loans.service.test.ts
  - packages/contexts/transactions/src/domain/loan-transactions.test.ts
  - packages/contexts/transactions/test/integration/pg-loans.int.test.ts
  - tests/e2e/specs/loans.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'reporting']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'En noviembre de 2026 la única transacción es el pago de la cuota 1 de 2342.02 BOB (principal 1862.85 BOB e interés 479.17 BOB)'
expected_result:
  - 'El gasto de noviembre es 479.17 BOB en "Intereses pagados"'
  - 'Los ingresos de noviembre no cambian y el patrimonio neto baja exactamente 479.17 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-019 — El interés cuenta como gasto del mes y el principal no

## Intención

docs/14: Expenses incluye intereses y cargos de préstamos y excluye el principal; los flujos nominales deben incluir los kinds de préstamo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando en noviembre de 2026 la única transacción es el pago de la cuota 1 de 2342.02 BOB (principal 1862.85 BOB e interés 479.17 BOB)
Entonces el gasto de noviembre es 479.17 BOB en "Intereses pagados"
  Y los ingresos de noviembre no cambian y el patrimonio neto baja exactamente 479.17 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
