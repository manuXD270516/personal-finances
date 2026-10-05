---
id: TC-PLANNING-TEMPLATE-013
title: 'Editar el plan actual no modifica el template ni otros periodos'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Modificar solo el plan actual'
scenario: 'Ajuste local de noviembre'
requirement_status: provisional
fr: ['FR-PLANNING-013']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'override']
error_code: null
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - 'Planes de "2026-11" y "2026-12" creados desde la versión 2'
input:
  change: 'Supermercado 1600.00 → 1800.00 BOB en 2026-11'
steps:
  - 'Editar la línea en el plan de "2026-11"'
  - 'Leer el template y el plan de "2026-12"'
expected_result:
  - '"2026-11" tiene "Supermercado" 1800.00 BOB marcado como modificado'
  - '"Mes estándar" versión 2 y "2026-12" siguen con 1600.00 BOB'
  - 'No se crea versión nueva del template'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-013 — Editar el plan actual no modifica el template ni otros periodos

## Intención

FR-PLANNING-013: ajustes locales sin efectos colaterales.

## Escenario

```gherkin
Dado el plan de "2026-11" desde "Mes estándar" versión 2
Cuando cambio "Supermercado" a 1800.00 BOB en ese plan
Entonces el template y "2026-12" siguen con 1600.00 BOB
```

## Notas

