---
id: TC-IDENTITY-DEMO-004
title: "El workspace de demostración se identifica como demo en la API y en la UI"
spec: identity/demo-data
related_specs: []
requirement: "Datos demo identificados como demo"
scenario: "El workspace demo se ve como demo"
requirement_status: confirmed
fr: ["FR-IDENTITY-014"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","ui"]
error_code: null
preconditions:
  - "El OWNER tiene \"W1 Personal Demo\" (real) y un workspace demo en estado READY"
input: {"action":"GET /me/workspaces y abrir el Home del workspace demo"}
steps:
  - "Listar los workspaces del usuario"
  - "Abrir el Home del workspace demo"
expected_result:
  - "La lista devuelve isDemo = true para el workspace demo y isDemo = false para W1"
  - "El Home del workspace demo muestra el indicador persistente \"Datos de demostración\""
  - "El selector de workspaces etiqueta el workspace demo"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-004 — El workspace de demostración se identifica como demo en la API y en la UI

## Intención

Los datos demo deben ser inconfundibles con los reales (D36).

## Escenario

```gherkin
Dado un workspace demo cargado
Cuando abro su Home
Entonces veo el indicador "Datos de demostración"
  Y la lista de workspaces lo marca como demo
```

## Notas

- El indicador no es descartable.
