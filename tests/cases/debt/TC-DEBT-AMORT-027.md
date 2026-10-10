---
id: TC-DEBT-AMORT-027
title: 'Un cronograma custom cuyo principal no suma se rechaza'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma custom cargado manualmente'
scenario: 'Principal que no suma'
requirement_status: provisional
fr: ['FR-DEBT-005', 'FR-DEBT-006']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'custom', 'validation']
error_code: CUSTOM_SCHEDULE_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR define cuotas cuyo principal suma 999.99 BOB para un préstamo de 1000.00 BOB'
expected_result:
  - 'Se rechaza con `CUSTOM_SCHEDULE_INVALID` informando 999.99 BOB frente a 1000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-027 — Un cronograma custom cuyo principal no suma se rechaza

## Intención

INV-017 también para cronogramas cargados.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR define cuotas cuyo principal suma 999.99 BOB para un préstamo de 1000.00 BOB
Entonces se rechaza con `CUSTOM_SCHEDULE_INVALID` informando 999.99 BOB frente a 1000.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
