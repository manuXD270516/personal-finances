---
id: TC-DEBT-AMORT-043
title: 'Los préstamos de otra moneda quedan fuera de la estrategia'
spec: debt/amortization
related_specs: []
requirement: 'Estrategias avalanche y snowball entre préstamos'
scenario: 'Préstamo en otra moneda'
requirement_status: provisional
fr: ['FR-DEBT-010']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'simulator', 'multi-currency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Además existe un préstamo de 5000.00 USD y el VIEWER simula 500.00 BOB extra por mes'
expected_result:
  - 'El préstamo en USD figura fuera de la estrategia y conserva su cronograma vigente'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-043 — Los préstamos de otra moneda quedan fuera de la estrategia

## Intención

Pregunta 4: no se mezclan monedas en la estrategia.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando además existe un préstamo de 5000.00 USD y el VIEWER simula 500.00 BOB extra por mes
Entonces el préstamo en USD figura fuera de la estrategia y conserva su cronograma vigente
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
