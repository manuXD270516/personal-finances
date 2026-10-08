---
id: TC-TRANSACTIONS-RECONCILIATION-012
title: "La reconciliación no cambia transacciones ni ajustes de un periodo cerrado"
spec: transactions/reconciliation
related_specs: ["planning/month-closing"]
requirement: "Reconciliación y periodos cerrados"
scenario: "Finalizar con una transacción de un mes cerrado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-PLANNING-005]
nfr: []
invariants: [INV-015]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ["reconciliation", "period-closed"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Bloqueo de periodo 2026-03 en ledger.period_lock"
  - "Gasto cleared de 80.00 BOB del 2026-03-28 en \"Bank A\" no reconciliado"
  - "Sesión de \"Bank A\" al 2026-04-30 con diferencia 0.00 BOB"
  - "Sesión alternativa al 2026-03-31 con diferencia −5.00 BOB"
input:
  - "{\"session\":\"2026-04-30\",\"adjustment\":null}"
  - "{\"session\":\"2026-03-31\",\"adjustment\":{\"reason\":\"comisión\"}}"
  - "{\"action\":\"clear\",\"transaction\":\"gasto posted 2026-03-15\"}"
steps:
  - "Finalizar la sesión al 2026-04-30"
  - "Finalizar con ajuste la sesión al 2026-03-31"
  - "Marcar cleared un gasto posted de marzo"
expected_result:
  - "409 PERIOD_CLOSED con errors[] apuntando al gasto del 2026-03-28; sesión IN_PROGRESS"
  - "409 PERIOD_CLOSED; no se crea el ajuste"
  - "409 PERIOD_CLOSED; el gasto sigue posted"
  - "Sin auditoría ni eventos en los tres casos"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-012 — La reconciliación no cambia transacciones ni ajustes de un periodo cerrado

## Intención

INV-015 y extensión de D49 (pregunta abierta 1 de add-reconciliation): un mes cerrado no cambia en silencio.

## Escenario

```gherkin
Dado marzo de 2026 cerrado y un gasto cleared de 80.00 BOB del 2026-03-28
Cuando el usuario finaliza una sesión al 2026-04-30 que lo incluiría
Entonces se rechaza con "PERIOD_CLOSED"
  Y ninguna transacción queda reconciliada
```

## Notas

- Sin planning/financial-periods aplicado, insertar el bloqueo directamente en ledger.period_lock en el test.
