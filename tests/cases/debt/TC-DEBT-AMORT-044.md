---
id: TC-DEBT-AMORT-044
title: 'Simular no crea transacciones, versiones, compromisos ni auditoría'
spec: debt/amortization
related_specs: []
requirement: 'Simulación sin efectos'
scenario: 'Simular no cambia nada'
requirement_status: provisional
fr: ['FR-DEBT-010']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'simulator']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El VIEWER simula avalanche con 500.00 BOB extra por mes'
expected_result:
  - 'Los cronogramas, las transacciones y el comprometido del periodo no cambian'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-044 — Simular no crea transacciones, versiones, compromisos ni auditoría

## Intención

FR-DEBT-010: sin persistir.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el VIEWER simula avalanche con 500.00 BOB extra por mes
Entonces los cronogramas, las transacciones y el comprometido del periodo no cambian
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
