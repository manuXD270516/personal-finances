---
id: TC-CLASSIFICATION-TAG-001
title: Crear un tag con color y rechazar un nombre equivalente ya activo
spec: classification/tags
related_specs: []
requirement: Gestión de tags
scenario: Nombre de tag duplicado
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [tags]
error_code: NAME_TAKEN
preconditions:
- Tag activo "Trabajo"
input:
- create:
    name: Viaje Santa Cruz 2026
    color: '#1565C0'
- create:
    name: trabajo
steps:
- Crear cada tag
expected_result:
- '"Viaje Santa Cruz 2026" responde 201 activo con color "#1565C0"'
- '"trabajo" responde 409 NAME_TAKEN'
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-TAG-001 — Crear un tag con color y rechazar un nombre equivalente ya activo

## Intención

FR-CLASSIFICATION-008: nombre único entre activos, insensible a mayúsculas y acentos.

## Escenario

```gherkin
Dado el tag activo "Trabajo"
Cuando el usuario crea "trabajo"
Entonces se rechaza con "NAME_TAKEN"
```
