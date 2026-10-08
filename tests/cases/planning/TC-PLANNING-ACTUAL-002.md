---
id: TC-PLANNING-ACTUAL-002
title: 'Una transferencia solo afecta el presupuesto por su comisión'
spec: planning/budgets
related_specs: ['transactions/transfers']
requirement: 'Gasto real derivado de transacciones posteadas'
scenario: 'Transferencia sin efecto en el plan'
requirement_status: confirmed
fr: ['FR-PLANNING-023']
nfr: []
invariants: ['INV-009', 'INV-034']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'actual', 'transfer', 'fees']
error_code: null
preconditions:
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - 'Plan con líneas "Restaurantes" y la categoría de sistema de comisiones'
input:
  transfer: '500.00 BOB Banco BOB → Caja BOB 2026-11-05'
  fee: '2.00 BOB'
steps:
  - 'Registrar la transferencia con comisión'
  - 'Consultar el plan'
expected_result:
  - 'Ninguna línea cambia salvo la de comisiones, que suma 2.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTUAL-002 — Una transferencia solo afecta el presupuesto por su comisión

## Intención

El principal de transferencias no es gasto (docs/14 §4.3); su comisión sí.

## Escenario

```gherkin
Dado el plan de "2026-11"
Cuando se transfieren 500.00 BOB de "Banco BOB" a "Caja BOB" con comisión de 2.00 BOB
Entonces solo la línea de comisiones suma 2.00 BOB
```

## Notas

