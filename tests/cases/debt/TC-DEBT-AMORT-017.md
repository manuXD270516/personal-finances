---
id: TC-DEBT-AMORT-017
title: 'La comparación de una tabla idéntica informa coincidencia total al centavo'
spec: debt/amortization
related_specs: []
requirement: 'Reporte de diferencias contra la tabla del banco'
scenario: 'Tabla idéntica al cronograma'
requirement_status: confirmed
fr: ['FR-DEBT-003', 'FR-DEBT-006']
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/debt/src/domain/schedule-comparator.test.ts
  - tests/e2e/specs/loans.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'comparison', 'exit-criterion']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La referencia cargada del "Préstamo vehicular" tiene las mismas 24 cuotas, vencimientos y componentes que el cronograma vigente'
expected_result:
  - 'El reporte informa 24 de 24 cuotas coincidentes al centavo y diferencia 0.00 BOB en todos los componentes'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-017 — La comparación de una tabla idéntica informa coincidencia total al centavo

## Intención

Resultado esperado del exit criterion (MATCH).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la referencia cargada del "Préstamo vehicular" tiene las mismas 24 cuotas, vencimientos y componentes que el cronograma vigente
Entonces el reporte informa 24 de 24 cuotas coincidentes al centavo y diferencia 0.00 BOB en todos los componentes
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
