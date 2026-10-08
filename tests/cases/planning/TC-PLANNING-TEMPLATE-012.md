---
id: TC-PLANNING-TEMPLATE-012
title: 'Solo un template activo puede ser el predeterminado'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Template por defecto aplicado a los periodos nuevos'
scenario: 'Un solo predeterminado'
requirement_status: confirmed
fr: ['FR-PLANNING-010']
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'default']
error_code: null
preconditions:
  - '"Mes estándar" predeterminado'
  - '"Mes de vacaciones" activo'
input:
  setDefault: 'Mes de vacaciones'
steps:
  - 'Marcar "Mes de vacaciones" como predeterminado (también con dos solicitudes concurrentes)'
expected_result:
  - '"Mes de vacaciones" es el predeterminado y "Mes estándar" deja de serlo'
  - 'Nunca hay dos predeterminados (índice único parcial)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-012 — Solo un template activo puede ser el predeterminado

## Intención

Determinismo de la aplicación automática.

## Escenario

```gherkin
Dado "Mes estándar" predeterminado
Cuando marco "Mes de vacaciones" como predeterminado
Entonces solo "Mes de vacaciones" es predeterminado
```

## Notas

