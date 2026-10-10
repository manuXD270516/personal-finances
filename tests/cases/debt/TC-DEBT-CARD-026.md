---
id: TC-DEBT-CARD-026
title: 'Cambiar el día de cierre aplica desde el ciclo abierto'
spec: debt/credit-cards
related_specs: []
requirement: 'Cambio de los términos de la tarjeta'
scenario: 'Cierre pasa del 25 al 20'
requirement_status: provisional
fr: ['FR-DEBT-012']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'terms']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Estado de cuenta del 2026-10-25 emitido; hoy 2026-10-27'
input:
  statementDay: '20'
  dueDay: '10'
steps:
  - 'PATCH de los términos con If-Match'
expected_result:
  - 'El estado del 2026-10-25 conserva el vencimiento 2026-11-15'
  - 'Ciclo abierto 2026-10-26..2026-11-20, vence 2026-12-10'
  - 'Plan de pago revisado desde su primera ocurrencia no resuelta'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-026 — Cambiar el día de cierre aplica desde el ciclo abierto

## Intención

Los estados emitidos son inmutables; los términos nuevos aplican hacia adelante.

## Escenario

```gherkin
Dado el estado de cuenta del 2026-10-25 emitido
Cuando cambio el cierre al día 20 y el vencimiento al 10
Entonces el ciclo abierto cierra el 2026-11-20 y vence el 2026-12-10
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
