---
id: TC-REPORTING-REPORTS-054
title: "El owner navega de una etiqueta a la porción, guarda la vista y la vuelve a abrir"
spec: reporting/financial-reports
related_specs: []
requirement: "Vistas de los reportes ampliados en la aplicación"
scenario: "De la etiqueta a la porción"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-019"]
nfr: ["NFR-USAB-101", "NFR-USAB-105"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["ui", "e2e", "a11y"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Datos de TC-REPORTING-REPORTS-039"
input: {}
steps:
  - "Abrir \"Gastos por etiqueta\" de 2026-10, tocar \"Viaje Cusco\" y \"Alojamiento\""
  - "Guardar la vista y reabrirla desde el menú"
  - "Ejecutar axe en desktop y móvil"
expected_result:
  - "Se ve la porción de 800.00 BOB y se llega a la transacción"
  - "La vista reabierta restaura los filtros"
  - "Sin violaciones de axe; textos en es/en/pt"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-054 — El owner navega de una etiqueta a la porción, guarda la vista y la vuelve a abrir

## Intención

La UI de los reportes ampliados mantiene el drill-down y la accesibilidad del núcleo.

## Escenario

```gherkin
Dado el reporte de gastos por etiqueta
Cuando el owner toca "Viaje Cusco" y "Alojamiento"
Entonces ve la porción del hotel de 800.00 BOB y llega a la transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
