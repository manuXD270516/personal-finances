---
id: TC-PLANNING-TEMPLATE-001
title: 'Se crea un template con su versión 1 y se rechaza un nombre repetido'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear un template con su primera versión'
scenario: 'Template "Mes estándar"'
requirement_status: confirmed
fr: ['FR-PLANNING-009']
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
  - tests/e2e/specs/templates.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ['templates', 'versioning']
error_code: NAME_TAKEN
preconditions:
  - 'Workspace con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - 'Usuario EDITOR'
  - 'Sin templates'
input:
  name: 'Mes estándar'
  lines: ['Alquiler FIXED 2800.00 BOB', 'Supermercado MAXIMUM 1500.00 BOB', 'Salario esperado 8000.00 BOB']
  duplicateName: 'mes estándar'
steps:
  - 'Crear el template'
  - 'Intentar crear otro template activo "mes estándar"'
expected_result:
  - '201 con template activo, versión 1 y las tres líneas'
  - 'El segundo intento responde 409 NAME_TAKEN'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-001 — Se crea un template con su versión 1 y se rechaza un nombre repetido

## Intención

FR-PLANNING-009: todo template nace con su versión 1; el nombre identifica al template entre los activos.

## Escenario

```gherkin
Cuando el EDITOR crea "Mes estándar" con tres líneas
Entonces queda activo con la versión 1
Cuando intenta crear otro "mes estándar"
Entonces se rechaza con NAME_TAKEN
```

## Notas

- Cubre también el scenario "Nombre repetido rechazado" (comparación sin distinguir mayúsculas).
