---
id: TC-PLANNING-TEMPLATE-007
title: 'Al aplicar un template se omiten e informan las líneas con categorías archivadas'
spec: planning/budget-templates
related_specs: ['planning/budgets', 'classification/categories']
requirement: 'Líneas con objetivos archivados se omiten al aplicar'
scenario: 'Categoría Gimnasio archivada'
requirement_status: confirmed
fr: ['FR-PLANNING-010', 'FR-PLANNING-011']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/templates.service.test.ts
  - apps/web/src/ui/planning/templates.test.tsx
status: automated
regression_suite: false
phase: 2
tags: ['templates', 'apply', 'archived']
error_code: null
preconditions:
  - '"Mes estándar" versión 2 incluye "Gimnasio" máximo 250.00 BOB'
  - '"Gimnasio" archivada'
  - 'Periodo "2026-11" sin plan'
input:
  periodId: '2026-11'
  templateId: 'Mes estándar'
steps:
  - 'Crear el plan desde el template'
expected_result:
  - 'El plan se crea sin "Gimnasio"'
  - 'omittedLines informa "Gimnasio" con motivo TARGET_ARCHIVED'
  - 'La versión 2 sigue incluyendo "Gimnasio"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-007 — Al aplicar un template se omiten e informan las líneas con categorías archivadas

## Intención

La creación automática de un periodo nunca debe fallar por un objetivo archivado (design.md decisión 3).

## Escenario

```gherkin
Dado "Mes estándar" con "Gimnasio" y "Gimnasio" archivada
Cuando creo el plan de "2026-11" desde el template
Entonces el plan no incluye "Gimnasio" y la respuesta la informa como omitida
```

## Notas

