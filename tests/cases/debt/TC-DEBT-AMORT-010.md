---
id: TC-DEBT-AMORT-010
title: 'El primer periodo irregular devenga por días 30/360'
spec: debt/amortization
related_specs: []
requirement: 'Fechas de vencimiento de las cuotas'
scenario: 'Primer periodo largo con 30/360'
requirement_status: confirmed
fr: ['FR-DEBT-001', 'FR-DEBT-003']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/amortization-calculator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'dates', 'day-count']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 50000.00 BOB al 11.50 % con 30/360 se desembolsa el 2026-10-01 y su primera cuota vence el 2026-11-15 (44 días 30/360)'
expected_result:
  - 'El interés de la cuota 1 es 702.78 BOB'
  - 'La suma del principal de las 24 cuotas sigue siendo 50000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-010 — El primer periodo irregular devenga por días 30/360

## Intención

Un desembolso con primera cuota más de un mes después es frecuente.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 50000.00 BOB al 11.50 % con 30/360 se desembolsa el 2026-10-01 y su primera cuota vence el 2026-11-15 (44 días 30/360)
Entonces el interés de la cuota 1 es 702.78 BOB
  Y la suma del principal de las 24 cuotas sigue siendo 50000.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
