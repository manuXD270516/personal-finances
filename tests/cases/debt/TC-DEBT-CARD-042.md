---
id: TC-DEBT-CARD-042
title: "Un ciclo que no cuadra se marca consistent = false y cuenta la métrica debt_card_cycle_mismatch_total"
spec: debt/credit-cards
related_specs: []
requirement: "Resumen del ciclo y saldo al cierre"
scenario: "Ciclo de octubre de Visa Oro BOB"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/application/cards.service.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["credit-cards","cycle","metrics","fix-debt-cards-loans-gaps"]
error_code: null
preconditions:
  - "Un saldo del ledger de 10.00 BOB que ningún movimiento del ciclo explica"
input: {"unexplained": "10.00", "currency": "BOB"}
steps:
  - "Consultar la tarjeta"
expected_result:
  - "El ciclo abierto se informa `consistent = false`"
  - "La métrica `debt_card_cycle_mismatch_total` se incrementa en 1"
created: 2026-11-25
updated: 2026-11-25
---

# TC-DEBT-CARD-042 — Un ciclo que no cuadra se marca consistent = false y cuenta la métrica debt_card_cycle_mismatch_total

## Intención

El diseño de add-credit-cards pedía registrar la métrica cuando un cálculo real no cuadra; solo existía la bandera `consistent`.

## Escenario

```gherkin
Dado un saldo de 10.00 BOB sin movimiento que lo explique
Cuando se calcula el ciclo de la tarjeta
Entonces el ciclo se informa descuadrado y se cuenta en la métrica
```
