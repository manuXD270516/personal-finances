---
id: TC-DEBT-AMORT-008
title: 'Periodicidad trimestral con 4 cuotas'
spec: debt/amortization
related_specs: []
requirement: 'Convención de días y periodicidad'
scenario: 'Cuotas trimestrales'
requirement_status: provisional
fr: ['FR-DEBT-001', 'FR-DEBT-003']
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
tags: ['amortization', 'frequency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se calcula el cronograma francés de 12000.00 BOB al 12.00 % anual, 30/360, trimestral, 4 cuotas desde el 2027-01-15'
expected_result:
  - 'Las cuotas son 3228.32, 3228.32, 3228.32 y 3228.34 BOB con intereses 360.00, 273.95, 185.32 y 94.03 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-008 — Periodicidad trimestral con 4 cuotas

## Intención

La tasa del periodo depende de las cuotas por año.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se calcula el cronograma francés de 12000.00 BOB al 12.00 % anual, 30/360, trimestral, 4 cuotas desde el 2027-01-15
Entonces las cuotas son 3228.32, 3228.32, 3228.32 y 3228.34 BOB con intereses 360.00, 273.95, 185.32 y 94.03 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
