---
id: TC-FORECAST-ANOMALY-017
title: "El detalle de la transacción muestra la marca de atípico con su motivo"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Lista de gastos atípicos y marca en la transacción"
scenario: "Marca en el detalle"
requirement_status: confirmed
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
  - apps/web/src/ui/spending-anomalies/spending-anomalies.test.tsx
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - tests/e2e/specs/spending-anomalies.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto de 304.00 BOB está marcado como atípico"
  - "un miembro abre su detalle en la web"
expected_result:
  - "el detalle muestra la marca de atípico con el motivo y el enlace a /gastos-atipicos"
  - "la marca también aparece en la fila del listado de transacciones"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-017 — El detalle de la transacción muestra la marca de atípico con su motivo

## Intención

Verifica el scenario "Marca en el detalle" del requirement "Lista de gastos atípicos y marca en la transacción" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el gasto de 304.00 BOB está marcado como atípico
Y un miembro abre su detalle en la web
Entonces el detalle muestra la marca de atípico con el motivo y el enlace a /gastos-atipicos
Y la marca también aparece en la fila del listado de transacciones
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
