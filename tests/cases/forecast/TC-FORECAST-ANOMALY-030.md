---
id: TC-FORECAST-ANOMALY-030
title: "El motivo por contraparte nombra la categoría principal"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Motivo explicable de cada gasto atípico"
scenario: "Texto del motivo por contraparte"
requirement_status: confirmed
fr: ["FR-FORECAST-010", "FR-FORECAST-004"]
nfr: []
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/spending-anomalies/spending-anomalies.test.tsx
status: automated
regression_suite: false
phase: 9
tags: ["anomalies", "calibration", "i18n"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" en es-BO; gasto de 304.00 BOB en \"Restaurantes\" con \"Pizzería Demo\", atípico por contraparte frente a la mediana de 95.00 BOB de 10 gastos con \"Pizzería Demo\" en \"Restaurantes\""
input: {}
steps:
  - "el usuario abre la lista de gastos atípicos"
expected_result:
  - "el motivo dice que el gasto es 3,2 veces la mediana de \"Pizzería Demo\" en \"Restaurantes\" (95,00 BOB en los últimos 12 meses, 10 gastos)"
  - "el texto no habla de error ni de fraude"
created: 2026-11-25
updated: 2026-11-26
---

# TC-FORECAST-ANOMALY-030 — El motivo por contraparte nombra la categoría principal

## Intención

Verifica el scenario "Texto del motivo por contraparte" del requirement "Motivo explicable de cada gasto atípico" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" en es-BO; gasto de 304.00 BOB en "Restaurantes" con "Pizzería Demo", atípico por contraparte frente a la mediana de 95.00 BOB de 10 gastos con "Pizzería Demo" en "Restaurantes"
Cuando el usuario abre la lista de gastos atípicos
Entonces el motivo dice que el gasto es 3,2 veces la mediana de "Pizzería Demo" en "Restaurantes" (95,00 BOB en los últimos 12 meses, 10 gastos)
Y el texto no habla de error ni de fraude
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9). Se automatiza como prueba de la plantilla del motivo (como TC-FORECAST-ANOMALY-014), no como E2E: el E2E de gastos atípicos no cambia. Las marcas anteriores al change, sin categoría, usan la plantilla sin categoría. Textos con i18n es/en/pt. Datos ficticios; ningún dato real del owner.
