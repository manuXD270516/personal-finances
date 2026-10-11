---
id: TC-DEBT-AMORT-003
title: 'Con tasa cero la cuota es el principal dividido y la última absorbe el residuo'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma French de cuota constante'
scenario: 'Tasa cero'
requirement_status: confirmed
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/amortization-calculator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'french', 'edge']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma francés de 1000.00 BOB al 0.00 % en 3 cuotas mensuales'
expected_result:
  - 'Las cuotas son 333.33, 333.33 y 333.34 BOB sin interés'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-003 — Con tasa cero la cuota es el principal dividido y la última absorbe el residuo

## Intención

La fórmula francesa se indetermina con tasa cero (0/0); el caso especial debe existir.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma francés de 1000.00 BOB al 0.00 % en 3 cuotas mensuales
Entonces las cuotas son 333.33, 333.33 y 333.34 BOB sin interés
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
