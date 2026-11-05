---
id: TC-REPORTING-REPORTS-011
title: "La comparación con un rango personalizado indica la diferencia de días y normaliza por día a pedido"
spec: reporting/financial-reports
related_specs: []
requirement: "Comparación con un rango personalizado"
scenario: "Diez días contra un mes normalizados por día"
requirement_status: provisional
fr: ["FR-REPORTING-009"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["comparison"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto 2026-10-01 → 2026-10-10: 1000.00 BOB"
  - "Gasto 2026-09-01 → 2026-09-30: 3000.00 BOB"
input:
  compare: "CUSTOM"
  normalize: "PER_DAY | NONE"
steps:
  - "Comparar normalizando por día"
  - "Comparar sin normalizar"
expected_result:
  - "Normalizado: 100.00 BOB por día en ambos y variación 0.00 BOB"
  - "Sin normalizar: variación −2000.00 BOB y aviso de 10 y 30 días"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-011 — La comparación con un rango personalizado indica la diferencia de días y normaliza por día a pedido

## Intención

Evita conclusiones falsas al comparar rangos de distinta longitud.

## Escenario

```gherkin
Dado 1000.00 BOB en 10 días y 3000.00 BOB en 30 días
Cuando se comparan normalizando por día
Entonces ambos informan 100.00 BOB por día y la variación es 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
