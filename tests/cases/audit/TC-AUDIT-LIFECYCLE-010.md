---
id: TC-AUDIT-LIFECYCLE-010
title: "El recorrido de una tasa corregida muestra su reemplazo sin modificarla"
spec: audit/lifecycle-timeline
related_specs: ["fx/market-rates"]
requirement: "Recorrido de una tasa de cambio"
scenario: "Tasa corregida por reemplazo"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-FX-002","FR-FX-003"]
nfr: []
invariants: ["INV-011"]
priority: medium
type: api
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["lifecycle","fx"]
error_code: null
preconditions:
  - "Workspace W1 con USDT habilitado"
input: {"rate":{"pair":"USDT/BOB","type":"P2P","value":"6.95","asOf":"2026-03-15"},"correction":{"value":"6.96"}}
steps:
  - "Registrar la tasa"
  - "Corregirla a 6.96"
  - "Consultar el recorrido de la tasa 6.95"
expected_result:
  - "RECORD (∅ → RECORDED)"
  - "SUPERSEDE (RECORDED → SUPERSEDED) con detailRefs.supersededByRateId = id de la tasa 6.96"
  - "La tasa 6.95 conserva su valor original"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-010 — El recorrido de una tasa corregida muestra su reemplazo sin modificarla

## Intención

Las tasas son inmutables (INV-011); el recorrido explica por qué una tasa dejó de usarse.

## Escenario

```gherkin
Dada la tasa USDT/BOB P2P 6.95
Cuando la corrijo a 6.96
Entonces su recorrido muestra registrar y reemplazar enlazado a 6.96
```

## Notas

