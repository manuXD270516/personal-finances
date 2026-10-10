---
id: TC-DEBT-LOAN-035
title: 'Las ocurrencias de cuotas se generan desde el calendario explícito hasta el horizonte'
spec: commitments/recurrence-engine
related_specs: ['debt/loans']
requirement: 'Cuotas de préstamo administradas por el contexto de deudas'
scenario: 'Calendario de cuotas generado hasta el horizonte'
requirement_status: provisional
fr: ['FR-DEBT-011', 'FR-COMMITMENTS-001']
nfr: []
invariants: ['INV-013']
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['commitments', 'loans']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Hoy es 2026-10-15, el horizonte es de 90 días y el "Préstamo vehicular" crea su definición de cuotas con 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB) desde el 2026-11-15'
expected_result:
  - 'Existen ocurrencias programadas para el 2026-11-15, el 2026-12-15 y el 2027-01-15 por 2342.02 BOB cada una'
  - 'La ocurrencia del 2027-02-15 se genera cuando el horizonte la alcanza'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-035 — Las ocurrencias de cuotas se generan desde el calendario explícito hasta el horizonte

## Intención

N3: el compromiso del préstamo usa fechas y montos explícitos, generados idempotentemente (INV-013).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando hoy es 2026-10-15, el horizonte es de 90 días y el "Préstamo vehicular" crea su definición de cuotas con 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB) desde el 2026-11-15
Entonces existen ocurrencias programadas para el 2026-11-15, el 2026-12-15 y el 2027-01-15 por 2342.02 BOB cada una
  Y la ocurrencia del 2027-02-15 se genera cuando el horizonte la alcanza
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
