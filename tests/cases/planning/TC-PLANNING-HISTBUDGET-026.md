---
id: TC-PLANNING-HISTBUDGET-026
title: "VIEWER ve la vista previa, no confirma y no ve otro workspace"
spec: planning/budgets
related_specs: ["security/access-control"]
requirement: "Permisos, periodos cerrados y auditoría de las sugerencias"
scenario: "VIEWER ve pero no confirma"
requirement_status: provisional
fr: ["FR-IDENTITY-006","FR-PLANNING-021"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
  - "Miembro VIEWER de \"W1\""
  - "Workspace \"W2\" con gastos en \"Supermercado\""
input: {}
steps:
  - "El VIEWER pide la vista previa de 2026-11"
  - "El VIEWER confirma"
  - "El EDITOR de \"W1\" pide la vista previa con datos solo en \"W2\""
expected_result:
  - "Vista previa 200"
  - "Confirmación 403 INSUFFICIENT_ROLE"
  - "Los flujos de \"W2\" no entran en ningún real de \"W1\""
created: 2026-11-04
updated: 2026-11-04
---

# TC-PLANNING-HISTBUDGET-026 — VIEWER ve la vista previa, no confirma y no ve otro workspace

## Intención

Roles y aislamiento por workspace (RLS).

## Escenario

```gherkin
Dado un VIEWER
Cuando confirma
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
