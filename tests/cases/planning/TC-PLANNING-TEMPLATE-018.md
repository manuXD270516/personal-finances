---
id: TC-PLANNING-TEMPLATE-018
title: 'Un template archivado no se aplica y sus planes conservan el origen'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Archivar un template'
scenario: 'Template archivado no aplicable'
requirement_status: confirmed
fr: ['FR-PLANNING-009']
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/templates.api.test.ts
  - packages/contexts/planning/src/application/templates.service.test.ts
  - tests/e2e/specs/templates.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ['templates', 'archive']
error_code: BUDGET_TEMPLATE_ARCHIVED
preconditions:
  - '"Mes de vacaciones" activo con planes creados desde su versión 1'
input:
  templateId: 'Mes de vacaciones'
  periodId: '2027-02'
steps:
  - 'Archivar el template'
  - 'Intentar aplicarlo a "2027-02"'
  - 'Intentar DELETE del template'
expected_result:
  - 'Aplicar responde 409 BUDGET_TEMPLATE_ARCHIVED'
  - 'DELETE responde 405 METHOD_NOT_ALLOWED'
  - 'Los planes previos siguen indicando "Mes de vacaciones" versión 1'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-018 — Un template archivado no se aplica y sus planes conservan el origen

## Intención

Los templates no se borran (trazabilidad de planes).

## Escenario

```gherkin
Dado "Mes de vacaciones" archivado
Cuando intento crear el plan de "2027-02" desde él
Entonces se rechaza con BUDGET_TEMPLATE_ARCHIVED
```

## Notas

