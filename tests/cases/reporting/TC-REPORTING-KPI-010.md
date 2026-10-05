---
id: TC-REPORTING-KPI-010
title: "Cada categoría del top trae su neto del mismo tramo del mes anterior"
spec: reporting/dashboard
related_specs: []
requirement: "Monto anterior por categoría del top"
scenario: "Supermercado contra el mismo tramo de agosto"
requirement_status: confirmed
fr: ["FR-REPORTING-004"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: medium
type: unit
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/kpi-calculator.test.ts
  - apps/web/src/ui/dashboard/DashboardView.test.tsx
status: automated
regression_suite: false
phase: 1
tags: ["kpi","categories","mom"]
error_code: null
preconditions:
  - "FixedClock en 2026-09-15T12:00:00-04:00"
  - "Supermercado: 2026-08-01..15 = 1200.00 BOB; 2026-09-01..15 = 1305.00 BOB"
  - "Fees 5.00 BOB solo en septiembre"
input: {"compare":"PREVIOUS_PERIOD_TO_DATE","edge":{"previous_without_rate":"10.00 USD en Restaurantes sin tasa"}}
steps:
  - "Consultar el resumen del mes en curso"
  - "Consultar con compare=NONE"
expected_result:
  - "Supermercado: previousAmount 1200.00 BOB; Fees: previousAmount 0.00 BOB"
  - "Un monto anterior sin tasa deja previousAmount = null (nunca 1:1)"
  - "Con compare=NONE previousAmount = null en ambos tops"
  - "El Home muestra la variación por categoría sin una segunda consulta"
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-KPI-010 — Cada categoría del top trae su neto del mismo tramo del mes anterior

## Intención

Q7 básico por categoría en una sola lectura: el Home ya no pide un segundo resumen del periodo anterior (que además
podía dejar fuera del top una categoría y obligaba a decir "sin dato").

## Escenario

```gherkin
Dado que el 2026-09-15 Supermercado suma 1305.00 BOB del 1 al 15 de septiembre y 1200.00 BOB del 1 al 15 de agosto
Y Fees 5.00 BOB solo en septiembre
Cuando consulto el resumen del mes en curso
Entonces Supermercado trae 1200.00 BOB como monto anterior y Fees 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
