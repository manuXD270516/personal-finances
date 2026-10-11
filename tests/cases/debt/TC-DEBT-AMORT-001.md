---
id: TC-DEBT-AMORT-001
title: 'Cronograma francés dorado de docs/09: 340.02, 340.02 y 340.03'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma French de cuota constante'
scenario: 'Tres cuotas al 1 % mensual'
requirement_status: confirmed
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: ['INV-017', 'INV-001']
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/amortization-calculator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'french', 'golden']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma francés de 1000.00 BOB al 12.00 % nominal anual, 30/360, mensual, 3 cuotas desde el 2026-11-15'
expected_result:
  - 'Las cuotas son 340.02 BOB (principal 330.02, interés 10.00), 340.02 BOB (principal 333.32, interés 6.70) y 340.03 BOB (principal 336.66, interés 3.37)'
  - 'Los saldos tras cada cuota son 669.98, 336.66 y 0.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-001 — Cronograma francés dorado de docs/09: 340.02, 340.02 y 340.03

## Intención

Test dorado de la tabla de referencia de docs/09 §12; ancla del calculador.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma francés de 1000.00 BOB al 12.00 % nominal anual, 30/360, mensual, 3 cuotas desde el 2026-11-15
Entonces las cuotas son 340.02 BOB (principal 330.02, interés 10.00), 340.02 BOB (principal 333.32, interés 6.70) y 340.03 BOB (principal 336.66, interés 3.37)
  Y los saldos tras cada cuota son 669.98, 336.66 y 0.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
