---
id: TC-DEBT-AMORT-037
title: 'Un cambio de tasa recalcula las cuotas futuras como versión nueva'
spec: debt/amortization
related_specs: []
requirement: 'Cambio de tasa variable con vigencia'
scenario: 'Sube la tasa al 15 %'
requirement_status: provisional
fr: ['FR-DEBT-009']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'variable-rate']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo francés variable de 12000.00 BOB al 12.00 % tiene pagadas las cuotas 1 a 6 (principal pendiente 6179.02 BOB) y el EDITOR registra 15.00 % vigente desde el 2027-04-15'
expected_result:
  - 'La versión 2 tiene las cuotas 7 a 12 de 1075.36 BOB con interés de la cuota 7 de 77.24 BOB y la suma de su principal es 6179.02 BOB'
  - 'El historial de tasas muestra 12.00 % desde el desembolso y 15.00 % desde el 2027-04-15'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-037 — Un cambio de tasa recalcula las cuotas futuras como versión nueva

## Intención

FR-DEBT-009: tasa variable con vigencia.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo francés variable de 12000.00 BOB al 12.00 % tiene pagadas las cuotas 1 a 6 (principal pendiente 6179.02 BOB) y el EDITOR registra 15.00 % vigente desde el 2027-04-15
Entonces la versión 2 tiene las cuotas 7 a 12 de 1075.36 BOB con interés de la cuota 7 de 77.24 BOB y la suma de su principal es 6179.02 BOB
  Y el historial de tasas muestra 12.00 % desde el desembolso y 15.00 % desde el 2027-04-15
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
