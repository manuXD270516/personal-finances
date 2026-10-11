---
id: TC-DEBT-CARD-007
title: 'Vencimiento en domingo con ajuste al lunes siguiente'
spec: debt/credit-cards
related_specs: []
requirement: 'Fechas de cierre y vencimiento del ciclo'
scenario: 'Vencimiento en domingo con ajuste al lunes'
requirement_status: confirmed
fr: ['FR-DEBT-013']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/card-cycle-calendar.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'dates']
error_code: null
preconditions:
  - '"Visa Oro" cierre 25, vencimiento 15, ajuste NEXT'
input:
  closing: '2026-10-25'
steps:
  - 'Calcular el vencimiento del ciclo'
expected_result:
  - 'Vence el lunes 2026-11-16 (2026-11-15 es domingo)'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-007 — Vencimiento en domingo con ajuste al lunes siguiente

## Intención

El ajuste de fin de semana mueve solo el vencimiento, como en el motor de recurrencia.

## Escenario

```gherkin
Dado "Visa Oro" con ajuste NEXT
Cuando calculo el vencimiento del ciclo que cierra el 2026-10-25
Entonces es el 2026-11-16
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
