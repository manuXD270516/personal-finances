---
id: TC-NOTIFICATIONS-ANOMALY-005
title: "El email de gasto atípico con opt-in sale en el idioma del destinatario"
spec: notifications/alerts
related_specs: []
requirement: "Emails de gastos atípicos sin montos salvo opt-in"
scenario: "Email en inglés con opt-in"
requirement_status: confirmed
fr: ["FR-NOTIFY-002","FR-NOTIFY-006"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/spending-anomaly-notifications.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["notifications","anomalies","i18n"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el EDITOR tiene locale \"en-US\" y activó el email del tipo y la inclusión de detalles"
  - "la pasada marca un gasto de 304.00 BOB"
expected_result:
  - "el email está en inglés y muestra el monto y el motivo con el formato de en-US"
created: 2026-11-25
updated: 2026-11-25
---

# TC-NOTIFICATIONS-ANOMALY-005 — El email de gasto atípico con opt-in sale en el idioma del destinatario

## Intención

Verifica el scenario "Email en inglés con opt-in" del requirement "Emails de gastos atípicos sin montos salvo opt-in" de `notifications/alerts` (FR-NOTIFY-002, FR-NOTIFY-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el EDITOR tiene locale "en-US" y activó el email del tipo y la inclusión de detalles
Y la pasada marca un gasto de 304.00 BOB
Entonces el email está en inglés y muestra el monto y el motivo con el formato de en-US
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
