---
id: TC-REPORTING-INSIGHT-001
title: "Restaurantes al ritmo del periodo proyecta 840,00 y riesgo probable"
spec: reporting/predictive-insights
related_specs: []
requirement: "Riesgo de exceder una línea de gasto"
scenario: "Restaurantes al ritmo del periodo"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-PLANNING-024"]
nfr: ["NFR-DATA-001","NFR-DATA-002"]
invariants: ["INV-001","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/events/budget-risk.int.test.ts
  - packages/contexts/reporting/src/application/budget-risk.queries.test.ts
  - packages/contexts/reporting/src/domain/budget-overrun-projector.test.ts
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
  - "\"Restaurantes\" tiene máximo 600.00 BOB, gastado 280.00 BOB y ningún pago conocido pendiente"
  - "se calcula el riesgo el 2026-11-10 (10 días transcurridos, 20 restantes)"
expected_result:
  - "la proyección es 840.00 BOB (280.00 + 280.00 / 10 × 20) y el riesgo es LIKELY"
  - "coincide con la proyección lineal del plan para esa línea"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-001 — Restaurantes al ritmo del periodo proyecta 840,00 y riesgo probable

## Intención

Verifica el scenario "Restaurantes al ritmo del periodo" del requirement "Riesgo de exceder una línea de gasto" de `reporting/predictive-insights` (FR-REPORTING-020, FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Restaurantes" tiene máximo 600.00 BOB, gastado 280.00 BOB y ningún pago conocido pendiente
Y se calcula el riesgo el 2026-11-10 (10 días transcurridos, 20 restantes)
Entonces la proyección es 840.00 BOB (280.00 + 280.00 / 10 × 20) y el riesgo es LIKELY
Y coincide con la proyección lineal del plan para esa línea
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
