---
id: TC-DEBT-LOAN-046
title: 'El sistema alemán se acepta al registrar un préstamo'
spec: debt/loans
related_specs: []
requirement: 'Sistemas de amortización habilitados'
scenario: 'Préstamo alemán registrado'
requirement_status: provisional
fr: ['FR-DEBT-004']
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
tags: ['loans', 'german']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo de 12000.00 BOB al 12.00 % con sistema alemán a 12 cuotas'
expected_result:
  - 'El préstamo queda en borrador con una vista previa de cuotas decrecientes de 1120.00 a 1010.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-046 — El sistema alemán se acepta al registrar un préstamo

## Intención

Reemplaza a TC-DEBT-LOAN-003 cuando se habilitan los sistemas.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo de 12000.00 BOB al 12.00 % con sistema alemán a 12 cuotas
Entonces el préstamo queda en borrador con una vista previa de cuotas decrecientes de 1120.00 a 1010.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
