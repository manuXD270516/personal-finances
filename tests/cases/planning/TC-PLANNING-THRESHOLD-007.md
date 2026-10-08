---
id: TC-PLANNING-THRESHOLD-007
title: 'Bajar el máximo de una línea reevalúa y emite el umbral recién cruzado'
spec: planning/budgets
related_specs: []
requirement: 'Cambio del planificado reevalúa los umbrales'
scenario: 'Bajar el máximo cruza el 90 %'
requirement_status: confirmed
fr: ['FR-PLANNING-022']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'thresholds']
error_code: null
preconditions:
  - '"Restaurantes" máximo 600.00 BOB con gastado 470.00 BOB (78.3 %), cruces de 50 y 75 % registrados'
input:
  change: 'máximo 600.00 → 500.00 BOB'
steps:
  - 'El EDITOR cambia el máximo'
expected_result:
  - 'En la misma operación se emite un único hecho de umbral 90 % con reference 500.00 BOB y actual 470.00 BOB (94.0 %)'
  - 'No se re-emiten 50 ni 75 %'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-THRESHOLD-007 — Bajar el máximo de una línea reevalúa y emite el umbral recién cruzado

## Intención

Un cambio de planificado puede cruzar umbrales sin gasto nuevo.

## Escenario

```gherkin
Dado "Restaurantes" con gastado 470.00 BOB y máximo 600.00 BOB
Cuando el EDITOR baja el máximo a 500.00 BOB
Entonces se emite un único hecho de umbral 90 %
```

## Notas

