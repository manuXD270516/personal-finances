---
id: TC-DEBT-AMORT-034
title: 'El historial muestra las versiones con motivo y vigencia'
spec: debt/amortization
related_specs: []
requirement: 'Nueva versión del cronograma sin reescribir cuotas pagadas'
scenario: 'Historial de versiones'
requirement_status: provisional
fr: ['FR-DEBT-008']
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
tags: ['amortization', 'versioning']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 12000.00 BOB recibió el prepago reduciendo el plazo del 2027-01-15'
expected_result:
  - 'El historial muestra la versión 1 (inicial, 12 cuotas, reemplazada desde la cuota 4) y la versión 2 (pago extraordinario, vigente desde 2027-01-15)'
  - 'Las cuotas 1 a 3 de la versión 1 siguen pagadas con sus pagos originales'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-034 — El historial muestra las versiones con motivo y vigencia

## Intención

FR-DEBT-008: el cronograma anterior se conserva.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 12000.00 BOB recibió el prepago reduciendo el plazo del 2027-01-15
Entonces el historial muestra la versión 1 (inicial, 12 cuotas, reemplazada desde la cuota 4) y la versión 2 (pago extraordinario, vigente desde 2027-01-15)
  Y las cuotas 1 a 3 de la versión 1 siguen pagadas con sus pagos originales
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
