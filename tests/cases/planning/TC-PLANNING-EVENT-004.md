---
id: TC-PLANNING-EVENT-004
title: El hecho de cierre pendiente se publica una sola vez por periodo tres días después de su fin
spec: planning/month-closing
related_specs:
  - notifications/alerts
requirement: Aviso de cierre pendiente
scenario: Octubre sin cerrar tres días después
requirement_status: confirmed
fr:
  - FR-PLANNING-003
  - FR-NOTIFY-004
nfr:
  - NFR-USAB-004
invariants:
  - INV-028
priority: high
type: integration
level: event-contract
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
  - packages/contexts/planning/src/application/closing.service.test.ts
status: automated
regression_suite: false
phase: 2
tags:
  - month-closing
  - events
  - month-close-pending
error_code: null
preconditions:
  - Workspace en America/La_Paz con día de inicio 1
  - '"2026-10" (del 2026-10-01 al 2026-10-31) active y "2026-09" closed'
  - PLANNING_CLOSE_PENDING_DELAY_DAYS = 3 (reloj fijo)
input:
  periodLabel: 2026-10
  periodEnd: 2026-10-31
steps:
  - Ejecutar el job de cierre pendiente con hoy = 2026-11-02 en La Paz
  - Ejecutarlo con hoy = 2026-11-03 (instante 2026-11-03T04:05Z) dos veces, una de ellas concurrente
  - Reabrir y dejar abierto "2026-10" y ejecutarlo con hoy = 2026-11-10
  - En otro workspace, cerrar "2026-10" el 2026-11-02 y ejecutarlo con hoy = 2026-11-03
expected_result:
  - El 2026-11-02 no se publica nada
  - 'El 2026-11-03 se publica exactamente un planning.MonthClosePending.v1 con periodId de "2026-10", periodLabel "2026-10", periodEnd 2026-10-31'
  - Ninguna ejecución posterior publica otro para "2026-10"
  - El periodo cerrado antes del plazo no genera el hecho
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-EVENT-004 — El hecho de cierre pendiente se publica una sola vez por periodo tres días después de su fin

## Intención

`add-alerts` traduce `planning.MonthClosePending.v1` en notificaciones de cierre pendiente (FR-NOTIFY-004) y deduplica por periodo; el productor garantiza que el hecho existe una sola vez por periodo y que se calcula con "hoy" en la zona horaria del workspace (RISK-020).

## Escenario

```gherkin
Dado "2026-10" active en un workspace de La Paz
Cuando el job corre el 2026-11-03 (tres días después del fin) varias veces
Entonces se publica un solo hecho de cierre pendiente de "2026-10"
```

## Notas

- Cubre también el scenario "Cerrado antes del plazo".
- El contrato del evento se valida contra `contracts/events/planning/MonthClosePending.v1.schema.json`.
