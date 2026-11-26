---
id: TC-REPORTING-INSIGHT-014
title: "Con el servicio de pronósticos detenido el riesgo se calcula con el ritmo"
spec: reporting/predictive-insights
related_specs: []
requirement: "Evaluación periódica del riesgo sin consumidores nuevos"
scenario: "Servicio de pronósticos apagado"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: medium
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/events/budget-risk.int.test.ts
  - packages/contexts/reporting/src/application/budget-risk.queries.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el servicio de pronósticos está detenido"
  - "un miembro pide GET /periods/{periodId}/budget-risk del periodo 2026-11"
expected_result:
  - "la respuesta es AVAILABLE y cada línea evaluada tiene base RUN_RATE"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-014 — Con el servicio de pronósticos detenido el riesgo se calcula con el ritmo

## Intención

Verifica el scenario "Servicio de pronósticos apagado" del requirement "Evaluación periódica del riesgo sin consumidores nuevos" de `reporting/predictive-insights` (FR-REPORTING-020, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el servicio de pronósticos está detenido
Y un miembro pide GET /periods/{periodId}/budget-risk del periodo 2026-11
Entonces la respuesta es AVAILABLE y cada línea evaluada tiene base RUN_RATE
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
