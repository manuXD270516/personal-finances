---
id: TC-FX-COST-005
title: "Cualquier miembro consulta el análisis por API, sin efectos y sin datos de otro workspace"
spec: fx/conversion-pricing
related_specs: []
requirement: "Análisis de costo solo de lectura y aislado por workspace"
scenario: "Otro workspace"
requirement_status: provisional
fr: ["FR-FX-011"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "authorization", "isolation"]
error_code: null
preconditions:
  - "W1 con las conversiones de TC-FX-COST-001..003; W2 con conversiones por \"Binance P2P\" en \"2026-10\""
input: {"from": "2026-10-01", "to": "2026-10-31"}
steps:
  - "GET W/reports/conversion-costs como VIEWER de W1"
  - "Repetir como OWNER"
  - "Comparar conversiones y tasas antes y después"
expected_result:
  - "200 con los grupos de W1 y ninguna conversión de W2"
  - "Mismas cifras para VIEWER y OWNER"
  - "Ningún dato cambia; rango de más de 24 periodos: 422 VALIDATION_FAILED"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-005 — Cualquier miembro consulta el análisis por API, sin efectos y sin datos de otro workspace

## Intención

Lectura para todos los miembros con RLS (INV-025).

## Escenario

```gherkin
Dado W1 y W2 con conversiones
Cuando un VIEWER de W1 consulta
Entonces solo ve las de W1
```

## Notas

