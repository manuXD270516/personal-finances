---
id: TC-PLANNING-ACTUAL-001
title: 'El gastado neto incluye reembolsos y excluye pendientes y anuladas'
spec: planning/budgets
related_specs: ['transactions/transaction-recording']
requirement: 'Gasto real derivado de transacciones posteadas'
scenario: 'Reembolso, pendiente y anulada'
requirement_status: provisional
fr: ['FR-PLANNING-023', 'FR-PLANNING-024']
nfr: []
invariants: ['INV-023', 'INV-034']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'refund']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - '"Restaurantes" con máximo 600.00 BOB'
input:
  posted: '300.00 BOB'
  refund: '50.00 BOB'
  pending: '80.00 BOB'
  voided: '120.00 BOB'
steps:
  - 'Registrar los cuatro movimientos en noviembre'
  - 'Consultar el plan'
expected_result:
  - 'Gastado de "Restaurantes" 250.00 BOB'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-ACTUAL-001 — El gastado neto incluye reembolsos y excluye pendientes y anuladas

## Intención

INV-034: los actuales se derivan de transacciones posteadas; pendientes y anuladas no tienen asiento activo (INV-023).

## Escenario

```gherkin
Dado un gasto posteado de 300.00 BOB, un reembolso de 50.00 BOB, un gasto pendiente de 80.00 BOB y uno anulado de 120.00 BOB en "Restaurantes"
Cuando consulto el plan
Entonces el gastado de "Restaurantes" es 250.00 BOB
```

## Notas

