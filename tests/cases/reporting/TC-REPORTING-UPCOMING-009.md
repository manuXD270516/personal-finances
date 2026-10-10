---
id: TC-REPORTING-UPCOMING-009
title: "Un pago en USD se consolida en BOB con la tasa paralela vigente al consultar y se informa su fuente"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Valoración de los próximos pagos en la moneda de reporte"
scenario: "Pago en USD consolidado"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-FX-006","FR-REPORTING-001"]
nfr: []
invariants: ["INV-001","INV-002"]
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
  - "Workspace \"W1\" con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "USD/BOB PARALLEL 12.00 de paralelo.bo vigente al consultar; preferencia del par PARALLEL"
  - "Ocurrencias no resueltas \"Internet\" 199.00 BOB y \"Spotify\" 5.99 USD (2026-10-25)"
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
expected_result:
  - "Totales por moneda: 199.00 BOB y 5.99 USD"
  - "Consolidado = 270.88 BOB, complete = true"
  - "meta.rates incluye USD/BOB 12.00 PARALLEL con fuente paralelo.bo, vigencia y antigüedad"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-009 — Un pago en USD se consolida en BOB con la tasa paralela vigente al consultar y se informa su fuente

## Intención

D109: la lista usa la misma valoración que el resto del Home (FlowValuation), con la tasa de hoy para pagos futuros (conv_v(hoy) de docs/14).

## Escenario

```gherkin
Dadas Internet de 199.00 BOB y Spotify de 5.99 USD con USD/BOB PARALLEL 12.00
Cuando consulto los próximos pagos
Entonces el consolidado es 270.88 BOB con la tasa 12.00 de paralelo.bo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
