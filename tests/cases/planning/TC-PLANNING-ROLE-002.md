---
id: TC-PLANNING-ROLE-002
title: El VIEWER consulta el checklist pero no puede cerrar
spec: planning/month-closing
related_specs: []
requirement: Autorización del cierre
scenario: VIEWER intenta cerrar
requirement_status: provisional
fr:
  - FR-PLANNING-003
  - FR-PLANNING-004
nfr:
  - NFR-SEC-003
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - authorization
error_code: INSUFFICIENT_ROLE
preconditions:
  - '"2026-10" terminado sin observaciones'
  - Usuario VIEWER
input:
  actor: VIEWER
steps:
  - POST /periods/{id}/close
  - GET /periods/{id}/close-checklist
expected_result:
  - 'Cierre: 403 INSUFFICIENT_ROLE y "2026-10" sigue active'
  - "Checklist: 200"
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-ROLE-002 — El VIEWER consulta el checklist pero no puede cerrar

## Intención

docs/10 §10: cerrar requiere EDITOR u OWNER; leer está permitido a todo miembro.

## Escenario

```gherkin
Dado un VIEWER del workspace
Cuando intenta cerrar "2026-10"
Entonces la respuesta es 403 con código "INSUFFICIENT_ROLE"
  Y puede consultar el checklist de "2026-10"
```

## Notas

- Sin notas adicionales.
