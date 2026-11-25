---
id: TC-REPORTING-INSIGHT-013
title: "El texto del riesgo habla de ritmo y de fecha estimada"
spec: reporting/predictive-insights
related_specs: []
requirement: "Textos del riesgo por plantilla y sin certeza"
scenario: "Texto del riesgo probable"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-FORECAST-004"]
nfr: ["NFR-USAB-001","NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: unit
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
  - "\"Restaurantes\" tiene riesgo LIKELY con exceso estimado el 2026-11-22"
  - "se arma el texto con locale es-BO, en-US y pt-BR"
expected_result:
  - "en es-BO el texto dice que con el ritmo actual \"Restaurantes\" superaría su tope alrededor del 22/11/2026"
  - "ningún texto afirma que el exceso ocurrirá con certeza"
  - "existen los textos en inglés y portugués"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-013 — El texto del riesgo habla de ritmo y de fecha estimada

## Intención

Verifica el scenario "Texto del riesgo probable" del requirement "Textos del riesgo por plantilla y sin certeza" de `reporting/predictive-insights` (FR-REPORTING-020, FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Restaurantes" tiene riesgo LIKELY con exceso estimado el 2026-11-22
Y se arma el texto con locale es-BO, en-US y pt-BR
Entonces en es-BO el texto dice que con el ritmo actual "Restaurantes" superaría su tope alrededor del 22/11/2026
Y ningún texto afirma que el exceso ocurrirá con certeza
Y existen los textos en inglés y portugués
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
