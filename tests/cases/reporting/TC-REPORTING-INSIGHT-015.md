---
id: TC-REPORTING-INSIGHT-015
title: "Con el riesgo de presupuesto el worker mantiene consumidores y conexiones"
spec: reporting/predictive-insights
related_specs: []
requirement: "Evaluación periódica del riesgo sin consumidores nuevos"
scenario: "Presupuesto de conexiones intacto"
requirement_status: provisional
fr: ["FR-REPORTING-020"]
nfr: ["NFR-REL-010"]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk","connections"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el worker arranca con la plantilla del host y REPORTING_BUDGET_RISK_ENABLED=true"
expected_result:
  - "la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función (28 + 4 = 32 de 34)"
  - "el riesgo se evalúa dentro de reporting.cash-flow-watch, sin trabajos nuevos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-015 — Con el riesgo de presupuesto el worker mantiene consumidores y conexiones

## Intención

Verifica el scenario "Presupuesto de conexiones intacto" del requirement "Evaluación periódica del riesgo sin consumidores nuevos" de `reporting/predictive-insights` (FR-REPORTING-020).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el worker arranca con la plantilla del host y REPORTING_BUDGET_RISK_ENABLED=true
Entonces la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función (28 + 4 = 32 de 34)
Y el riesgo se evalúa dentro de reporting.cash-flow-watch, sin trabajos nuevos
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
