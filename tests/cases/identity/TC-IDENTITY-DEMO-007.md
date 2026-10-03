---
id: TC-IDENTITY-DEMO-007
title: "Dos cargas con la misma ancla producen los mismos saldos y asientos balanceados"
spec: identity/demo-data
related_specs: ["ledger/journal-posting"]
requirement: "Contenido demo ficticio, realista y determinista"
scenario: "Dos cargas con la misma ancla producen los mismos saldos"
requirement_status: confirmed
fr: ["FR-IDENTITY-014","FR-LEDGER-001"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","determinism","golden"]
error_code: null
preconditions:
  - "Dataset demo versión 1 con golden summary"
  - "FixedClock; ancla 2026-09-30"
input: {"datasetVersion":"1","anchorDate":"2026-09-30","loads":2}
steps:
  - "Cargar la demo en un workspace demo A"
  - "Limpiar A y cargar la demo en un workspace demo B con la misma ancla"
  - "Comparar saldos por cuenta y moneda con el golden summary"
expected_result:
  - "A y B tienen las mismas cuentas con los mismos saldos por moneda, iguales al golden summary"
  - "Cada asiento de A y de B suma 0 por moneda"
  - "Las instituciones son ficticias (p. ej. \"Banco Andino Demo\") y los identificadores de cuenta empiezan con DEMO-"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-007 — Dos cargas con la misma ancla producen los mismos saldos y asientos balanceados

## Intención

La demo sirve como oráculo de reportes y de UI solo si es reproducible y pasa por las mismas invariantes que los datos reales (docs/29 §3).

## Escenario

```gherkin
Dado el dataset demo versión 1 y la ancla 2026-09-30
Cuando cargo la demo dos veces en workspaces distintos
Entonces ambos tienen los mismos saldos que el golden summary
  Y todos los asientos suman 0 por moneda
```

## Notas

- Cubre también el scenario "Instituciones ficticias".
- La segunda carga exige limpiar la primera (límite de un demo por usuario).
