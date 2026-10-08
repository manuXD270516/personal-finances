---
id: TC-PLANNING-TEMPLATE-015
title: 'La propagación a futuro muestra cambios y conflictos y respeta ediciones manuales'
spec: planning/budget-templates
related_specs: ['planning/budgets']
requirement: 'Aplicar a futuro con vista previa'
scenario: 'Propagar el nuevo máximo de restaurantes'
requirement_status: confirmed
fr: ['FR-PLANNING-014']
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ['templates', 'propagation']
error_code: null
preconditions:
  - '"2026-11" activo desde "Mes estándar" versión 2'
  - '"2026-12" y "2027-01" en borrador con planes de la versión 2 ("Restaurantes" máximo 600.00 BOB)'
  - '"2027-01" con "Restaurantes" modificado a mano en 700.00 BOB'
input:
  change: 'Restaurantes MAXIMUM 650.00 BOB desde el plan de 2026-11'
steps:
  - 'Pedir la vista previa'
  - 'Confirmar con el token'
expected_result:
  - 'Vista previa: "2026-12" de 600.00 a 650.00 BOB; "2027-01" en conflicto'
  - 'Tras confirmar: "Mes estándar" versión 3; "2026-12" con 650.00 BOB; "2027-01" conserva 700.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-015 — La propagación a futuro muestra cambios y conflictos y respeta ediciones manuales

## Intención

FR-PLANNING-014 (Should): propagación segura con vista previa.

## Escenario

```gherkin
Dado "2026-12" y "2027-01" en borrador y "2027-01" con "Restaurantes" editado a 700.00 BOB
Cuando propago "Restaurantes" 650.00 BOB y confirmo la vista previa
Entonces se crea la versión 3, "2026-12" queda en 650.00 BOB y "2027-01" conserva 700.00 BOB
```

## Notas

- draft: preguntas abiertas 4 y 6 de add-budget-templates.
