---
id: TC-PLATFORM-TRACE-005
title: El chequeo de trazabilidad falla indicando archivo y campo cuando un TC no declara el requirement
spec: quality/test-traceability
related_specs: []
requirement: Catálogo versionado de test cases
scenario: Test case sin un campo obligatorio
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-005
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- traceability
- schema
error_code: null
preconditions:
- Repositorio fixture con un TC cuyo front matter omite el campo requirement
input:
  command: pnpm traceability:check
  missing_field: requirement
steps:
- Ejecutar el chequeo de trazabilidad sobre el fixture
expected_result:
- El chequeo termina con código distinto de cero
- El reporte cita la regla R6, la ruta del archivo y el campo requirement
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-005 — El chequeo de trazabilidad falla indicando archivo y campo cuando un TC no declara el requirement

## Intención

El catálogo solo sirve como documentación viva si cada caso cumple el schema (docs/17 §4.1).

## Escenario

```gherkin
Dado un archivo de test case que no declara el requirement referenciado
Cuando se ejecuta el chequeo de trazabilidad
Entonces falla indicando el archivo y el campo faltante
```

## Notas

- Regla R6 de docs/17 §6.
