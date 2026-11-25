---
id: TC-FORECAST-ANOMALY-005
title: "Un gasto atípico por categoría y por contraparte es uno solo con dos motivos"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su contraparte"
scenario: "Atípico por contraparte y por categoría"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
  - packages/contexts/forecasting/src/domain/spending-anomaly-detector.test.ts
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
  - "los 10 gastos con \"Pizzería Demo\" en la categoría Restaurantes de los 365 días anteriores tienen mediana 95.00 BOB y MAD 8.00 BOB y la historia de \"Restaurantes\" es la de TC-FORECAST-ANOMALY-001"
  - "se registra un gasto de 304.00 BOB en \"Restaurantes\" con \"Pizzería Demo\""
expected_result:
  - "hay un solo gasto atípico con los motivos CATEGORY_OUTLIER (razón 3.8) y COUNTERPARTY_OUTLIER (razón 3.2)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-005 — Un gasto atípico por categoría y por contraparte es uno solo con dos motivos

## Intención

Verifica el scenario "Atípico por contraparte y por categoría" del requirement "Gastos atípicos para su contraparte" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando los 10 gastos con "Pizzería Demo" en la categoría Restaurantes de los 365 días anteriores tienen mediana 95.00 BOB y MAD 8.00 BOB y la historia de "Restaurantes" es la de TC-FORECAST-ANOMALY-001
Y se registra un gasto de 304.00 BOB en "Restaurantes" con "Pizzería Demo"
Entonces hay un solo gasto atípico con los motivos CATEGORY_OUTLIER (razón 3.8) y COUNTERPARTY_OUTLIER (razón 3.2)
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Modificado por `refine-spending-anomaly-calibration` (D488 y pregunta 1 de docs/80): la contraparte se compara dentro de su categoría principal y el MAD pasa a 8.00 BOB para que el puntaje (17.62) supere el umbral 15. El test automatizado se actualiza al implementar ese change; hasta entonces cubre la versión del change 72.
