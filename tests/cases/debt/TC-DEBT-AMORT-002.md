---
id: TC-DEBT-AMORT-002
title: 'Cronograma francés de 50000.00 BOB a 24 cuotas con cuota 2342.02'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma French de cuota constante'
scenario: 'Préstamo vehicular a 24 cuotas'
requirement_status: provisional
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: ['INV-017']
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'french']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma francés de 50000.00 BOB al 11.50 % nominal anual, 30/360, mensual, 24 cuotas con primera cuota el 2026-11-15'
expected_result:
  - 'La cuota es 2342.02 BOB, la cuota 1 tiene interés 479.17 BOB y principal 1862.85 BOB y la cuota 2 interés 461.31 BOB y principal 1880.71 BOB'
  - 'La cuota 24 del 2028-10-15 es de 2341.90 BOB (principal 2319.67, interés 22.23) y el interés total es 6208.36 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-002 — Cronograma francés de 50000.00 BOB a 24 cuotas con cuota 2342.02

## Intención

Caso realista de plazo largo; verifica cuota, primeras cuotas, última y total de intereses.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma francés de 50000.00 BOB al 11.50 % nominal anual, 30/360, mensual, 24 cuotas con primera cuota el 2026-11-15
Entonces la cuota es 2342.02 BOB, la cuota 1 tiene interés 479.17 BOB y principal 1862.85 BOB y la cuota 2 interés 461.31 BOB y principal 1880.71 BOB
  Y la cuota 24 del 2028-10-15 es de 2341.90 BOB (principal 2319.67, interés 22.23) y el interés total es 6208.36 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
