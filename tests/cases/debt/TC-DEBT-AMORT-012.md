---
id: TC-DEBT-AMORT-012
title: 'La vista previa calcula el cronograma sin persistir nada'
spec: debt/amortization
related_specs: []
requirement: 'Vista previa del cronograma'
scenario: 'Vista previa sin efectos'
requirement_status: provisional
fr: ['FR-DEBT-003']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'preview']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El VIEWER pide la vista previa de 1000.00 BOB al 12.00 % a 3 cuotas mensuales'
expected_result:
  - 'Recibe las cuotas 340.02, 340.02 y 340.03 BOB y no se crea ningún préstamo ni transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-012 — La vista previa calcula el cronograma sin persistir nada

## Intención

El usuario revisa antes de registrar; la vista previa usa el mismo calculador.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el VIEWER pide la vista previa de 1000.00 BOB al 12.00 % a 3 cuotas mensuales
Entonces recibe las cuotas 340.02, 340.02 y 340.03 BOB y no se crea ningún préstamo ni transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
