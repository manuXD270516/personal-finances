---
id: TC-DEBT-CARD-011
title: 'Pago para no generar intereses, lo que falta y saldo a favor'
spec: debt/credit-cards
related_specs: []
requirement: 'Pago para no generar intereses y saldo pendiente'
scenario: 'Pago parcial después del cierre'
requirement_status: provisional
fr: ['FR-DEBT-013']
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'statement']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - 'Cuenta "Banco BOB" (bank, BOB, LIQUID) activa'
input:
  payment: '500.00 BOB el 2026-11-01'
  usdCredit: '-30.00 USD al cierre en "Visa Oro USD"'
steps:
  - 'Consultar el estado de cuenta cerrado el 2026-10-25'
  - 'Pagar 500.00 BOB el 2026-11-01 y consultar'
  - 'Consultar "Visa Oro USD" con saldo a favor'
expected_result:
  - 'Vence 2026-11-15, sin intereses 1120.50, mínimo 56.02 BOB'
  - 'Faltan 620.50 BOB sin intereses y 0.00 BOB de mínimo'
  - 'USD: saldo a favor 30.00 USD, mínimo y sin intereses 0.00 USD'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-011 — Pago para no generar intereses, lo que falta y saldo a favor

## Intención

Lo que falta pagar resta los pagos posteriores al cierre sin bajar de 0.

## Escenario

```gherkin
Dado el estado de cuenta de 1120.50 BOB
Cuando pago 500.00 BOB el 2026-11-01
Entonces faltan 620.50 BOB para no generar intereses y 0.00 BOB de mínimo
```

## Notas

- Cubre "Estado de cuenta de octubre" y "Saldo a favor".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
