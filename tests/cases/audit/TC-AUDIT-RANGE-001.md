---
id: TC-AUDIT-RANGE-001
title: "La consulta de auditoría por rango de fechas usa la zona horaria del workspace"
spec: audit/audit-trail
related_specs: []
requirement: "Consulta de auditoría por rango de fechas"
scenario: "Registros de un día"
requirement_status: confirmed
fr: [FR-AUDIT-004, FR-AUDIT-006]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["audit", "timezone"]
error_code: null
preconditions:
  - "W1 con zona America/La_Paz (UTC-4)"
  - "Registros en 2026-03-14T15:00:00Z, 2026-03-16T03:30:00Z (= 2026-03-15 23:30 La Paz) y 2026-03-16T15:00:00Z"
input:
  request: "GET /workspaces/W1/audit-log?from=2026-03-15&to=2026-03-15"
  invalid: "GET /workspaces/W1/audit-log?from=2026-03-16&to=2026-03-15"
steps:
  - "Consultar el rango válido"
  - "Consultar el rango invertido"
expected_result:
  - "Solo se devuelve el registro de 2026-03-16T03:30:00Z"
  - "Sin filtro de entidad, el orden por defecto es del más reciente al más antiguo"
  - "El rango invertido se rechaza con INVALID_FILTER"
created: 2026-10-02
updated: 2026-10-02
---

# TC-AUDIT-RANGE-001 — La consulta de auditoría por rango de fechas usa la zona horaria del workspace

## Intención

Evita errores off-by-one en límites de día (NFR-USAB-004) al revisar la actividad de una fecha.

## Escenario

```gherkin
Dado registros el 14, el 15 a las 23:30 hora de La Paz y el 16 de marzo
Cuando el usuario consulta del 2026-03-15 al 2026-03-15
Entonces obtiene solo el registro del 15 a las 23:30 hora de La Paz
```
