---
id: TC-DEBT-CARD-016
title: 'Pagar la parte en dólares con una conversión desde bolivianos'
spec: debt/credit-cards
related_specs: []
requirement: 'Pago de tarjeta como transferencia que no es gasto'
scenario: 'Parte en dólares pagada con bolivianos'
requirement_status: provisional
fr: ['FR-DEBT-014', 'FR-DEBT-016']
nfr: []
invariants: ['INV-010', 'INV-030']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'conversion']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Visa Oro USD" adeuda 100.00 USD'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
input:
  conversion: '980.00 BOB → 100.00 USD hacia Visa Oro USD, sin comisión'
steps:
  - 'Registrar la conversión'
  - 'Consultar el ciclo y el resumen del mes'
expected_result:
  - 'Visa Oro USD adeuda 0.00 USD'
  - 'El movimiento cuenta como pago (PAYMENT) del ciclo'
  - 'Gastos del mes sin cambios'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-016 — Pagar la parte en dólares con una conversión desde bolivianos

## Intención

AccountMovementsQuery clasifica la pata destino de una conversión hacia la tarjeta como pago.

## Escenario

```gherkin
Dado "Visa Oro USD" que adeuda 100.00 USD
Cuando convierto 980.00 BOB en 100.00 USD hacia la tarjeta
Entonces adeuda 0.00 USD y el movimiento es un pago del ciclo
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
