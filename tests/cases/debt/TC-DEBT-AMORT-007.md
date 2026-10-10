---
id: TC-DEBT-AMORT-007
title: 'Con ACT/360 el interés usa los días reales sobre 360'
spec: debt/amortization
related_specs: []
requirement: 'Convención de días y periodicidad'
scenario: 'Primer interés con ACT/360'
requirement_status: provisional
fr: ['FR-DEBT-001', 'FR-DEBT-003']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'day-count']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el mismo préstamo con ACT/360'
expected_result:
  - 'El interés de la cuota 1 es 495.14 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-007 — Con ACT/360 el interés usa los días reales sobre 360

## Intención

Convención habitual en la banca boliviana; la cuota depende de la pregunta 1 de design.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el mismo préstamo con ACT/360
Entonces el interés de la cuota 1 es 495.14 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
