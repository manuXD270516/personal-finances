---
id: TC-NOTIFICATIONS-ANOMALY-004
title: "El email de gasto atípico sin opt-in no lleva montos ni nombres"
spec: notifications/alerts
related_specs: []
requirement: "Emails de gastos atípicos sin montos salvo opt-in"
scenario: "Email sin opt-in"
requirement_status: provisional
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: high
type: security
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["notifications","anomalies","privacy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el OWNER activó el email del tipo gasto atípico sin opt-in de detalles"
  - "la pasada del 2026-11-13 marca un gasto de 304.00 BOB en \"Restaurantes\""
expected_result:
  - "el email indica 1 gasto atípico nuevo el 13/11/2026 con el enlace a la lista"
  - "el email no contiene 304.00, \"Restaurantes\" ni el nombre de la contraparte"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-ANOMALY-004 — El email de gasto atípico sin opt-in no lleva montos ni nombres

## Intención

Verifica el scenario "Email sin opt-in" del requirement "Emails de gastos atípicos sin montos salvo opt-in" de `notifications/alerts` (FR-NOTIFY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el OWNER activó el email del tipo gasto atípico sin opt-in de detalles
Y la pasada del 2026-11-13 marca un gasto de 304.00 BOB en "Restaurantes"
Entonces el email indica 1 gasto atípico nuevo el 13/11/2026 con el enlace a la lista
Y el email no contiene 304.00, "Restaurantes" ni el nombre de la contraparte
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
