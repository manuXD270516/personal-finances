---
id: TC-REPORTING-UPCOMING-012
title: "La ventana de próximos pagos usa la fecha local de La Paz y no la fecha UTC"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Ventana según la fecha en la zona del workspace"
scenario: "Consulta de noche en La Paz"
requirement_status: confirmed
fr: ["FR-REPORTING-016"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["upcoming-payments","timezone","RISK-020"]
error_code: null
preconditions:
  - "Workspace \"W1\" con TZ America/La_Paz"
  - "FixedClock en 2026-10-20T23:30:00-04:00 (2026-10-21T03:30:00Z)"
  - "Ocurrencias \"Agua\" FIXED 60.00 BOB (2026-10-27) y \"Luz\" 180.00 BOB (2026-10-28)"
input: {"days":7,"now":"2026-10-20T23:30:00-04:00"}
steps:
  - "Consultar los próximos pagos con days=7"
expected_result:
  - "Ventana 2026-10-20 a 2026-10-27"
  - "Agua aparece; Luz no aparece"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-012 — La ventana de próximos pagos usa la fecha local de La Paz y no la fecha UTC

## Intención

RISK-020: un cálculo en UTC correría la ventana un día de noche en Bolivia.

## Escenario

```gherkin
Dado que son las 23:30 del 2026-10-20 en La Paz
Cuando consulto los próximos pagos de 7 días
Entonces la ventana termina el 2026-10-27
  Y veo Agua pero no Luz
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
