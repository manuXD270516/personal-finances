---
id: TC-PLANNING-ACTUAL-004
title: 'Un gasto en USD se convierte con la tasa PARALLEL vigente al cierre de su día'
spec: planning/budgets
related_specs: ['fx/market-rate-providers', 'reporting/dashboard']
requirement: 'Gasto en otra moneda convertido con la tasa de su fecha'
scenario: 'Gasto en USD y en BOB'
requirement_status: confirmed
fr: ['FR-PLANNING-023', 'FR-REPORTING-002']
nfr: []
invariants: ['INV-012', 'INV-020']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/application/budgets.service.test.ts
  - packages/shared-kernel/src/valuation/flow-valuation.test.ts
status: automated
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'multi-currency', 'conv_t']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - 'USD/BOB PARALLEL 12.05 del provider vigente al cierre del 2026-11-12 (preferencia PARALLEL)'
input:
  usd: '20.00 USD Restaurantes 2026-11-12'
  bob: '100.00 BOB Restaurantes 2026-11-13'
steps:
  - 'Postear ambos gastos'
  - 'Consultar el plan'
expected_result:
  - 'Gastado de "Restaurantes" 341.00 BOB (20.00 × 12.05 + 100.00)'
  - 'La respuesta informa la tasa 12.05 PARALLEL con su fuente y vigencia'
  - 'Coincide con el monto de "Restaurantes" en /reports/summary para el mismo rango'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTUAL-004 — Un gasto en USD se convierte con la tasa PARALLEL vigente al cierre de su día

## Intención

FR-PLANNING-023: presupuesto vs real en moneda base con la tasa de la fecha y las mismas reglas que Reporting (D29/D53).

## Escenario

```gherkin
Dado USD/BOB PARALLEL 12.05 al cierre del 2026-11-12
  Y gastos de 20.00 USD el 2026-11-12 y 100.00 BOB el 2026-11-13 en "Restaurantes"
Cuando consulto el plan
Entonces el gastado de "Restaurantes" es 341.00 BOB
```

## Notas

- Datos ficticios (12.05 es de ejemplo).
