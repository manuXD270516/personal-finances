---
id: TC-PLANNING-TEMPLATE-016
title: 'Confirmar una vista previa desactualizada se rechaza sin cambios'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Aplicar a futuro con vista previa'
scenario: 'Vista previa desactualizada'
requirement_status: confirmed
fr: ['FR-PLANNING-014']
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
tags: ['templates', 'propagation', 'concurrency']
error_code: BUDGET_PROPAGATION_STALE
preconditions:
  - 'Vista previa obtenida en TC-PLANNING-TEMPLATE-015'
input:
  concurrentEdit: 'edición del plan de 2026-12 entre vista previa y confirmación'
steps:
  - 'Editar el plan de "2026-12"'
  - 'Confirmar con el token original'
expected_result:
  - '409 BUDGET_PROPAGATION_STALE'
  - 'No se crea versión nueva ni cambia ningún plan'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-016 — Confirmar una vista previa desactualizada se rechaza sin cambios

## Intención

La confirmación aplica exactamente lo que el usuario vio.

## Escenario

```gherkin
Dado una vista previa de propagación
Cuando alguien edita "2026-12" antes de confirmar
Entonces la confirmación se rechaza con BUDGET_PROPAGATION_STALE
```

## Notas

