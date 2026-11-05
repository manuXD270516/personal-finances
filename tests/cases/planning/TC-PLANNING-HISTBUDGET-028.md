---
id: TC-PLANNING-HISTBUDGET-028
title: "La confirmación audita cada línea con un identificador de operación común"
spec: planning/budgets
related_specs: ["audit/audit-trail"]
requirement: "Permisos, periodos cerrados y auditoría de las sugerencias"
scenario: "Confirmación auditada"
requirement_status: confirmed
fr: ["FR-AUDIT-001","FR-PLANNING-021"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/budget-suggestions.api.test.ts
  - packages/contexts/planning/src/application/budget-suggestion.service.test.ts
  - tests/e2e/specs/budget-suggestions.spec.ts
status: automated
regression_suite: false
phase: 7
tags: ["planning","budgets","historical-budgets"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y periodos mensuales con día de inicio 1"
  - "FixedClock en 2026-11-04T10:00:00-04:00 salvo indicación"
  - "Usuario EDITOR autenticado salvo indicación"
  - "Categorías de gasto \"Supermercado\" (con subcategoría \"Carnes\"), \"Restaurantes\", \"Regalos\", \"Internet\", \"Viajes\", \"Ropa\", \"Hogar\", \"Taxi\", \"Donaciones\" y de ingreso \"Salario\""
input: {}
steps:
  - "Confirmar \"Supermercado\" de 1500.00 a 1480.00 BOB y \"Restaurantes\" de 600.00 a 650.00 BOB"
  - "Consultar el historial del plan"
expected_result:
  - "Dos registros con el mismo operationId"
  - "Antes y después de cada línea"
  - "Método AVERAGE con 6 periodos en los detalles"
created: 2026-11-04
updated: 2026-11-05
---

# TC-PLANNING-HISTBUDGET-028 — La confirmación audita cada línea con un identificador de operación común

## Intención

Auditoría síncrona en la misma unidad de trabajo.

## Escenario

```gherkin
Dada una confirmación de dos líneas
Cuando consulto el historial
Entonces veo dos cambios con la misma operación
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-historical-budgets`.
