---
id: TC-PLANNING-TEMPLATE-008
title: 'Clonar el plan anterior copia líneas y umbrales pero no cruces ni gastado'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Crear el plan clonando el plan del periodo anterior'
scenario: 'Noviembre clonado a diciembre'
requirement_status: confirmed
fr: ['FR-PLANNING-011']
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
tags: ['templates', 'clone']
error_code: null
preconditions:
  - 'Plan de "2026-11" con "Restaurantes" máximo 650.00 BOB (editado a mano), umbrales 80 y 100 % y cruce del 80 % registrado'
  - 'Periodo "2026-12" sin plan'
input:
  periodId: '2026-12'
  source: 'CLONE_PREVIOUS'
steps:
  - 'Crear el plan de "2026-12" clonando el anterior'
expected_result:
  - '"Restaurantes" máximo 650.00 BOB con umbrales 80 y 100 %'
  - 'Sin cruces registrados en "2026-12"'
  - 'Origen: plan de "2026-11"; conserva el template de origen'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-008 — Clonar el plan anterior copia líneas y umbrales pero no cruces ni gastado

## Intención

FR-PLANNING-011: arrancar el mes con el plan del mes anterior.

## Escenario

```gherkin
Dado el plan de "2026-11" con "Restaurantes" 650.00 BOB y umbrales 80 y 100 %
Cuando creo el plan de "2026-12" clonando el anterior
Entonces "Restaurantes" tiene 650.00 BOB y umbrales 80 y 100 % sin cruces
```

## Notas

