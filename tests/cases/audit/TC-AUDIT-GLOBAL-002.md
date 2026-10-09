---
id: TC-AUDIT-GLOBAL-002
title: "Un VIEWER no accede al log de auditoría global"
spec: audit/audit-trail
related_specs: ["security/access-control"]
requirement: "Consulta global del log de auditoría con filtros"
scenario: "VIEWER consulta el log global"
requirement_status: confirmed
fr: [FR-AUDIT-006]
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: security
automation_status: automated
automated_tests:
  - apps/api/test/api/audit-global.api.test.ts
  - apps/web/src/ui/audit/audit.test.tsx
  - tests/e2e/specs/audit-global.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["audit", "rbac"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Usuario VIEWER en \"W1\""
input:
  actor: "VIEWER"
steps:
  - "GET W/audit-log como VIEWER"
expected_result:
  - "403 INSUFFICIENT_ROLE"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-GLOBAL-002 — Un VIEWER no accede al log de auditoría global

## Intención

D28: el VIEWER solo ve el historial de lo que puede ver, no el log global.

## Escenario

```gherkin
Dado un VIEWER del workspace
Cuando consulta el log de auditoría global
Entonces se rechaza con "INSUFFICIENT_ROLE"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
