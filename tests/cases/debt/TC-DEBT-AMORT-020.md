---
id: TC-DEBT-AMORT-020
title: 'Una comparación con diferencias queda explicada con texto, autor y fecha'
spec: debt/amortization
related_specs: []
requirement: 'Diferencia explicada'
scenario: 'Centavo explicado por redondeo del banco'
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
  - 'La comparación del "Préstamo vehicular" tiene −0.01 BOB de interés en la cuota 24 y el EDITOR registra la explicación "el banco trunca el interés de la última cuota"'
expected_result:
  - 'La comparación queda explicada con ese texto, su autor y su fecha, para la referencia versión 1 y el cronograma versión 1'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-020 — Una comparación con diferencias queda explicada con texto, autor y fecha

## Intención

El exit criterion acepta "diferencia explicada"; la explicación debe quedar registrada.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la comparación del "Préstamo vehicular" tiene −0.01 BOB de interés en la cuota 24 y el EDITOR registra la explicación "el banco trunca el interés de la última cuota"
Entonces la comparación queda explicada con ese texto, su autor y su fecha, para la referencia versión 1 y el cronograma versión 1
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
