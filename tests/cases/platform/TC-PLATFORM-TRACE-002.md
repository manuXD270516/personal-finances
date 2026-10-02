---
id: TC-PLATFORM-TRACE-002
title: El chequeo de trazabilidad falla si un test referencia un TC-ID inexistente en el catálogo
spec: quality/test-traceability
related_specs: []
requirement: Los tests automatizados referencian IDs de test case
scenario: Identificador desconocido en un test
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
- ci
error_code: null
preconditions:
- Repositorio fixture consistente salvo un test titulado [TC-LEDGER-FOO-999] sin archivo de caso
input:
  command: pnpm traceability:check
  test_name: '[TC-LEDGER-FOO-999] algo'
steps:
- Ejecutar el chequeo de trazabilidad sobre el repositorio fixture
expected_result:
- El chequeo termina con código distinto de cero
- El reporte cita la regla R4, el ID TC-LEDGER-FOO-999 y el archivo de test
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-002 — El chequeo de trazabilidad falla si un test referencia un TC-ID inexistente en el catálogo

## Intención

Un ID inventado o mal escrito rompería en silencio el vínculo test→requirement (docs/17 R4).

## Escenario

```gherkin
Dado un test llamado "[TC-LEDGER-FOO-999] algo"
  Y no existe el caso "TC-LEDGER-FOO-999"
Cuando se ejecuta el chequeo de trazabilidad
Entonces falla con la regla "R4"
```

## Notas

- Complementa a TC-PLATFORM-TRACE-001 (R3, caso automatizado sin test).
