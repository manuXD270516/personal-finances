---
id: TC-DEBT-AMORT-019
title: 'El reporte sugiere la convención que explica las diferencias'
spec: debt/amortization
related_specs: []
requirement: 'Explicación sugerida de las diferencias'
scenario: 'El banco usa ACT/365'
requirement_status: provisional
fr: ['FR-DEBT-003']
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
tags: ['amortization', 'comparison', 'suggestions']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo está registrado con 30/360 y los intereses de la referencia del banco son iguales en las 24 cuotas a los del cálculo con ACT/365 (488.36 BOB en la cuota 1 frente a 479.17 BOB con 30/360)'
expected_result:
  - 'El reporte sugiere que la convención ACT/365 coincide en más cuotas que 30/360 y que las diferencias están en el interés'
  - 'El préstamo sigue registrado con 30/360'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-019 — El reporte sugiere la convención que explica las diferencias

## Intención

Ayuda a explicar diferencias sin cambiar el préstamo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo está registrado con 30/360 y los intereses de la referencia del banco son iguales en las 24 cuotas a los del cálculo con ACT/365 (488.36 BOB en la cuota 1 frente a 479.17 BOB con 30/360)
Entonces el reporte sugiere que la convención ACT/365 coincide en más cuotas que 30/360 y que las diferencias están en el interés
  Y el préstamo sigue registrado con 30/360
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
