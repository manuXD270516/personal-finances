---
id: TC-FORECAST-SERVICE-040
title: "El recorrido de una corrida muestra solicitud, reintento, completado y reemplazo"
spec: audit/lifecycle-timeline
related_specs: ["forecast/expense-forecasting"]
requirement: "Recorrido de una corrida de pronóstico"
scenario: "Corrida reintentada y completada"
requirement_status: confirmed
fr: ["FR-AUDIT-009","FR-AUDIT-010","FR-FORECAST-006"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/src/domain/forecast-run.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["lifecycle","D37"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un EDITOR solicitó la corrida \"R3\", el primer intento falló porque el servicio no respondió y el segundo se completó, y luego la corrida \"R4\" la reemplazó"
expected_result:
  - "el recorrido de \"R3\" muestra solicitar por el EDITOR, iniciar, reintentar con el motivo servicio no disponible, iniciar, completar y reemplazar por \"R4\", con sus instantes"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-040 — El recorrido de una corrida muestra solicitud, reintento, completado y reemplazo

## Intención

Verifica el scenario "Corrida reintentada y completada" del requirement "Recorrido de una corrida de pronóstico" de `audit/lifecycle-timeline` (FR-AUDIT-009, FR-AUDIT-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un EDITOR solicitó la corrida "R3", el primer intento falló porque el servicio no respondió y el segundo se completó, y luego la corrida "R4" la reemplazó
Entonces el recorrido de "R3" muestra solicitar por el EDITOR, iniciar, reintentar con el motivo servicio no disponible, iniciar, completar y reemplazar por "R4", con sus instantes
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
