---
id: TC-RULES-ENGINE-052
title: "VIEWER no escribe reglas pero puede leer, probar y ver la cobertura"
spec: rules/rule-engine
related_specs: []
requirement: "Permisos y auditoría de las reglas"
scenario: "VIEWER intenta crear una regla"
requirement_status: confirmed
fr: ["FR-RULES-001"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/rules.api.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["rules", "rule-engine"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario VIEWER autenticado"
input: {}
steps:
  - "POST W/rules"
  - "POST W/rules/dry-run/apply"
  - "GET W/rules, POST W/rules/preview, GET W/rules/coverage"
expected_result:
  - "403 INSUFFICIENT_ROLE en las escrituras"
  - "200 en las lecturas y la vista previa"
created: 2026-10-29
updated: 2026-10-30
---

# TC-RULES-ENGINE-052 — VIEWER no escribe reglas pero puede leer, probar y ver la cobertura

## Intención

RBAC de reglas.

## Escenario

```gherkin
Dado un VIEWER
Cuando crea una regla
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-engine`.
