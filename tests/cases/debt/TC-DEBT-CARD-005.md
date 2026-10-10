---
id: TC-DEBT-CARD-005
title: 'Pago mínimo por porcentaje con HALF_EVEN, piso y monto fijo'
spec: debt/credit-cards
related_specs: []
requirement: 'Regla de pago mínimo'
scenario: 'Porcentaje con redondeo HALF_EVEN'
requirement_status: provisional
fr: ['FR-DEBT-012', 'FR-DEBT-013']
nfr: []
invariants: ['INV-020', 'INV-001']
priority: critical
type: property
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'rounding']
error_code: null
preconditions:
  - 'Regla PERCENT 5.00 % con piso 50.00 BOB; regla FIXED 300.00 BOB'
input:
  billedA: '1120.50 BOB'
  billedB: '333.33 BOB'
  billedC: '40.00 BOB'
  billedD: '1120.50 BOB (FIXED 300.00)'
steps:
  - 'Aplicar la regla a cada saldo facturado'
expected_result:
  - 'A: 56.02 BOB (56.025 HALF_EVEN)'
  - 'B: 50.00 BOB'
  - 'C: 40.00 BOB'
  - 'D: 300.00 BOB'
  - 'PBT: 0 ≤ mínimo ≤ max(facturado, 0)'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-005 — Pago mínimo por porcentaje con HALF_EVEN, piso y monto fijo

## Intención

El mínimo es una regla financiera con redondeo: HALF_EVEN determinista (RISK-001) y nunca mayor que lo facturado.

## Escenario

```gherkin
Dado un mínimo del 5.00 % con piso de 50.00 BOB
Cuando el saldo facturado es 1120.50 BOB
Entonces el pago mínimo es 56.02 BOB
```

## Notas

- Cubre los scenarios "Piso mayor que el porcentaje", "Saldo facturado menor que el piso" y "Monto fijo".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
