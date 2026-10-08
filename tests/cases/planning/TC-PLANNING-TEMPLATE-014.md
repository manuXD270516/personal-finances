---
id: TC-PLANNING-TEMPLATE-014
title: 'Clonar un template crea uno independiente con su propia versión 1'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Clonar un template como template independiente'
scenario: 'Mes de vacaciones desde Mes estándar'
requirement_status: confirmed
fr: ['FR-PLANNING-012']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'clone']
error_code: null
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
input:
  source: 'Mes estándar v2'
  name: 'Mes de vacaciones'
steps:
  - 'Clonar'
  - 'Publicar la versión 3 de "Mes estándar"'
expected_result:
  - '"Mes de vacaciones" versión 1 con las líneas de "Mes estándar" versión 2'
  - 'La versión 3 de "Mes estándar" no cambia "Mes de vacaciones"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-014 — Clonar un template crea uno independiente con su propia versión 1

## Intención

FR-PLANNING-012 (Should).

## Escenario

```gherkin
Cuando clono "Mes estándar" versión 2 como "Mes de vacaciones"
Entonces "Mes de vacaciones" versión 1 tiene las mismas líneas
  Y es independiente de nuevas versiones de "Mes estándar"
```

## Notas

