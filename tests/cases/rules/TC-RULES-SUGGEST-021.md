---
id: TC-RULES-SUGGEST-021
title: "VIEWER lista sugerencias pero no puede aceptarlas"
spec: rules/rule-engine
related_specs: ["security/access-control","audit/audit-trail"]
requirement: "Permisos, auditoría y aislamiento de las sugerencias"
scenario: "VIEWER intenta aceptar"
requirement_status: provisional
fr: ["FR-RULES-011","FR-IDENTITY-006","FR-AUDIT-001"]
nfr: []
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["rules","rule-suggestions"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-11-04T10:00:00-04:00 (ventana de 180 días: 2026-05-08..2026-11-04)"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Telefonía\", \"Supermercado\", \"Farmacia\", \"Restaurantes\", \"Taxi\", \"Viajes\", \"Gimnasio\" y \"Recargas\"; contraparte \"Farmacorp\""
  - "Miembro VIEWER de \"W1\""
input: {}
steps:
  - "El VIEWER lista sugerencias"
  - "El VIEWER acepta y descarta la de Tigo"
  - "El EDITOR descarta otra y se consulta la auditoría"
expected_result:
  - "Listado 200"
  - "Aceptar y descartar: 403 INSUFFICIENT_ROLE"
  - "El descarte del EDITOR queda auditado en la misma unidad de trabajo"
created: 2026-11-04
updated: 2026-11-04
---

# TC-RULES-SUGGEST-021 — VIEWER lista sugerencias pero no puede aceptarlas

## Intención

Roles y auditoría.

## Escenario

```gherkin
Dado un VIEWER
Cuando acepta una sugerencia
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-rule-suggestions`.
