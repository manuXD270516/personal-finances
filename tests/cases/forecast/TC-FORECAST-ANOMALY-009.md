---
id: TC-FORECAST-ANOMALY-009
title: "Los pagos vinculados a compromisos y las transacciones administradas no se evalúan"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos que se evalúan"
scenario: "Pago de una suscripción y cuota de préstamo"
requirement_status: confirmed
fr: ["FR-FORECAST-010","FR-FORECAST-003"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/spending-anomalies.api.test.ts
  - packages/contexts/forecasting/src/application/spending-anomalies.test.ts
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
  - "el pago de la suscripción \"Streaming\" quedó vinculado a su ocurrencia, la cuota de un préstamo es una transacción administrada por Deudas y un cargo de interés de tarjeta tiene debtRole CARD_CHARGE"
  - "los tres tienen montos que superarían los umbrales y corre el trabajo diario"
expected_result:
  - "ninguno de los tres se evalúa ni queda marcado"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-009 — Los pagos vinculados a compromisos y las transacciones administradas no se evalúan

## Intención

Verifica el scenario "Pago de una suscripción y cuota de préstamo" del requirement "Gastos que se evalúan" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando el pago de la suscripción "Streaming" quedó vinculado a su ocurrencia, la cuota de un préstamo es una transacción administrada por Deudas y un cargo de interés de tarjeta tiene debtRole CARD_CHARGE
Y los tres tienen montos que superarían los umbrales y corre el trabajo diario
Entonces ninguno de los tres se evalúa ni queda marcado
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
