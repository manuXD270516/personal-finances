---
id: TC-DEBT-AMORT-016
title: 'Una fila cuyo total no suma sus componentes rechaza la carga'
spec: debt/amortization
related_specs: []
requirement: 'Cargar la tabla del banco como referencia'
scenario: 'Fila con total inconsistente'
requirement_status: provisional
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'reference', 'validation']
error_code: LOAN_REFERENCE_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La fila 3 de la tabla cargada tiene capital 1898.73, interés 443.29 y cuota 2342.20'
expected_result:
  - 'Se rechaza la carga indicando la fila 3 (2342.02 calculado frente a 2342.20 informado) y no se guarda ninguna referencia'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-016 — Una fila cuyo total no suma sus componentes rechaza la carga

## Intención

Errores de transcripción no deben llegar a la comparación.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la fila 3 de la tabla cargada tiene capital 1898.73, interés 443.29 y cuota 2342.20
Entonces se rechaza la carga indicando la fila 3 (2342.02 calculado frente a 2342.20 informado) y no se guarda ninguna referencia
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
