---
id: TC-REPORTING-UPCOMING-006
title: "Cada tipo de monto se presenta según su regla y los pagos variables no suman con cero"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Montos según el tipo de monto"
scenario: "Cuatro tipos de monto"
requirement_status: provisional
fr: ["FR-REPORTING-016","FR-COMMITMENTS-004"]
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
  - "Workspace \"W1\" con moneda de reporte BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Ocurrencias no resueltas: \"Internet\" FIXED 199.00 BOB, \"Luz\" ESTIMATED 180.00 BOB, \"Gimnasio\" MIN_MAX 150.00–200.00 BOB, \"Agua\" VARIABLE"
input: {"days":30}
steps:
  - "Consultar los próximos pagos con days=30"
  - "Editar solo la ocurrencia de octubre de \"Luz\" a 195.00 BOB y consultar de nuevo"
expected_result:
  - "Internet 199.00 BOB; Luz 180.00 BOB marcado estimado; Gimnasio rango 150.00–200.00 BOB; Agua \"monto variable\" sin monto"
  - "Total = 579.00 BOB con withoutAmountCount = 1"
  - "Tras editar Luz: total = 594.00 BOB con withoutAmountCount = 1"
created: 2026-10-09
updated: 2026-10-09
---

# TC-REPORTING-UPCOMING-006 — Cada tipo de monto se presenta según su regla y los pagos variables no suman con cero

## Intención

FR-COMMITMENTS-004: las proyecciones usan el máximo del rango y un pago variable nunca se inventa ni se suma como 0.

## Escenario

```gherkin
Dadas Internet FIXED 199.00, Luz ESTIMATED 180.00, Gimnasio MIN_MAX 150.00–200.00 y Agua VARIABLE
Cuando consulto los próximos pagos
Entonces el total es 579.00 BOB con 1 pago sin monto
Cuando edito la ocurrencia de Luz a 195.00 BOB
Entonces el total es 594.00 BOB con 1 pago sin monto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
