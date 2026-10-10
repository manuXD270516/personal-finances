---
id: TC-REPORTING-SPENDABLE-008
title: "Un disponible negativo se muestra con su signo, como alerta y con su desglose, nunca como 0.00"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Disponible negativo explicado"
scenario: "Más comprometido que líquido"
requirement_status: provisional
fr: ["FR-REPORTING-001", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "warning"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Líquido 2000.00 BOB y 2600.00 BOB comprometidos desde líquidas"
  - "Sin reservas, aportes planificados ni reserva mínima"
input: {}
steps:
  - "Abrir el Home"
expected_result:
  - "La tarjeta Q5 muestra −600.00 BOB con estado de alerta (texto + icono)"
  - "Desglose 2000.00 BOB líquidos y −2600.00 BOB comprometidos"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-008 — Un disponible negativo se muestra con su signo, como alerta y con su desglose, nunca como 0.00

## Intención

FR-REPORTING-001: nunca un cero sustituto.

## Escenario

```gherkin
Dados 2000.00 BOB líquidos y 2600.00 BOB comprometidos
Cuando abro el Home
Entonces el disponible para gastar es −600.00 BOB marcado como alerta
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
