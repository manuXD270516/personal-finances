---
id: TC-DEBT-AMORT-025
title: 'Un capital fijo que agota el principal antes de la última cuota se rechaza'
spec: debt/amortization
related_specs: []
requirement: 'Sistema de capital fijo con cuota final balloon'
scenario: 'Capital fijo excesivo'
requirement_status: provisional
fr: ['FR-DEBT-004']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'fixed-principal', 'validation']
error_code: VALIDATION_FAILED
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se registra un préstamo de capital fijo de 10000.00 BOB en 12 cuotas con 1000.00 BOB de principal por cuota'
expected_result:
  - 'Se rechaza con `VALIDATION_FAILED` porque las primeras 11 cuotas suman 11000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-025 — Un capital fijo que agota el principal antes de la última cuota se rechaza

## Intención

Un balloon cero o negativo no es un cronograma válido.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se registra un préstamo de capital fijo de 10000.00 BOB en 12 cuotas con 1000.00 BOB de principal por cuota
Entonces se rechaza con `VALIDATION_FAILED` porque las primeras 11 cuotas suman 11000.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
