---
id: TC-DEBT-SUMMARY-002
title: 'Sin tasa para el dólar el consolidado queda incompleto'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Total adeudado por moneda y en moneda base'
scenario: 'Sin tasa para el dólar'
requirement_status: provisional
fr: ['FR-DEBT-018', 'FR-FX-006']
nfr: []
invariants: ['INV-002']
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'fx']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Sin tasa de valoración USD/BOB vigente'
input:
  request: 'GET W/debts/summary'
steps:
  - 'Consultar el resumen'
expected_result:
  - 'Consolidado 48120.50 BOB, complete=false, unconverted [100.00 USD]'
  - 'Nunca 1:1'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-002 — Sin tasa para el dólar el consolidado queda incompleto

## Intención

RISK-017: no inventar tasas.

## Escenario

```gherkin
Dado que no hay tasa USD/BOB
Cuando consulto el resumen
Entonces el consolidado es 48120.50 BOB incompleto con 100.00 USD sin convertir
```

## Notas

- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
