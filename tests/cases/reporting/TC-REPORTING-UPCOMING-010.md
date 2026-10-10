---
id: TC-REPORTING-UPCOMING-010
title: "Sin tasa vigente el pago en USD queda sin convertir y el consolidado se marca incompleto"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Valoración de los próximos pagos en la moneda de reporte"
scenario: "Sin tasa vigente"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-FX-006","FR-REPORTING-001"]
nfr: []
invariants: ["INV-001"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["upcoming-payments","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y ventana de vigencia de 7 días"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Última tasa USD/BOB de cualquier origen del 2026-10-10"
  - "Ocurrencias \"Internet\" 199.00 BOB y \"Spotify\" 5.99 USD"
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "Spotify: 5.99 USD sin convertir"
  - "Consolidado = 199.00 BOB, complete = false, unconverted = [5.99 USD]"
  - "Nunca 5.99 BOB (1:1)"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-010 — Sin tasa vigente el pago en USD queda sin convertir y el consolidado se marca incompleto

## Intención

Nunca inventar una tasa ni convertir 1:1 (FR-REPORTING-001).

## Escenario

```gherkin
Dada la última tasa USD/BOB fuera de la ventana de vigencia
Cuando consulto los próximos pagos
Entonces Spotify se muestra en 5.99 USD sin convertir
  Y el consolidado es 199.00 BOB marcado incompleto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
