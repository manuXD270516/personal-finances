---
id: TC-PLANNING-TEMPLATE-006
title: 'Aplicar un template a un periodo con plan se rechaza sin tocar el plan'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear el plan de un periodo desde un template'
scenario: 'El periodo ya tiene plan'
requirement_status: confirmed
fr: ['FR-PLANNING-010']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/templates.api.test.ts
  - packages/contexts/planning/src/application/templates.service.test.ts
  - apps/web/src/ui/planning/templates.test.tsx
status: automated
regression_suite: false
phase: 2
tags: ['templates', 'apply']
error_code: BUDGET_ALREADY_EXISTS
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - 'El periodo "2026-11" ya tiene plan vacío'
input:
  periodId: '2026-11'
  templateId: 'Mes estándar'
steps:
  - 'Aplicar "Mes estándar" a "2026-11"'
expected_result:
  - '409 BUDGET_ALREADY_EXISTS'
  - 'El plan existente sigue vacío'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-006 — Aplicar un template a un periodo con plan se rechaza sin tocar el plan

## Intención

Un plan por periodo (add-budgets); aplicar no sobrescribe ediciones previas.

## Escenario

```gherkin
Dado "2026-11" con plan
Cuando aplico "Mes estándar"
Entonces se rechaza con BUDGET_ALREADY_EXISTS
```

## Notas

