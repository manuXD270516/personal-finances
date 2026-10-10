---
id: TC-DEBT-AMORT-042
title: 'Avalanche y snowball con un extra mensual entre dos préstamos'
spec: debt/amortization
related_specs: []
requirement: 'Estrategias avalanche y snowball entre préstamos'
scenario: 'Avalanche frente a snowball'
requirement_status: provisional
fr: ['FR-DEBT-010']
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
tags: ['amortization', 'simulator', 'strategies']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Hay dos préstamos franceses en BOB con primera cuota el 2026-11-15, "A" de 3000.00 BOB al 12.00 % a 12 cuotas de 266.55 BOB y "B" de 12000.00 BOB al 24.00 % a 24 cuotas de 634.45 BOB, y el VIEWER simula 500.00 BOB extra por mes'
expected_result:
  - 'Sin extra el interés total es 3425.46 BOB y la fecha libre de deudas 2028-10-15'
  - 'Avalanche da 1815.57 BOB de interés (ahorro 1609.89 BOB) y snowball 2000.08 BOB (ahorro 1425.38 BOB), ambos libres de deudas el 2027-11-15, con snowball saldando "A" el 2027-03-15'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-042 — Avalanche y snowball con un extra mensual entre dos préstamos

## Intención

FR-DEBT-010: estrategias entre deudas con su interés total, fechas y ahorro.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando hay dos préstamos franceses en BOB con primera cuota el 2026-11-15, "A" de 3000.00 BOB al 12.00 % a 12 cuotas de 266.55 BOB y "B" de 12000.00 BOB al 24.00 % a 24 cuotas de 634.45 BOB, y el VIEWER simula 500.00 BOB extra por mes
Entonces sin extra el interés total es 3425.46 BOB y la fecha libre de deudas 2028-10-15
  Y avalanche da 1815.57 BOB de interés (ahorro 1609.89 BOB) y snowball 2000.08 BOB (ahorro 1425.38 BOB), ambos libres de deudas el 2027-11-15, con snowball saldando "A" el 2027-03-15
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
- Cifras verificadas con un cálculo de referencia independiente (Decimal, HALF_EVEN, 30/360).
