---
id: TC-IDENTITY-DEMO-009
title: "Una segunda carga con un workspace demo vigente se rechaza"
spec: identity/demo-data
related_specs: []
requirement: "Un workspace demo activo por usuario"
scenario: "Segunda carga rechazada"
requirement_status: confirmed
fr: ["FR-IDENTITY-016"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data"]
error_code: DEMO_WORKSPACE_ALREADY_EXISTS
preconditions:
  - "El OWNER tiene un workspace demo en estado READY"
input: {"action":"POST W1/demo-data"}
steps:
  - "El OWNER solicita otra carga de datos de demostración"
expected_result:
  - "Respuesta 409 con code DEMO_WORKSPACE_ALREADY_EXISTS"
  - "No se crea otro workspace"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-009 — Una segunda carga con un workspace demo vigente se rechaza

## Intención

Evita acumular workspaces demo olvidados.

## Escenario

```gherkin
Dado que ya tengo un workspace demo listo
Cuando vuelvo a cargar los datos de demostración
Entonces se rechaza con DEMO_WORKSPACE_ALREADY_EXISTS
```

## Notas

- Tras la limpieza (CLEANING/PURGED) se permite una nueva carga.
