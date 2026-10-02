---
id: TC-PLATFORM-TRACE-004
title: El chequeo de trazabilidad falla cuando una pull request borra un TC que no está deprecado
spec: quality/test-traceability
related_specs: []
requirement: Los test cases se deprecan, no se borran en silencio
scenario: Se borra un test case activo
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
- scripts/traceability/test/deleted.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- traceability
- ci
error_code: null
preconditions:
- Rama base con un TC en status ready
- Diff de pull request que elimina ese archivo
input:
  command: pnpm traceability:check --base origin/main
steps:
- Ejecutar el chequeo con el diff que borra el TC activo
- Repetir con un diff que borra un TC con status deprecated, deprecated_by_change y deprecation_reason
expected_result:
- 'Borrado de TC activo: el chequeo termina con código distinto de cero e indica el ID borrado'
- 'Borrado de TC deprecated con motivo y change: el chequeo pasa'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-004 — El chequeo de trazabilidad falla cuando una pull request borra un TC que no está deprecado

## Intención

La historia de lo que se probó no puede desaparecer sin una decisión explícita registrada en un change.

## Escenario

```gherkin
Dada una pull request que elimina un archivo de test case cuyo estado no es "deprecated"
Cuando se ejecuta el chequeo de trazabilidad
Entonces el chequeo falla
```

## Notas

- Reglas de deprecación en docs/17 §5.
