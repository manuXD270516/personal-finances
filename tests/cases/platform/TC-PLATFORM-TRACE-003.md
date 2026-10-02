---
id: TC-PLATFORM-TRACE-003
title: El chequeo de trazabilidad falla y lista el requirement cuando un requirement Must no tiene TC activo
spec: quality/test-traceability
related_specs: []
requirement: Los requirements Must están cubiertos
scenario: Requirement Must sin cobertura
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-004
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
- ci
error_code: null
preconditions:
- 'Repositorio fixture con una spec que declara un requirement con Priority: Must sin ningún TC que lo referencie'
input:
  command: pnpm traceability:check
  requirement: fixture/capability#Requirement sin cobertura
steps:
- Ejecutar el chequeo de trazabilidad sobre el fixture
- Repetir con el único TC del requirement marcado deprecated
expected_result:
- El chequeo termina con código distinto de cero
- El reporte cita la regla R2 y lista spec y nombre del requirement
- Un TC deprecated no cuenta como cobertura
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-003 — El chequeo de trazabilidad falla y lista el requirement cuando un requirement Must no tiene TC activo

## Intención

Todo requirement Must de una fase implementada debe estar protegido por al menos un caso (NFR-MAINT-004).

## Escenario

```gherkin
Dado un requirement Must sin ningún test case no deprecado que lo referencie
Cuando se ejecuta el chequeo de trazabilidad
Entonces falla listando el requirement
```

## Notas

- Regla R2 de docs/17 §6.
