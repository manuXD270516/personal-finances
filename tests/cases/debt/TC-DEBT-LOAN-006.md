---
id: TC-DEBT-LOAN-006
title: 'El destino del desembolso en otra moneda se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Cuenta del préstamo y cuenta destino'
scenario: 'Destino en otra moneda'
requirement_status: provisional
fr: ['FR-DEBT-001']
nfr: []
invariants: ['INV-002']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'validation']
error_code: CURRENCY_MISMATCH
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo de 50000.00 BOB con destino "Banco USD" (USD)'
expected_result:
  - 'Se rechaza con `CURRENCY_MISMATCH` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-006 — El destino del desembolso en otra moneda se rechaza

## Intención

INV-002: el desembolso no puede cruzar monedas; eso es una conversión.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo de 50000.00 BOB con destino "Banco USD" (USD)
Entonces se rechaza con `CURRENCY_MISMATCH` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
