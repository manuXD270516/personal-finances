---
id: TC-PLANNING-TEMPLATE-002
title: 'Modificar un template crea la versión 2 y la versión 1 no cambia'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Cada modificación del template crea una versión inmutable'
scenario: 'Subir el máximo de supermercado'
requirement_status: confirmed
fr: ['FR-PLANNING-009']
nfr: []
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'versioning', 'immutability']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y TZ America/La_Paz (FixedClock)'
  - '"Mes estándar" en versión 1 con "Supermercado" máximo 1500.00 BOB'
input:
  baseVersionNo: '1'
  change: 'Supermercado 1600.00 BOB'
  changeNote: 'Inflación'
steps:
  - 'Publicar la nueva versión'
  - 'Leer las versiones 1 y 2'
  - 'Intentar UPDATE/DELETE directo sobre la versión 1 con el rol de la app'
expected_result:
  - 'Versión 2 con "Supermercado" 1600.00 BOB y nota "Inflación"'
  - 'Versión 1 con "Supermercado" 1500.00 BOB'
  - 'UPDATE/DELETE fallan (PF003, append-only)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-002 — Modificar un template crea la versión 2 y la versión 1 no cambia

## Intención

FR-PLANNING-009: cada versión publicada es inmutable; los planes guardan la versión de origen.

## Escenario

```gherkin
Dado "Mes estándar" versión 1 con "Supermercado" 1500.00 BOB
Cuando el EDITOR cambia "Supermercado" a 1600.00 BOB con la nota "Inflación"
Entonces existe la versión 2 con 1600.00 BOB
  Y la versión 1 sigue con 1500.00 BOB
```

## Notas

