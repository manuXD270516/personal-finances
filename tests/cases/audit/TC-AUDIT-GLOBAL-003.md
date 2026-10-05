---
id: TC-AUDIT-GLOBAL-003
title: "El OWNER exporta el log a CSV con zona horaria y celdas neutralizadas"
spec: audit/audit-trail
related_specs: ["audit/lifecycle-timeline"]
requirement: "Exportación CSV del log de auditoría"
scenario: "El OWNER exporta los cambios de marzo"
requirement_status: provisional
fr: [FR-AUDIT-006, FR-AUDIT-005]
nfr: [NFR-SEC-015]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["audit", "export", "csv"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Registro del 2026-03-16T03:30:00Z (2026-03-15T23:30:00-04:00) de una transacción con descripción anterior \"=SUM(A1)\""
input:
  - "{\"actor\":\"OWNER\",\"from\":\"2026-03-01\",\"to\":\"2026-03-31\"}"
  - "{\"actor\":\"EDITOR\"}"
  - "{\"actor\":\"OWNER\",\"rows\":50001}"
steps:
  - "GET W/audit-log/export?format=csv como OWNER"
  - "Como EDITOR"
  - "Como OWNER con un rango de 50001 registros"
expected_result:
  - "CSV con \"2026-03-15T23:30:00-04:00\", la descripción neutralizada y una fila por registro"
  - "Registro audit.log.exported con actor y filtros"
  - "EDITOR: 403 INSUFFICIENT_ROLE"
  - "50001 registros: 400 VALIDATION_FAILED"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-GLOBAL-003 — El OWNER exporta el log a CSV con zona horaria y celdas neutralizadas

## Intención

FR-AUDIT-006: export solo OWNER con las convenciones de CSV de D52.

## Escenario

```gherkin
Dado el log de marzo de 2026 con un registro del 2026-03-15T23:30:00-04:00
Cuando el OWNER lo exporta a CSV
Entonces el CSV tiene ese instante con su desfase y celdas neutralizadas
  Y la exportación queda auditada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
