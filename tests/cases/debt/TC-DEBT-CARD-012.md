---
id: TC-DEBT-CARD-012
title: 'Estados PAID, PARTIALLY_PAID y OVERDUE al vencer'
spec: debt/credit-cards
related_specs: []
requirement: 'Estado del estado de cuenta'
scenario: 'Mínimo no cubierto'
requirement_status: provisional
fr: ['FR-DEBT-013']
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
tags: ['credit-cards', 'statement-status']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
input:
  A: 'pago 1120.50 el 2026-11-10'
  B: 'pago 500.00 el 2026-11-01; hoy 2026-11-16'
  C: 'pago 30.00 el 2026-11-01; hoy 2026-11-16'
steps:
  - 'Evaluar el estado en cada caso'
expected_result:
  - 'A: PAID'
  - 'B: PARTIALLY_PAID con 620.50 BOB pendientes'
  - 'C: OVERDUE con 26.02 BOB pendientes del mínimo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-012 — Estados PAID, PARTIALLY_PAID y OVERDUE al vencer

## Intención

El estado se deriva de lo que falta y del día de vencimiento en la zona del workspace.

## Escenario

```gherkin
Dado un estado de cuenta con mínimo 56.02 BOB
Cuando solo se pagaron 30.00 BOB y es el 2026-11-16
Entonces queda OVERDUE con 26.02 BOB pendientes del mínimo
```

## Notas

- Cubre "Pagado completo antes del vencimiento" y "Pago parcial al vencer".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
