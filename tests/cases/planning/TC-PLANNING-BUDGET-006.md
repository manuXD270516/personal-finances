---
id: TC-PLANNING-BUDGET-006
title: 'Un presupuesto máximo excedido muestra restante negativo y estado con texto e icono'
spec: planning/budgets
related_specs: []
requirement: 'Presupuesto de tipo máximo'
scenario: 'Restaurantes excedido'
requirement_status: confirmed
fr: ['FR-PLANNING-018']
nfr: ['NFR-USAB-104']
invariants: ['INV-020']
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/planning/budgets.test.tsx
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
  - tests/e2e/specs/budgets.spec.ts
status: automated
regression_suite: true
phase: 2
tags: ['budgets', 'maximum']
error_code: null
preconditions:
  - '"Restaurantes" con máximo 600.00 BOB en "2026-11"'
input:
  actual: '650.00 BOB'
steps:
  - 'Calcular el progreso con gastado 650.00 BOB'
  - 'Renderizar la línea en la UI'
expected_result:
  - 'Estado excedido, restante −50.00 BOB y 108.3 % (650/600 con HALF_EVEN a 1 decimal)'
  - 'La UI muestra el estado con texto e icono además del color'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-006 — Un presupuesto máximo excedido muestra restante negativo y estado con texto e icono

## Intención

FR-PLANNING-018 (maximum) y NFR-USAB-104: el exceso debe ser explícito y accesible.

## Escenario

```gherkin
Dado "Restaurantes" con máximo 600.00 BOB
Cuando el gastado es 650.00 BOB
Entonces la línea está excedida con restante −50.00 BOB y 108.3 %
  Y el estado se indica con texto e icono
```

## Notas

- La parte de UI se verifica con test de componente (rol/aria-label del estado).
