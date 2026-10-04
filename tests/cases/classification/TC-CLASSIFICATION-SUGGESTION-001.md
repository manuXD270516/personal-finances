---
id: TC-CLASSIFICATION-SUGGESTION-001
title: 'La sugerencia de categoría por counterparty usa la última categoría activa usada'
spec: classification/counterparties
related_specs: []
requirement: 'Sugerencia de categoría por counterparty'
scenario: 'Sugerencia por última categoría usada'
requirement_status: confirmed
fr: [FR-CLASSIFICATION-011]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-should.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: [counterparties, suggestion]
error_code: null
preconditions:
- 'Counterparty "Farmacorp" sin categoría por defecto'
- 'Último gasto con "Farmacorp": 64.00 BOB en "Farmacia"'
input:
  counterparty: 'Farmacorp'
  kind: 'EXPENSE'
steps:
- 'Pedir la sugerencia de categoría para "Farmacorp"'
- 'Pedir la sugerencia para una counterparty sin uso ni categoría por defecto'
expected_result:
- 'La sugerencia es "Farmacia" con origen LAST_USED'
- 'Sin uso ni categoría por defecto no hay sugerencia (NONE)'
- 'Pedir la sugerencia no asigna ninguna categoría'
created: 2026-10-04
updated: 2026-10-04
---

# TC-CLASSIFICATION-SUGGESTION-001 — La sugerencia de categoría por counterparty usa la última categoría activa usada

## Intención

Sugerir sin asignar: acelera la carga sin clasificar por el usuario.

## Escenario

```gherkin
Dada la counterparty "Farmacorp" sin categoría por defecto
  Y su último gasto de 64.00 BOB fue en "Farmacia"
Cuando el usuario la elige en un gasto nuevo
Entonces el sistema sugiere la categoría "Farmacia"
```

## Notas

- Redactado 2026-10-04 (add-classification 1.3): requirement Should. Automatizado por HTTP contra PostgreSQL real.
