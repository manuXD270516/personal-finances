---
id: TC-AUDIT-GLOBAL-007
title: "Filtrar por correlación devuelve todos los registros de una edición masiva"
spec: audit/audit-trail
related_specs: ["transactions/bulk-edit"]
requirement: "Registros agrupados por operación"
scenario: "Registros de una edición masiva"
requirement_status: confirmed
fr: [FR-AUDIT-006, FR-TRANSACTIONS-033]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["audit", "bulk-edit"]
error_code: null
preconditions:
  - "Edición masiva B1 que recategorizó 3 gastos"
  - "Otra edición masiva B2 de 2 gastos"
input:
  correlationId: "B1"
steps:
  - "GET W/audit-log?correlationId=B1"
expected_result:
  - "Los 3 registros por transacción y el registro agregado de B1"
  - "Ningún registro de B2"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-007 — Filtrar por correlación devuelve todos los registros de una edición masiva

## Intención

Permite revisar o revertir manualmente una operación masiva.

## Escenario

```gherkin
Dado una edición masiva que recategorizó 3 gastos
Cuando el OWNER filtra por su identificador
Entonces obtiene los 3 registros y el agregado, y ningún otro
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
