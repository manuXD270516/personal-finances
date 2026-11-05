---
id: TC-REPORTING-REPORTS-026
title: "El owner navega del gráfico de gastos por categoría a la transacción y exporta el CSV"
spec: reporting/financial-reports
related_specs: []
requirement: "Sección de reportes en la aplicación"
scenario: "Del gráfico a la transacción"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-010", "FR-REPORTING-011"]
nfr: ["NFR-USAB-101", "NFR-USAB-105"]
invariants: []
priority: high
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
  - "Datos de 2026-10 de los scenarios"
input: {}
steps:
  - "Abrir /reportes y luego \"Gastos por categoría\" de 2026-10"
  - "Tocar \"Supermercado\" y una porción del panel"
  - "Comparar con el periodo anterior"
  - "Exportar CSV"
  - "Ejecutar axe en desktop y móvil"
expected_result:
  - "El panel muestra porciones que suman 3300.00 BOB y lleva al detalle de la transacción"
  - "La variación +26.67 % se muestra con texto e icono además del color"
  - "Gráfico con tabla de datos equivalente y bloque de conversión visible"
  - "Sin violaciones de axe; textos en es/en/pt"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-026 — El owner navega del gráfico de gastos por categoría a la transacción y exporta el CSV

## Intención

La UI expone el drill-down y la política de conversión de forma accesible.

## Escenario

```gherkin
Dado el reporte de gastos por categoría de 2026-10
Cuando el owner toca "Supermercado" y una porción
Entonces ve las porciones que suman 3300.00 BOB y llega a la transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
