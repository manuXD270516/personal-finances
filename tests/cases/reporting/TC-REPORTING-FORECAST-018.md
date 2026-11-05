---
id: TC-REPORTING-FORECAST-018
title: "El job abre un episodio y publica una vez el riesgo detectado aunque el riesgo siga alto"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Detección periódica del riesgo de déficit"
scenario: "Primer riesgo alto"
requirement_status: provisional
fr: ["FR-REPORTING-015","FR-NOTIFY-004"]
nfr: []
invariants: []
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","shortfall","job"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Datos de déficit: \"Banco BOB\" 2000.00 BOB, \"Efectivo BOB\" 500.00 BOB; \"Cena\" pendiente 300.00 BOB; \"Internet\" 199.00 (2026-10-22), \"Luz\" 180.00 (2026-10-28), \"Alquiler\" 2500.00 y \"Sueldo\" 8000.00 el 2026-11-01, \"Pago de tarjeta · Visa Oro\" 1120.50 BOB (2026-11-15)"
  - "Reserva mínima 1500.00 BOB"
  - "FixedClock en 2026-10-20T08:25:00-04:00"
input: {"job":"reporting.cash-flow-watch"}
steps:
  - "Correr el job"
  - "Correr el job a las 09:25 y a las 10:25"
expected_result:
  - "Episodio abierto de BOB y un hecho reporting.CashFlowShortfallRiskDetected.v1 en el outbox"
  - "Sin hechos nuevos; episodio abierto"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-018 — El job abre un episodio y publica una vez el riesgo detectado aunque el riesgo siga alto

## Intención

Una alerta por episodio, no por evaluación (fatiga de alertas).

## Escenario

```gherkin
Dado FixedClock en 2026-10-20T08:25:00-04:00
Cuando Correr el job
Entonces Episodio abierto de BOB y un hecho reporting.CashFlowShortfallRiskDetected.v1 en el outbox
  Y Sin hechos nuevos; episodio abierto
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Detección periódica del riesgo de déficit" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
