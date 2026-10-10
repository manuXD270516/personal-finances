---
id: TC-DEBT-AMORT-011
title: 'Comisión fija y seguro sobre saldo se suman a la cuota sin alterar principal ni interés'
spec: debt/amortization
related_specs: []
requirement: 'Cargos por cuota'
scenario: 'Comisión fija y seguro sobre el saldo'
requirement_status: provisional
fr: ['FR-DEBT-006']
nfr: []
invariants: ['INV-016']
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'charges']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo vehicular de 50000.00 BOB tiene una comisión fija de 10.00 BOB y un seguro del 0.0400 % mensual sobre el saldo'
expected_result:
  - 'La cuota 1 es 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)'
  - 'La cuota 2 es 2371.27 BOB con seguro 19.25 BOB sobre el saldo de 48137.15 BOB y la cuota 24 es 2352.83 BOB con seguro 0.93 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-011 — Comisión fija y seguro sobre saldo se suman a la cuota sin alterar principal ni interés

## Intención

FR-DEBT-006: cada cuota desglosa fees, seguro e impuestos.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo vehicular de 50000.00 BOB tiene una comisión fija de 10.00 BOB y un seguro del 0.0400 % mensual sobre el saldo
Entonces la cuota 1 es 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)
  Y la cuota 2 es 2371.27 BOB con seguro 19.25 BOB sobre el saldo de 48137.15 BOB y la cuota 24 es 2352.83 BOB con seguro 0.93 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
