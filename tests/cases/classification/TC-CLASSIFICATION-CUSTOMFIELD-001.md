---
id: TC-CLASSIFICATION-CUSTOMFIELD-001
title: "Definir un custom field de selección para transacciones"
spec: classification/custom-fields
related_specs: []
requirement: "Definir un custom field"
scenario: "Definir el centro de costo de las transacciones"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace \"W1\" sin custom fields; usuario EDITOR"
input:
  - "{\"key\":\"centro_costo\",\"label\":\"Centro de costo\",\"dataType\":\"SELECT\",\"target\":\"TRANSACTION\",\"required\":false,\"options\":[{\"key\":\"casa\",\"label\":\"Casa\"},{\"key\":\"oficina\",\"label\":\"Oficina\"}]}"
  - "{\"key\":\"proyecto\",\"dataType\":\"SELECT\",\"options\":[]}"
steps:
  - "POST W/custom-fields con la primera definición"
  - "GET W/custom-fields?target=TRANSACTION"
  - "POST con la segunda definición"
expected_result:
  - "201 con la definición activa y sus dos opciones"
  - "Aparece en el listado de transacciones"
  - "Segunda: 400 VALIDATION_FAILED"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-001 — Definir un custom field de selección para transacciones

## Intención

FR-CLASSIFICATION-009: definiciones tipadas con objetivo y opciones.

## Escenario

```gherkin
Dado un workspace sin custom fields
Cuando el usuario define "centro_costo" de tipo selección con "casa" y "oficina"
Entonces la definición queda activa con esas opciones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
