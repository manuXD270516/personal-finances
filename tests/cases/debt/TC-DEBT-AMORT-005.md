---
id: TC-DEBT-AMORT-005
title: 'PBT: la suma del principal es el principal, sin componentes negativos y con total igual a la suma'
spec: debt/amortization
related_specs: []
requirement: 'Redondeo HALF_EVEN y residuo en la última cuota'
scenario: 'Propiedad para cualquier préstamo válido'
requirement_status: confirmed
fr: ['FR-DEBT-006']
nfr: []
invariants: ['INV-016', 'INV-017']
priority: critical
type: property
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/amortization-calculator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['amortization', 'pbt', 'rounding']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Se genera cualquier combinación válida de principal (0.01 a 10000000.00 en BOB o 0.000001 a 1000000.000000 en USDT), tasa (0 % a 100 %), plazo (1 a 600 cuotas), convención y periodicidad'
expected_result:
  - 'La suma del principal de las cuotas es igual al principal, ningún componente es negativo y cada total es igual a la suma de sus componentes'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-005 — PBT: la suma del principal es el principal, sin componentes negativos y con total igual a la suma

## Intención

RISK-001: un solo caso no basta; la propiedad cubre escalas, tasas, plazos y convenciones.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando se genera cualquier combinación válida de principal (0.01 a 10000000.00 en BOB o 0.000001 a 1000000.000000 en USDT), tasa (0 % a 100 %), plazo (1 a 600 cuotas), convención y periodicidad
Entonces la suma del principal de las cuotas es igual al principal, ningún componente es negativo y cada total es igual a la suma de sus componentes
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
- fast-check: ≥ 1 000 casos en CI y 100 000 nightly; generadores de principal a la escala de la moneda (BOB 2, USDT 6).
