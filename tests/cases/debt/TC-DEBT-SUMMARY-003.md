---
id: TC-DEBT-SUMMARY-003
title: 'Saldo a favor aparte y pago reflejado de inmediato'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Total adeudado por moneda y en moneda base'
scenario: 'Saldo a favor en la tarjeta en dólares'
requirement_status: provisional
fr: ['FR-DEBT-018']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'credit-balance']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Tasa de valoración USD/BOB de hoy 9.80'
input:
  creditUsd: '"Visa Oro USD" con saldo a favor de 30.00 USD'
  payment: 'transferencia 1120.50 BOB Banco BOB → Visa Oro BOB'
steps:
  - 'Consultar con el saldo a favor en USD'
  - 'Postear el pago de la tarjeta en BOB y volver a consultar'
expected_result:
  - 'USD total 0.00, consolidado 48120.50 BOB, saldo a favor 30.00 USD aparte'
  - 'Tras el pago: BOB total 47000.00 y "Visa Oro BOB" ya no se lista'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-003 — Saldo a favor aparte y pago reflejado de inmediato

## Intención

Un crédito no reduce lo que se debe en otra deuda; el resumen se calcula al consultar.

## Escenario

```gherkin
Dado "Visa Oro USD" con 30.00 USD a favor
Cuando consulto el resumen
Entonces el saldo a favor aparece aparte y no resta del total
```

## Notas

- Cubre "Pago reflejado de inmediato".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
