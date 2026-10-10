---
id: TC-DEBT-AMORT-026
title: 'Un cronograma custom cargado a mano se acepta tal cual'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma custom cargado manualmente'
scenario: 'Cronograma de tres cuotas cargado a mano'
requirement_status: provisional
fr: ['FR-DEBT-005']
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
tags: ['amortization', 'custom']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR define para un préstamo de 1000.00 BOB las cuotas 400.00 + 10.00, 300.00 + 6.00 y 300.00 + 3.00 BOB (principal + interés) con vencimientos 2026-11-15, 2026-12-15 y 2027-01-15'
expected_result:
  - 'El cronograma custom queda con cuotas de 410.00, 306.00 y 303.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-026 — Un cronograma custom cargado a mano se acepta tal cual

## Intención

FR-DEBT-005: el cronograma del banco puede no reproducirse con fórmulas.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR define para un préstamo de 1000.00 BOB las cuotas 400.00 + 10.00, 300.00 + 6.00 y 300.00 + 3.00 BOB (principal + interés) con vencimientos 2026-11-15, 2026-12-15 y 2027-01-15
Entonces el cronograma custom queda con cuotas de 410.00, 306.00 y 303.00 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
