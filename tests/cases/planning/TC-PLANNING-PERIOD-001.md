---
id: TC-PLANNING-PERIOD-001
title: El rango y la etiqueta del periodo se calculan según el día de inicio del mes financiero
spec: planning/financial-periods
related_specs: []
requirement: Periodo financiero mensual según el día de inicio
scenario: Día de inicio 25 por fecha de cobro del salario
requirement_status: confirmed
fr:
  - FR-PLANNING-001
  - FR-IDENTITY-005
nfr:
  - NFR-USAB-004
invariants: []
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/period-calendar.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - financial-periods
  - dates
error_code: null
preconditions:
  - Calendario de periodos puro (sin BD)
input:
  - startDay: 1
    labels:
      - 2026-10
      - 2026-02
      - 2028-02
  - startDay: 25
    labels:
      - 2026-10
      - 2026-12
  - startDay: 28
    labels:
      - 2027-01
      - 2027-02
steps:
  - Calcular el rango de cada etiqueta con cada día de inicio
expected_result:
  - "Día 1: 2026-10 = 2026-10-01..2026-10-31; 2026-02 = 2026-02-01..2026-02-28; 2028-02 = 2028-02-01..2028-02-29"
  - "Día 25: 2026-10 = 2026-10-25..2026-11-24; 2026-12 = 2026-12-25..2027-01-24"
  - "Día 28: 2027-01 = 2027-01-28..2027-02-27; 2027-02 = 2027-02-28..2027-03-27"
  - La etiqueta es el año y mes de la fecha de inicio
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-PERIOD-001 — El rango y la etiqueta del periodo se calculan según el día de inicio del mes financiero

## Intención

El periodo financiero es la unidad que se planifica y se cierra; un rango mal calculado bloquearía días de otro periodo (INV-015) o dejaría días sin periodo. Cubre fin de mes, febrero y año bisiesto (RISK-020).

## Escenario

```gherkin
Dado que el workspace tiene día de inicio 25
Cuando se calcula el periodo "2026-10"
Entonces va del 2026-10-25 al 2026-11-24
  Y el periodo "2026-12" va del 2026-12-25 al 2027-01-24
```

## Notas

- Los otros dos scenarios del requirement (día 1 y día 28) se verifican en el mismo test parametrizado.
- La etiqueta por mes de inicio está sujeta a la pregunta abierta P-A1 de add-financial-periods.
