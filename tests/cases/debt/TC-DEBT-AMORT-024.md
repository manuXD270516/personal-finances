---
id: TC-DEBT-AMORT-024
title: 'Capital fijo con cuota final balloon'
spec: debt/amortization
related_specs: []
requirement: 'Sistema de capital fijo con cuota final balloon'
scenario: 'Capital fijo con balloon'
requirement_status: provisional
fr: ['FR-DEBT-004']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'fixed-principal', 'balloon']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma de capital fijo de 10000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas con 500.00 BOB de principal por cuota'
expected_result:
  - 'La cuota 1 es 600.00 BOB (interés 100.00), la cuota 11 es 550.00 BOB (interés 50.00) y la cuota 12 es 4545.00 BOB (principal 4500.00, interés 45.00)'
  - 'El interés total es 870.00 BOB y la suma del principal es 10000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-024 — Capital fijo con cuota final balloon

## Intención

FR-DEBT-004: capital fijo definido por el usuario con cuota final balloon.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma de capital fijo de 10000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas con 500.00 BOB de principal por cuota
Entonces la cuota 1 es 600.00 BOB (interés 100.00), la cuota 11 es 550.00 BOB (interés 50.00) y la cuota 12 es 4545.00 BOB (principal 4500.00, interés 45.00)
  Y el interés total es 870.00 BOB y la suma del principal es 10000.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
