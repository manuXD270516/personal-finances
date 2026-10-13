---
id: TC-GOALS-SAVINGS-051
title: "Anular un aporte con un retiro posterior no se bloquea y deja la meta con fondos negativos marcados"
spec: goals/savings-goals
related_specs: ["transactions/transaction-recording"]
requirement: "Anulación o revisión de la transacción de un movimiento"
scenario: "Fondos negativos después de anular"
requirement_status: confirmed
fr: ["FR-GOALS-002", "FR-GOALS-005"]
nfr: []
invariants: ["INV-018"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/goals.api.test.ts
  - packages/contexts/goals/src/application/void-impact.test.ts
  - packages/contexts/goals/src/domain/void-impact-calculator.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["goals", "void", "negative-funds", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "\"Fondo de emergencia\" con aporte real de 1000.00 BOB en \"Ahorro BOB\" por la transferencia del 2026-10-01"
  - "Retiro de 400.00 BOB de \"Ahorro BOB\" el 2026-10-10"
input: {"contribution": "1000.00", "withdrawal": "400.00", "currency": "BOB"}
steps:
  - "Calcular el impacto de anular la transferencia del 2026-10-01"
  - "Anular la transferencia y aplicar la reacción de la meta"
expected_result:
  - "El impacto informa \"Fondo de emergencia\" en \"Ahorro BOB\": fondos actuales 600.00 BOB, después de anular −400.00 BOB, negativo"
  - "La anulación no se rechaza; la meta registra el inverso de −1000.00 BOB y su saldo acumulado es −400.00 BOB"
  - "El historial conserva aporte, retiro e inverso y la vista informa fondos negativos de −400.00 BOB en \"Ahorro BOB\""
created: 2026-10-13
updated: 2026-10-13
---

# TC-GOALS-SAVINGS-051 — Anular un aporte con un retiro posterior no se bloquea y deja la meta con fondos negativos marcados

## Intención

D222: anular un aporte del que ya se retiró una parte se avisa y no se bloquea. Antes no había aviso ni marca y el fondo quedaba negativo en silencio.

## Escenario

```gherkin
Dado "Fondo de emergencia" con 1000.00 BOB aportados y 400.00 BOB retirados en "Ahorro BOB"
Cuando se anula la transferencia del aporte
Entonces la meta registra el inverso de −1000.00 BOB
  Y informa fondos negativos de −400.00 BOB en "Ahorro BOB"
```

## Notas

- Test-first de `VoidImpactCalculator` y de la vista de la meta; la reacción a `TransactionVoided.v1` no cambia de conducta.
