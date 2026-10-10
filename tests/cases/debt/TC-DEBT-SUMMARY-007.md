---
id: TC-DEBT-SUMMARY-007
title: 'Próximo vencimiento de cada deuda con atrasados primero'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Próximos vencimientos de deudas'
scenario: 'Cuota y estados de cuenta de noviembre'
requirement_status: provisional
fr: ['FR-DEBT-018', 'FR-DEBT-013', 'FR-DEBT-011']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'dues']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Cuota 13 de "Préstamo auto" 1850.00 BOB el 2026-11-05'
  - 'Estados de "Visa Oro" al 2026-11-15: 1120.50 BOB (mín. 56.02) y 100.00 USD (mín. 10.00)'
input:
  today: '2026-10-28 y 2026-11-07'
steps:
  - 'Consultar el 2026-10-28'
  - 'Consultar el 2026-11-07 sin pagar la cuota 13'
expected_result:
  - 'Orden: Préstamo auto 2026-11-05 1850.00 BOB; Visa Oro 2026-11-15 1120.50 BOB (mín. 56.02); Visa Oro 2026-11-15 100.00 USD (mín. 10.00); sin "Deuda familiar"'
  - '2026-11-07: Préstamo auto primero, atrasado 2 días con 1850.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-007 — Próximo vencimiento de cada deuda con atrasados primero

## Intención

Un solo lugar para los vencimientos de todas las deudas.

## Escenario

```gherkin
Dado la cuota del 2026-11-05 y los estados de cuenta del 2026-11-15
Cuando consulto los próximos vencimientos
Entonces aparece primero "Préstamo auto" y luego "Visa Oro" en BOB y USD
```

## Notas

- Cubre "Cuota atrasada primero".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
