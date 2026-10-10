---
id: TC-DEBT-LOAN-034
title: 'El recorrido del préstamo muestra sus transiciones y los pagos como anotaciones'
spec: debt/loans
related_specs: ['audit/lifecycle-timeline']
requirement: 'Recorrido del préstamo'
scenario: 'Recorrido de un préstamo saldado'
requirement_status: provisional
fr: ['FR-DEBT-001', 'FR-AUDIT-009']
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'lifecycle']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 1000.00 BOB se registró el 2026-10-10, se desembolsó el 2026-10-15 y se saldó con la cuota 3 el 2027-01-15'
expected_result:
  - 'Su recorrido muestra en orden: borrador (EDITOR, 2026-10-10), activo por desembolso (EDITOR, 2026-10-15) y saldado (EDITOR, 2027-01-15), con los tres pagos como anotaciones'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-034 — El recorrido del préstamo muestra sus transiciones y los pagos como anotaciones

## Intención

D37: el ciclo de vida del préstamo es una máquina de estados trazable.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 1000.00 BOB se registró el 2026-10-10, se desembolsó el 2026-10-15 y se saldó con la cuota 3 el 2027-01-15
Entonces su recorrido muestra en orden: borrador (EDITOR, 2026-10-10), activo por desembolso (EDITOR, 2026-10-15) y saldado (EDITOR, 2027-01-15), con los tres pagos como anotaciones
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
