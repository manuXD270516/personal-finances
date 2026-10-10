---
id: TC-DEBT-AMORT-018
title: 'La comparación detecta una diferencia de un centavo y su cuota'
spec: debt/amortization
related_specs: []
requirement: 'Reporte de diferencias contra la tabla del banco'
scenario: 'Diferencia de un centavo en la última cuota'
requirement_status: provisional
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'comparison', 'exit-criterion']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La referencia coincide en las cuotas 1 a 23 y en la cuota 24 informa interés 22.22 BOB y cuota 2341.89 BOB'
expected_result:
  - 'El reporte informa 23 de 24 cuotas coincidentes, primera diferencia en la cuota 24 con −0.01 BOB de interés y −0.01 BOB de total'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-018 — La comparación detecta una diferencia de un centavo y su cuota

## Intención

"Al centavo": una diferencia de 0.01 debe verse.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la referencia coincide en las cuotas 1 a 23 y en la cuota 24 informa interés 22.22 BOB y cuota 2341.89 BOB
Entonces el reporte informa 23 de 24 cuotas coincidentes, primera diferencia en la cuota 24 con −0.01 BOB de interés y −0.01 BOB de total
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
