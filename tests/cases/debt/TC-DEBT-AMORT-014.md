---
id: TC-DEBT-AMORT-014
title: 'Los datos descriptivos de un préstamo activo se editan sin tocar el cronograma'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma fijado como versión inmutable'
scenario: 'Renombrar un préstamo activo'
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
tags: ['amortization', 'versioning']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR renombra el "Préstamo vehicular" a "Auto 2026"'
expected_result:
  - 'El préstamo se llama "Auto 2026" y su cronograma versión 1 no cambia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-014 — Los datos descriptivos de un préstamo activo se editan sin tocar el cronograma

## Intención

La protección es solo de condiciones financieras.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR renombra el "Préstamo vehicular" a "Auto 2026"
Entonces el préstamo se llama "Auto 2026" y su cronograma versión 1 no cambia
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
