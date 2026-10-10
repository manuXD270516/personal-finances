---
id: TC-DEBT-CARD-008
title: 'El ciclo cierra según la medianoche de La Paz, no del proceso'
spec: debt/credit-cards
related_specs: []
requirement: 'Ciclo según la zona horaria del workspace'
scenario: 'Cierre a medianoche de La Paz'
requirement_status: provisional
fr: ['FR-DEBT-013']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'timezone']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Proceso con TZ=UTC'
input:
  nowA: '2026-10-26T03:30Z'
  nowB: '2026-10-26T04:05Z'
steps:
  - 'A las 03:30Z registrar una compra con fecha 2026-10-25 y consultar el ciclo'
  - 'A las 04:05Z correr debt.card-daily'
expected_result:
  - '03:30Z: ciclo que cierra el 2026-10-25 OPEN y la compra le pertenece'
  - '04:05Z: ciclo cerrado y estado de cuenta emitido'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-008 — El ciclo cierra según la medianoche de La Paz, no del proceso

## Intención

RISK-020: "hoy" para cerrar ciclos se calcula en la zona del workspace.

## Escenario

```gherkin
Dado el workspace en America/La_Paz y el proceso en UTC
Cuando son las 23:30 del 2026-10-25 en La Paz
Entonces el ciclo sigue abierto
  Y a las 00:05 del 2026-10-26 ya está emitido
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
