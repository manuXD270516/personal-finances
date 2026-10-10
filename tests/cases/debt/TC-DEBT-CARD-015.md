---
id: TC-DEBT-CARD-015
title: 'Pagar la tarjeta no cuenta como gasto (exit criterion de Phase 4)'
spec: debt/credit-cards
related_specs: []
requirement: 'Pago de tarjeta como transferencia que no es gasto'
scenario: 'Pago del estado de cuenta desde el banco'
requirement_status: provisional
fr: ['FR-DEBT-014', 'FR-TRANSACTIONS-018']
nfr: []
invariants: ['INV-009', 'INV-030']
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 4
tags: ['credit-cards', 'exit-criterion', 'payment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - '"Banco BOB" con 5000.00 BOB'
  - '"Visa Oro BOB" adeuda 1520.50 BOB el 2026-11-10'
input:
  transfer: '1120.50 BOB de Banco BOB a Visa Oro BOB el 2026-11-10'
steps:
  - 'Registrar la transferencia desde "Pagar" en el detalle de la tarjeta'
  - 'Consultar el resumen del Home de noviembre, el patrimonio y el estado de cuenta'
expected_result:
  - 'Banco BOB 3879.50 BOB; Visa Oro BOB adeuda 400.00 BOB'
  - 'Estado de cuenta del 2026-10-25 PAID'
  - 'Gastos y ahorro de noviembre sin cambios; patrimonio sin cambios'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-015 — Pagar la tarjeta no cuenta como gasto (exit criterion de Phase 4)

## Intención

Exit criterion de docs/24 §5.4: los pagos de tarjeta no cuentan como gasto.

## Escenario

```gherkin
Dado "Visa Oro BOB" con un estado de cuenta de 1120.50 BOB
Cuando transfiero 1120.50 BOB desde "Banco BOB"
Entonces el estado queda PAID
  Y los gastos de noviembre no cambian
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
