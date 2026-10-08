---
id: TC-PLANNING-BUDGET-019
title: 'Un presupuesto por porcentaje de ingresos calcula su planificado con HALF_EVEN'
spec: planning/budgets
related_specs: []
requirement: 'Presupuesto como porcentaje de ingresos'
scenario: 'Redondeo del porcentaje'
requirement_status: confirmed
fr: ['FR-PLANNING-020']
nfr: []
invariants: ['INV-020']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
  - packages/contexts/planning/src/domain/budget.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'percent-of-income', 'rounding']
error_code: null
preconditions:
  - 'Plan en BOB con "Donaciones" como porcentaje de ingresos'
input:
  expected8000: '10 % de 8000.00 BOB esperados'
  actual6500: '10 % de 6500.00 BOB reales'
  expected800050: '12.5 % de 8000.50 BOB esperados'
steps:
  - 'Calcular el planificado en cada caso'
expected_result:
  - '10 % de esperados 8000.00 ⇒ 800.00 BOB'
  - '10 % de reales 6500.00 ⇒ 650.00 BOB'
  - '12.5 % de 8000.50 ⇒ 1000.06 BOB (1000.0625 HALF_EVEN)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-019 — Un presupuesto por porcentaje de ingresos calcula su planificado con HALF_EVEN

## Intención

FR-PLANNING-020 (Should): monto = % de ingresos esperados o reales; redondeo determinista (INV-020).

## Escenario

```gherkin
Dado "Donaciones" al 10 % de los ingresos esperados de 8000.00 BOB
Entonces su planificado es 800.00 BOB
Dado "Donaciones" al 12.5 % de los ingresos esperados de 8000.50 BOB
Entonces su planificado es 1000.06 BOB
```

## Notas

- Cubre los scenarios "10 % de los ingresos esperados" y "10 % de los ingresos reales".
