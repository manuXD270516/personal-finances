---
id: TC-AUDIT-GLOBAL-001
title: "La consulta global del log combina filtros por actor, entidad y rango"
spec: audit/audit-trail
related_specs: []
requirement: "Consulta global del log de auditoría con filtros"
scenario: "Cambios de un actor sobre transacciones en marzo"
requirement_status: confirmed
fr: [FR-AUDIT-006, FR-AUDIT-004]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/audit/src/application/audit-global-view.test.ts
  - apps/api/test/api/audit-global.api.test.ts
  - apps/api/test/db/audit-global-view.int.test.ts
  - apps/web/src/ui/audit/audit.test.tsx
  - tests/e2e/specs/audit-global.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["audit", "search"]
error_code: null
preconditions:
  - "Marzo de 2026: \"U1\" editó 3 transacciones y archivó 1 cuenta; \"U2\" editó 2 transacciones"
input:
  actorUserId: "U1"
  aggregateType: "Transaction"
  from: "2026-03-01"
  to: "2026-03-31"
steps:
  - "GET W/audit-log con los filtros como OWNER"
expected_result:
  - "Exactamente los 3 registros de \"U1\" sobre transacciones, del más reciente al más antiguo, con cursor estable"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-001 — La consulta global del log combina filtros por actor, entidad y rango

## Intención

FR-AUDIT-006: encontrar quién cambió qué sin recorrer todo el log.

## Escenario

```gherkin
Dado los cambios de "U1" y "U2" de marzo de 2026
Cuando el OWNER filtra por "U1", transacciones y marzo
Entonces obtiene solo los 3 registros de "U1" sobre transacciones
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
