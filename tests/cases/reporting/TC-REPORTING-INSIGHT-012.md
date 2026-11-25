---
id: TC-REPORTING-INSIGHT-012
title: "El plan muestra el riesgo de la línea sin cambiar sus cifras"
spec: reporting/predictive-insights
related_specs: []
requirement: "Riesgo en el plan del periodo"
scenario: "Plan con una línea en riesgo"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-PLANNING-024"]
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "el 2026-11-10 \"Restaurantes\" tiene riesgo LIKELY"
  - "un miembro abre el plan de 2026-11 en la web"
expected_result:
  - "la línea \"Restaurantes\" muestra riesgo probable, proyección 840,00, exceso estimado el 22/11/2026 y «según el ritmo del periodo»"
  - "el planificado, el gastado, el restante y el disponible para gastar son los mismos que con la función deshabilitada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-012 — El plan muestra el riesgo de la línea sin cambiar sus cifras

## Intención

Verifica el scenario "Plan con una línea en riesgo" del requirement "Riesgo en el plan del periodo" de `reporting/predictive-insights` (FR-REPORTING-020, FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando el 2026-11-10 "Restaurantes" tiene riesgo LIKELY
Y un miembro abre el plan de 2026-11 en la web
Entonces la línea "Restaurantes" muestra riesgo probable, proyección 840,00, exceso estimado el 22/11/2026 y «según el ritmo del periodo»
Y el planificado, el gastado, el restante y el disponible para gastar son los mismos que con la función deshabilitada
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
