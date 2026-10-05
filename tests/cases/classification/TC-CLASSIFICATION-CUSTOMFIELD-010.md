---
id: TC-CLASSIFICATION-CUSTOMFIELD-010
title: "No se cambian custom fields de transacciones de un mes cerrado"
spec: classification/custom-fields
related_specs: ["planning/month-closing"]
requirement: "Custom fields de transacciones en periodos cerrados"
scenario: "Cambiar el centro de costo en marzo cerrado"
requirement_status: provisional
fr: [FR-CLASSIFICATION-009, FR-PLANNING-005]
nfr: []
invariants: [INV-015]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields", "period-closed"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Bloqueo 2026-03 en ledger.period_lock"
  - "Gasto de 150.00 BOB del 2026-03-15 con centro_costo = \"casa\""
input:
  customFields: [{"field":"centro_costo","value":"oficina"}]
steps:
  - "Cambiar el valor"
expected_result:
  - "409 PERIOD_CLOSED; valor \"casa\"; sin auditoría"
created: 2026-10-05
updated: 2026-10-05
---

# TC-CLASSIFICATION-CUSTOMFIELD-010 — No se cambian custom fields de transacciones de un mes cerrado

## Intención

Extensión de D49 a custom fields (pregunta abierta 2 de add-custom-fields).

## Escenario

```gherkin
Dado marzo de 2026 cerrado
Cuando el usuario cambia "centro_costo" de un gasto del 2026-03-15
Entonces se rechaza con "PERIOD_CLOSED"
  Y el valor no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
