---
id: TC-DEBT-AMORT-028
title: 'Adoptar la tabla del banco crea una versión custom sin tocar lo pagado'
spec: debt/amortization
related_specs: []
requirement: 'Cronograma custom importado desde la tabla del banco'
scenario: 'Adoptar la tabla del banco'
requirement_status: provisional
fr: ['FR-DEBT-005']
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
tags: ['amortization', 'custom', 'versioning']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El "Préstamo vehicular" activo tiene la cuota 1 pagada y el EDITOR adopta la referencia versión 1 del banco como cronograma custom'
expected_result:
  - 'El préstamo pasa a cronograma custom versión 2 con las cuotas 2 a 24 de la referencia'
  - 'La cuota 1 pagada de la versión 1 y su pago no cambian'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-028 — Adoptar la tabla del banco crea una versión custom sin tocar lo pagado

## Intención

Reutiliza la referencia cargada para el exit criterion como fuente de verdad.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el "Préstamo vehicular" activo tiene la cuota 1 pagada y el EDITOR adopta la referencia versión 1 del banco como cronograma custom
Entonces el préstamo pasa a cronograma custom versión 2 con las cuotas 2 a 24 de la referencia
  Y la cuota 1 pagada de la versión 1 y su pago no cambian
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
