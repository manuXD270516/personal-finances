---
id: TC-DEBT-SUMMARY-006
title: 'Fecha estimada libre de deudas con pasivos no estimables y cuotas'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Fecha estimada libre de deudas'
scenario: 'Con un pasivo no estimable'
requirement_status: provisional
fr: ['FR-DEBT-018']
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
tags: ['debt-summary', 'payoff-date']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Última cuota no pagada de "Préstamo auto" el 2029-06-05'
  - 'Saldo de "Visa Oro" facturado en el estado que vence el 2026-11-15'
input:
  variants: 'con Deuda familiar; Deuda familiar saldada; Visa Oro solo con Laptop en 3 cuotas; sin deudas'
steps:
  - 'Estimar en cada variante'
expected_result:
  - '2029-06-05 sin contar "Deuda familiar"; "Visa Oro" 2026-11-15'
  - 'Saldada: 2029-06-05 sin excluidas'
  - 'Laptop: "Visa Oro" 2027-01-15'
  - 'Sin deudas: estado NO_DEBT sin fecha'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-006 — Fecha estimada libre de deudas con pasivos no estimables y cuotas

## Intención

Responder "¿cuándo termino?" con supuestos explícitos.

## Escenario

```gherkin
Dado un préstamo que termina el 2029-06-05 y un pasivo sin cronograma
Cuando estimo la fecha libre de deudas
Entonces es 2029-06-05 sin contar "Deuda familiar"
```

## Notas

- Cubre "Todas las deudas estimables", "Tarjeta con cuotas pendientes" y "Sin deudas".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
