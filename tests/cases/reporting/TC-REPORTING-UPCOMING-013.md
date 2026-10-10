---
id: TC-REPORTING-UPCOMING-013
title: "El total comprometido de octubre suma compromisos y pendientes del periodo y excluye noviembre"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Total comprometido del periodo en el Home"
scenario: "Comprometido de octubre"
requirement_status: confirmed
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/upcoming-payments.api.test.ts
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/committed-period.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["committed","q4"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio 1 (periodo 2026-10 = 2026-10-01..2026-10-31)"
  - "FixedClock en 2026-10-20T10:00:00-04:00; USD/BOB PARALLEL 12.00 vigente"
  - "No resueltas: Netflix 49.00 BOB (2026-10-15), Internet 199.00 BOB, Spotify 5.99 USD, Luz ESTIMATED 180.00 BOB, Gimnasio MIN_MAX 150.00–200.00 BOB, Agua VARIABLE, Alquiler 2500.00 BOB (2026-11-01)"
  - "Pendiente \"Cena\" 300.00 BOB del 2026-10-18"
input: {"days":7}
steps:
  - "Consultar el bloque committed de los próximos pagos"
expected_result:
  - "Periodo 2026-10; total = 999.88 BOB"
  - "fromCommitments = 699.88 BOB; fromPending = 300.00 BOB"
  - "withoutAmountCount = 1; Alquiler no suma"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-013 — El total comprometido de octubre suma compromisos y pendientes del periodo y excluye noviembre

## Intención

Q4 / FR-COMMITMENTS-011: cuánto está comprometido en el periodo financiero vigente, en moneda base y sin inventar montos.

## Escenario

```gherkin
Dados los compromisos y la pendiente de octubre
Cuando abro el Home el 2026-10-20
Entonces el total comprometido de 2026-10 es 999.88 BOB
  Y 699.88 BOB son compromisos y 300.00 BOB pendientes, con 1 pago sin monto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
