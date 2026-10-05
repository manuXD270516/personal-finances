---
id: TC-REPORTING-NETWORTH-012
title: "El rango de la serie se valida y por defecto cubre doce meses"
spec: reporting/net-worth
related_specs: []
requirement: "Rango de la serie de patrimonio"
scenario: "Rango con meses futuros"
requirement_status: provisional
fr: [FR-REPORTING-006]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["net-worth", "validation"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "FixedClock 2026-04-12T12:00:00-04:00"
input:
  - "{\"from\":\"2026-01\",\"to\":\"2026-06\"}"
  - "{\"from\":\"2026-03\",\"to\":\"2026-01\"}"
  - "{\"from\":\"2016-01\",\"to\":\"2026-04\"}"
  - "{}"
  - "{\"reportingCurrency\":\"EUR\"}"
steps:
  - "Pedir la serie con cada parámetro"
expected_result:
  - "Meses futuros, rango invertido y > 120 meses: 400 VALIDATION_FAILED"
  - "Sin rango: 12 puntos de 2025-05 a 2026-04"
  - "EUR no habilitada: 422 CURRENCY_NOT_ENABLED"
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-NETWORTH-012 — El rango de la serie se valida y por defecto cubre doce meses

## Intención

Acota el costo de cálculo y evita puntos sin sentido.

## Escenario

```gherkin
Dado hoy 2026-04-12
Cuando se pide la serie de enero a junio de 2026
Entonces se rechaza con "VALIDATION_FAILED"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
