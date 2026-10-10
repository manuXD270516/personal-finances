---
id: TC-DEBT-CARD-019
title: 'Recordatorio de vencimiento una sola vez y no para estados pagados'
spec: debt/credit-cards
related_specs: []
requirement: 'Recordatorio de vencimiento de la tarjeta'
scenario: 'Tres días antes'
requirement_status: provisional
fr: ['FR-DEBT-013', 'FR-NOTIFY-004', 'FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'reminder']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - 'reminderDays 3'
input:
  today: '2026-11-12 y 2026-11-13'
steps:
  - 'Correr debt.card-daily el 2026-11-12 y el 2026-11-13'
  - 'Repetir con el estado pagado el 2026-11-10'
expected_result:
  - 'Un único CardPaymentDue.v1 para (Visa Oro BOB, 2026-10-25) con 1120.50 y 56.02 BOB'
  - 'Ningún recordatorio si el estado está PAID'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-019 — Recordatorio de vencimiento una sola vez y no para estados pagados

## Intención

FR-DEBT-013 pide recordatorio de vencimiento; debe ser exactamente uno por estado de cuenta.

## Escenario

```gherkin
Dado un estado de cuenta que vence el 2026-11-15 sin pagar
Cuando el job corre el 2026-11-12 y el 2026-11-13
Entonces se publica un solo recordatorio
```

## Notas

- Cubre "Proceso repetido" y "Ya pagado".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
