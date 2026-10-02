---
id: TC-REPORTING-KPI-008
title: "Un gasto con fecha de negocio 30 de septiembre registrado de madrugada en UTC cuenta en septiembre"
spec: reporting/dashboard
related_specs: []
requirement: "Mes según la fecha de negocio en la zona del workspace"
scenario: "Gasto de fin de mes registrado de madrugada en UTC"
requirement_status: confirmed
fr: ["FR-REPORTING-004"]
nfr: ["NFR-USAB-004","NFR-DATA-011"]
invariants: []
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["kpi","timezone","period-boundary"]
error_code: null
preconditions:
  - "Workspace con TZ America/La_Paz (UTC−4)"
input: {"expense":{"amount":"150.00 BOB","businessDate":"2026-09-30","createdAt":"2026-10-01T02:30:00Z"}}
steps:
  - "Registrar el gasto"
  - "Consultar gastos de septiembre y de octubre"
expected_result:
  - "Septiembre incluye 150.00 BOB"
  - "Octubre no lo incluye"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-KPI-008 — Un gasto con fecha de negocio 30 de septiembre registrado de madrugada en UTC cuenta en septiembre

## Intención

RISK-020: los bordes de mes por zona horaria son fuente clásica de errores off-by-one.

## Escenario

```gherkin
Dado un gasto de 150.00 BOB con fecha de negocio 2026-09-30 registrado el 2026-10-01T02:30:00Z
Cuando consulto los gastos por mes
Entonces cuenta en septiembre y no en octubre
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
