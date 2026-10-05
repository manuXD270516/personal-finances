---
id: TC-PLANNING-EVENT-003
title: El ciclo cerrar, reabrir y re-cerrar publica tres eventos en orden
spec: planning/month-closing
related_specs: []
requirement: Eventos de cierre y reapertura
scenario: Eventos del ciclo de octubre
requirement_status: provisional
fr:
  - FR-PLANNING-004
  - FR-PLANNING-006
nfr:
  - NFR-REL-008
invariants: []
priority: high
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - events
  - reopen
error_code: null
preconditions:
  - '"2026-10" terminado sin observaciones'
  - Usuarios EDITOR y OWNER
input:
  reason: Faltó registrar la comisión bancaria
steps:
  - Cerrar
  - Reabrir con motivo
  - Cerrar de nuevo
  - Leer el outbox en orden
expected_result:
  - MonthClosed closeNo 1, luego PeriodReopened reopenNo 1 con el motivo, luego MonthClosed closeNo 2
  - Ambos payloads validan contra sus schemas y los montos son string decimal con moneda
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-EVENT-003 — El ciclo cerrar, reabrir y re-cerrar publica tres eventos en orden

## Intención

Las proyecciones invalidan o congelan cifras de meses según estos eventos (docs/14 §11).

## Escenario

```gherkin
Dado que "2026-10" se cierra, se reabre y se cierra de nuevo
Entonces se publican en orden mes cerrado 1, periodo reabierto 1 y mes cerrado 2
```

## Notas

- Sin notas adicionales.
