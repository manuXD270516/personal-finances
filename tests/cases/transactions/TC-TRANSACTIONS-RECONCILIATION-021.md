---
id: TC-TRANSACTIONS-RECONCILIATION-021
title: "Conciliar sin extracto una transacción de un mes cerrado se rechaza con PERIOD_CLOSED"
spec: transactions/reconciliation
related_specs: ["planning/month-closing"]
requirement: "Reconciliación y periodos cerrados"
scenario: "Conciliar sin extracto en un mes cerrado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-PLANNING-005]
nfr: []
invariants: [INV-015]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["without-statement", "period-closed"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Cuenta \"Caja BOB\" (ASSET, BOB, ACTIVE, sin sesiones) con saldo inicial 500.00 BOB"
  - "Gasto C1 de 80.00 BOB del 2026-03-12 en \"Caja BOB\""
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "C1 cleared"
  - "Periodo \"2026-03\" cerrado (fila en ledger.period_lock)"
input:
  patch: {"status": "RECONCILED", "reconciliationMode": "WITHOUT_STATEMENT"}
steps:
  - "Conciliar sin extracto C1"
expected_result:
  - "409 PERIOD_CLOSED"
  - "C1 sigue cleared, sin modo ni marca; sin auditoría, transición ni outbox"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-021 — Conciliar sin extracto una transacción de un mes cerrado se rechaza con PERIOD_CLOSED

## Intención

Decisión docs/33 D65 (alcance de la edición en periodos cerrados) aplicada al modo nuevo de D74: el snapshot de cierre registró el estado de conciliación y no debe cambiar en silencio.

## Escenario

```gherkin
Dado marzo de 2026 cerrado y un gasto cleared de 80.00 BOB del 2026-03-12
Cuando el usuario lo concilia sin extracto
Entonces se rechaza con "PERIOD_CLOSED"
  Y el gasto sigue cleared
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
