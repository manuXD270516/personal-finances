---
id: TC-DEBT-CARD-040
title: "El ciclo que contiene el saldo inicial de la cuenta lo cuenta en otros movimientos y se informa cuadrado"
spec: debt/credit-cards
related_specs: ["ledger/balances"]
requirement: "Resumen del ciclo y saldo al cierre"
scenario: "Ciclo que contiene el saldo inicial de la cuenta"
requirement_status: confirmed
fr: ["FR-DEBT-013", "FR-LEDGER-012"]
nfr: []
invariants: ["INV-022"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/card-cycle-calculator.test.ts
  - packages/contexts/debt/test/integration/pg-cards.int.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["credit-cards", "cycle", "opening-balance", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "\"Visa Oro BOB\" abierta el 2026-10-05 con saldo inicial adeudado 1200.00 BOB (asiento de apertura, sin transacción)"
  - "\"Visa Oro\" cierra el día 25"
input: {"openingBalance": "1200.00", "purchase": "350.00", "currency": "BOB"}
steps:
  - "Registrar una compra de 350.00 BOB el 2026-10-08"
  - "Calcular el ciclo del 2026-09-26 al 2026-10-25"
expected_result:
  - "Saldo anterior 0.00 BOB, compras 350.00 BOB, reembolsos 0.00 BOB, pagos 0.00 BOB, otros movimientos 1200.00 BOB y saldo al cierre 1550.00 BOB"
  - "El ciclo se informa cuadrado (`consistent = true`)"
  - "La métrica `debt_card_cycle_mismatch_total` no se incrementa"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-CARD-040 — El ciclo que contiene el saldo inicial de la cuenta lo cuenta en otros movimientos y se informa cuadrado

## Intención

El asiento de apertura no tiene transacción y no entraba en otros movimientos, así que el ciclo quedaba descuadrado aunque las cifras fueran correctas (docs/38 §4); con el defecto la métrica de descuadres contaba falsos positivos.

## Escenario

```gherkin
Dado "Visa Oro BOB" abierta el 2026-10-05 con 1200.00 BOB adeudados
  Y una compra de 350.00 BOB el 2026-10-08
Cuando se calcula el ciclo del 2026-09-26 al 2026-10-25
Entonces otros movimientos son 1200.00 BOB y el saldo al cierre 1550.00 BOB
  Y el ciclo se informa cuadrado
```

## Notas

- PBT en `CardCycleCalculator` con saldos iniciales aleatorios: la identidad del ciclo se cumple siempre.
