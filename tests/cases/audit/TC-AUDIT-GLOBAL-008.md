---
id: TC-AUDIT-GLOBAL-008
title: El CSV global de auditoría incluye el nombre visible del actor
spec: audit/audit-trail
related_specs: []
requirement: Exportación CSV del log de auditoría
scenario: El OWNER exporta los cambios de marzo
requirement_status: confirmed
fr:
- FR-AUDIT-006
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/audit-global.api.test.ts
- apps/api/test/db/audit-global-view.int.test.ts
- packages/contexts/audit/src/application/audit-global-view.test.ts
- tests/e2e/specs/audit-global.spec.ts
status: automated
regression_suite: false
phase: 2
tags:
- audit
- csv
error_code: null
preconditions:
- W1 con cambios hechos por el OWNER y por un proceso
input:
  request: 'GET export CSV del log de marzo'
steps:
- Exportar el log a CSV
expected_result:
- La columna actorName sigue a actorId
- Las filas del OWNER tienen su nombre visible
- Las filas de procesos tienen actorName vacío
- Un nombre que empieza con = queda neutralizado
created: 2026-10-09
updated: 2026-10-09
---

# TC-AUDIT-GLOBAL-008 — El CSV global de auditoría incluye el nombre visible del actor

## Intención

Change `fix-phase-2-gaps`: verificar el escenario "El OWNER exporta los cambios de marzo" del requirement "Exportación CSV del log de auditoría" de `audit/audit-trail`.

## Notas

- Automatizado en el change `fix-phase-2-gaps` (2026-10-09); requisito confirmado.
