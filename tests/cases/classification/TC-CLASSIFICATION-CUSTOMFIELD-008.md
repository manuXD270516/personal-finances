---
id: TC-CLASSIFICATION-CUSTOMFIELD-008
title: "Archivar un custom field conserva sus valores y bloquea valores nuevos"
spec: classification/custom-fields
related_specs: []
requirement: "Archivar y desarchivar un custom field"
scenario: "Archivar el centro de costo"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009]
nfr: []
invariants: [INV-019]
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields", "archive"]
error_code: "CUSTOM_FIELD_ARCHIVED"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Gasto de 45.90 BOB con centro_costo = \"oficina\""
input:
  - "{\"action\":\"archive\"}"
  - "{\"create\":{\"centro_costo\":\"casa\"}}"
  - "{\"define\":{\"key\":\"centro_costo\"}}"
steps:
  - "Archivar \"centro_costo\""
  - "Consultar el gasto"
  - "Registrar un gasto con el campo archivado"
  - "Definir una nueva activa con la misma clave"
expected_result:
  - "El gasto sigue mostrando \"oficina\""
  - "El formulario no ofrece el campo"
  - "409 CUSTOM_FIELD_ARCHIVED"
  - "La nueva definición con la misma clave se acepta"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-008 — Archivar un custom field conserva sus valores y bloquea valores nuevos

## Intención

INV-019 aplicado a definiciones: archivar nunca borra historia.

## Escenario

```gherkin
Dado un gasto con "centro_costo" = "oficina"
Cuando el usuario archiva "centro_costo"
Entonces el gasto sigue mostrando "oficina"
  Y el formulario ya no ofrece el campo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
