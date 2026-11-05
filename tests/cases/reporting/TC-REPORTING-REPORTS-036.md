---
id: TC-REPORTING-REPORTS-036
title: "La serie diaria del patrimonio valora cada día con la tasa de ese día"
spec: reporting/net-worth
related_specs: []
requirement: "Serie diaria del patrimonio"
scenario: "Sueldo del 5 de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-006"]
nfr: []
invariants: ["INV-012"]
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["net-worth", "daily"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Patrimonio 23000.00 BOB al 2026-10-04; sueldo 12000.00 BOB el 2026-10-05; tasas sin cambio"
input:
  granularity: "DAY"
steps:
  - "Pedir la serie diaria de 2026-10"
expected_result:
  - "2026-10-04 = 23000.00 BOB; 2026-10-05 = 35000.00 BOB"
  - "Nunca se usa la tasa de hoy para un día pasado"
  - "Un día sin tasa queda incompleto"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-036 — La serie diaria del patrimonio valora cada día con la tasa de ese día

## Intención

INV-012: el patrimonio de una fecha usa la tasa de esa fecha.

## Escenario

```gherkin
Dado un sueldo de 12000.00 BOB el 2026-10-05
Cuando se pide la serie diaria
Entonces el 2026-10-05 informa 35000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
