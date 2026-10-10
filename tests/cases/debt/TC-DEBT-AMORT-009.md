---
id: TC-DEBT-AMORT-009
title: 'Vencimientos del día 31 caen el último día de los meses cortos'
spec: debt/amortization
related_specs: []
requirement: 'Fechas de vencimiento de las cuotas'
scenario: 'Primera cuota el día 31'
requirement_status: provisional
fr: ['FR-DEBT-001']
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
tags: ['amortization', 'dates']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Un préstamo mensual tiene primera cuota el 2027-01-31'
expected_result:
  - 'Las cuotas 2, 3 y 4 vencen el 2027-02-28, el 2027-03-31 y el 2027-04-30'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-009 — Vencimientos del día 31 caen el último día de los meses cortos

## Intención

RISK-020: fin de mes, mismo criterio que el motor de recurrencia.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando un préstamo mensual tiene primera cuota el 2027-01-31
Entonces las cuotas 2, 3 y 4 vencen el 2027-02-28, el 2027-03-31 y el 2027-04-30
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
