---
id: TC-PLATFORM-API-003
title: Una operación deprecada responde Deprecation, Sunset y Link
spec: platform/api-conventions
related_specs: []
requirement: Deprecación anunciada con cabeceras
scenario: Llamada a una operación deprecada
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-009
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- deprecation
error_code: null
preconditions:
- 'Controller de prueba marcado deprecated: true con x-sunset 2026-12-31 en un contrato fixture'
input:
  fecha: '2026-10-02'
  request: GET /api/v1/_test/deprecated
steps:
- Llamar la operación
- Ejecutar Spectral sobre un fixture con x-sunset a menos de 90 días
expected_result:
- La respuesta incluye Deprecation, Sunset (fecha ≥ 2026-12-31) y Link con rel="deprecation"
- Spectral falla con x-sunset a menos de 90 días
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-003 — Una operación deprecada responde Deprecation, Sunset y Link

## Intención

Los clientes deben enterarse con anticipación del retiro de una operación (docs/10 §11).

## Escenario

```gherkin
Dada una operación deprecada con retiro el 2026-12-31
Cuando se llama el 2026-10-02
Entonces la respuesta incluye las cabeceras "Deprecation" y "Sunset"
```

## Notas

- Requirement Should.
