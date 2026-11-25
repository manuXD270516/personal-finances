---
id: TC-CLASSIFICATION-MERGE-016
title: "Plan, plantilla, compromiso y regla pasan a la destino en la misma operación"
spec: classification/categories
related_specs: ["planning/budgets","planning/budget-templates","commitments/recurrence-engine","rules/rule-engine"]
requirement: "Referencias a la categoría fusionada en otros contextos"
scenario: "Plan, plantilla, compromiso y regla"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-PLANNING-008","FR-COMMITMENTS-001","FR-RULES-001"]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","budgets","rules","commitments"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; plan de noviembre de 2026 con la línea \"Super\" (máximo 400.00 BOB) y sin línea de \"Supermercado\"; plantilla vigente \"Mensual\" con la línea \"Super\""
  - "Compromiso \"Mercado semanal\" de 150.00 BOB en \"Super\"; regla \"HIPERMAXI\" con la acción SET_CATEGORY \"Super\""
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
expected_result:
  - "el plan de noviembre tiene la línea \"Supermercado\" con máximo 400.00 BOB"
  - "\"Mensual\" tiene una versión nueva con la línea \"Supermercado\" y la anterior sigue igual"
  - "\"Mercado semanal\" es de \"Supermercado\" con sus ocurrencias de 150.00 BOB sin cambios"
  - "\"HIPERMAXI\" tiene una versión nueva con SET_CATEGORY \"Supermercado\" y la anterior queda en su historial"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-016 — Plan, plantilla, compromiso y regla pasan a la destino en la misma operación

## Intención

Verifica el scenario "Plan, plantilla, compromiso y regla" del requirement "Referencias a la categoría fusionada en otros contextos" de `classification/categories` (FR-CLASSIFICATION-007, FR-PLANNING-008, FR-COMMITMENTS-001, FR-RULES-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; plan de noviembre de 2026 con la línea "Super" (máximo 400.00 BOB) y sin línea de "Supermercado"; plantilla vigente "Mensual" con la línea "Super"
Y Compromiso "Mercado semanal" de 150.00 BOB en "Super"; regla "HIPERMAXI" con la acción SET_CATEGORY "Super"
Cuando se fusiona "Super" en "Supermercado"
Entonces el plan de noviembre tiene la línea "Supermercado" con máximo 400.00 BOB
Y "Mensual" tiene una versión nueva con la línea "Supermercado" y la anterior sigue igual
Y "Mercado semanal" es de "Supermercado" con sus ocurrencias de 150.00 BOB sin cambios
Y "HIPERMAXI" tiene una versión nueva con SET_CATEGORY "Supermercado" y la anterior queda en su historial
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
