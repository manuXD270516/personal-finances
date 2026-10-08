---
id: TC-PLANNING-ACTUAL-006
title: 'Un gasto sin tasa se informa sin convertir y el gastado queda incompleto'
spec: planning/budgets
related_specs: ['reporting/dashboard']
requirement: 'Gasto sin tasa disponible informado sin convertir'
scenario: 'Gasto en EUR sin tasa'
requirement_status: confirmed
fr: ['FR-PLANNING-023', 'FR-REPORTING-002']
nfr: []
invariants: ['INV-002']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - apps/web/src/ui/planning/budgets.test.tsx
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/shared-kernel/src/valuation/flow-valuation.test.ts
status: automated
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'multi-currency', 'missing-rate']
error_code: null
preconditions:
  - 'Estado de TC-PLANNING-ACTUAL-004'
  - 'Sin tasa EUR/BOB en los 7 días previos al 2026-11-14 (ventana de Reporting)'
input:
  eur: '5.00 EUR Restaurantes 2026-11-14'
steps:
  - 'Postear el gasto en EUR'
  - 'Consultar el plan'
expected_result:
  - 'Gastado 341.00 BOB marcado incompleto con 5.00 EUR sin convertir'
  - 'Nunca 346.00 BOB'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTUAL-006 — Un gasto sin tasa se informa sin convertir y el gastado queda incompleto

## Intención

RISK-017: sin tasa no se inventa conversión (nunca 1:1); el usuario ve qué falta.

## Escenario

```gherkin
Dado un gasto de 5.00 EUR el 2026-11-14 sin tasa EUR/BOB en la ventana
Cuando consulto el plan
Entonces el gastado es 341.00 BOB incompleto con 5.00 EUR sin convertir
```

## Notas

