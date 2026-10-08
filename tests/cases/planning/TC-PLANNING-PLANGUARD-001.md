---
id: TC-PLANNING-PLANGUARD-001
title: El plan mensual de un periodo cerrado es de solo lectura
spec: planning/financial-periods
related_specs:
  - planning/budgets
  - planning/month-closing
requirement: Planificación de solo lectura en periodos cerrados
scenario: Editar el plan de un mes cerrado
requirement_status: confirmed
fr:
  - FR-PLANNING-008
  - FR-PLANNING-014
nfr: []
invariants:
  - INV-015
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - financial-periods
  - cross-change:pf-p2b
error_code: PERIOD_CLOSED
preconditions:
  - '"2026-09" closed con plan "Supermercado" 1500.00 BOB'
  - '"2026-12" draft con plan "Supermercado" 1500.00 BOB'
  - Usuario EDITOR; OWNER disponible para reabrir
input:
  - period: 2026-09
    line: Supermercado
    from: "1500.00"
    to: "1800.00"
    currency: BOB
  - period: 2026-12
    line: Supermercado
    from: "1500.00"
    to: "1600.00"
    currency: BOB
steps:
  - Modificar el plan de "2026-09"
  - El OWNER reabre "2026-09" y se repite la modificación
  - Modificar el plan de "2026-12"
expected_result:
  - Con "2026-09" closed se rechaza con PERIOD_CLOSED y el plan sigue en 1500.00 BOB
  - Tras reabrir, el cambio se acepta y el plan queda en 1800.00 BOB
  - El cambio en "2026-12" se acepta
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-PLANGUARD-001 — El plan mensual de un periodo cerrado es de solo lectura

## Intención

Un mes cerrado no cambia en silencio (INV-015) tampoco en su planificación; el snapshot de cierre congela el presupuesto vs real.

## Escenario

```gherkin
Dado que "2026-09" está closed con 1500.00 BOB planificados para "Supermercado"
Cuando el EDITOR intenta cambiarlo a 1800.00 BOB
Entonces se rechaza con "PERIOD_CLOSED"
  Y el plan sigue en 1500.00 BOB
```

## Notas

- Se automatiza primero contra PlanningEditGuard; de punta a punta cuando exista el plan mensual de pf-p2b (add-budgets).
