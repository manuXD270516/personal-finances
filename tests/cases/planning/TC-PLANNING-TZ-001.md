---
id: TC-PLANNING-TZ-001
title: El periodo de un hecho lo determina su fecha de negocio y no el instante UTC
spec: planning/financial-periods
related_specs: []
requirement: Periodo determinado por la fecha de negocio
scenario: Gasto registrado a las 23:30 del último día del mes
requirement_status: provisional
fr:
  - FR-PLANNING-001
nfr:
  - NFR-USAB-004
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - financial-periods
  - timezone
  - RISK-020
error_code: null
preconditions:
  - Workspace en America/La_Paz, día de inicio 1, periodos "2026-10" y "2026-11"
input:
  - instant: 2026-11-01T03:30:00Z
    businessDate: 2026-10-31
    amount: "85.50"
    currency: BOB
  - startDay: 25
    dates:
      - 2026-11-24
      - 2026-11-25
  - changeTimeZone: America/La_Paz -> UTC
steps:
  - Registrar el gasto en el instante indicado con su fecha de negocio
  - Consultar el periodo que contiene la fecha del gasto
  - Con día de inicio 25, consultar los periodos de 2026-11-24 y 2026-11-25
  - Cambiar la zona horaria del workspace a UTC y repetir las consultas
expected_result:
  - El gasto de 85.50 BOB pertenece a "2026-10"
  - 'Con día 25: 2026-11-24 pertenece a "2026-10" y 2026-11-25 a "2026-11"'
  - Tras cambiar a UTC los rangos y las pertenencias no cambian
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TZ-001 — El periodo de un hecho lo determina su fecha de negocio y no el instante UTC

## Intención

RISK-020: un hecho cerca de medianoche no debe saltar de mes por la conversión a UTC.

## Escenario

```gherkin
Dado un workspace en America/La_Paz
Cuando se registra a las 2026-11-01T03:30Z un gasto de 85.50 BOB con fecha 2026-10-31
Entonces el gasto pertenece al periodo "2026-10"
```

## Notas

- Cubre los tres scenarios del requirement.
