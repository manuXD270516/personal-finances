---
id: TC-DEBT-AMORT-036
title: 'La vista previa del prepago compara ambas opciones sin persistir'
spec: debt/amortization
related_specs: []
requirement: 'Vista previa del recálculo'
scenario: 'Comparar las dos opciones del prepago'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'prepayment', 'preview']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR pide la vista previa de un pago extraordinario de 3000.00 BOB el 2027-01-15 en el préstamo de 12000.00 BOB con 3 cuotas pagadas'
expected_result:
  - 'Ve reducir plazo: cuota 1066.19 BOB, fin 2027-07-15, ahorro 247.49 BOB; y reducir cuota: cuota 715.96 BOB, fin 2027-10-15, ahorro 151.99 BOB'
  - 'El cronograma vigente no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-036 — La vista previa del prepago compara ambas opciones sin persistir

## Intención

El usuario elige con el ahorro a la vista.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR pide la vista previa de un pago extraordinario de 3000.00 BOB el 2027-01-15 en el préstamo de 12000.00 BOB con 3 cuotas pagadas
Entonces ve reducir plazo: cuota 1066.19 BOB, fin 2027-07-15, ahorro 247.49 BOB; y reducir cuota: cuota 715.96 BOB, fin 2027-10-15, ahorro 151.99 BOB
  Y el cronograma vigente no cambia
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
