---
id: TC-TRANSACTIONS-BULK-008
title: "Una transacción de un mes cerrado bloquea toda la edición masiva"
spec: transactions/bulk-edit
related_specs: ["classification/categories"]
requirement: "Edición masiva y periodos cerrados"
scenario: "Recategorizar en lote incluyendo un gasto de un mes cerrado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-PLANNING-005]
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
tags: ["bulk-edit", "period-closed"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Bloqueo 2026-03 en ledger.period_lock"
  - "Gasto de 150.00 BOB del 2026-03-15 y gasto de 45.90 BOB del 2026-04-02, ambos \"Supermercado\""
input:
  changes: {"categoryId":"Hogar"}
steps:
  - "Enviar el lote con ambos gastos"
expected_result:
  - "409 PERIOD_CLOSED con errors[] para el gasto del 2026-03-15"
  - "Ninguno cambia de categoría; sin auditoría ni eventos"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-008 — Una transacción de un mes cerrado bloquea toda la edición masiva

## Intención

Decisión D49 aplicada en lote: los periodos cerrados no cambian en silencio.

## Escenario

```gherkin
Dado marzo de 2026 cerrado
Cuando el lote "categoría Hogar" incluye un gasto del 2026-03-15 y otro del 2026-04-02
Entonces se rechaza con "PERIOD_CLOSED"
  Y ninguno cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
