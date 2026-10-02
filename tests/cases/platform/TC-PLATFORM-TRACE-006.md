---
id: TC-PLATFORM-TRACE-006
title: El pipeline publica la matriz de trazabilidad con cada TC y su estado de automatización
spec: quality/test-traceability
related_specs:
- platform/delivery-pipeline
requirement: Matriz de trazabilidad generada
scenario: Matriz producida
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-005
invariants: []
priority: high
type: platform
level: smoke
automation_status: automated
automated_tests:
- scripts/traceability/test/matrix.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- traceability
- ci
error_code: null
preconditions:
- Pipeline de pull request con el paso de generación de trazabilidad
input:
  artifacts:
  - tests/traceability/matrix.md
  - tests/traceability/matrix.json
steps:
- Ejecutar el pipeline de pull request
- Descargar el artefacto de la matriz
- Comparar los TC listados con los archivos de tests/cases
expected_result:
- El build publica matrix.md (legible) y matrix.json (procesable) como artefactos
- Cada TC catalogado aparece con su automation_status
- La matriz enlaza FR/NFR → requirement → scenario → TC → test automatizado
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-006 — El pipeline publica la matriz de trazabilidad con cada TC y su estado de automatización

## Intención

La matriz convierte la cadena de trazabilidad en un artefacto auditable en cada ejecución.

## Escenario

```gherkin
Dada una pull request
Cuando se ejecuta el pipeline
Entonces la matriz se publica como artefacto del build
  Y lista cada test case catalogado con su estado de automatización
```

## Notas

- matrix.json se valida contra su schema en el mismo paso.
