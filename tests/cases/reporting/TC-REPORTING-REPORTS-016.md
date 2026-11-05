---
id: TC-REPORTING-REPORTS-016
title: "Un monto sin tasa queda fuera del consolidado, que se marca incompleto, y sigue visible en nativo"
spec: reporting/financial-reports
related_specs: []
requirement: "Montos sin tasa fuera del consolidado"
scenario: "Gasto en USDT sin tasa"
requirement_status: provisional
fr: ["FR-REPORTING-011", "FR-FX-006"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["conversion-policy", "missing-rate"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto 20.000000 USDT el 2026-10-20 sin tasa USDT/BOB en los 7 días anteriores"
input: {}
steps:
  - "Calcular el reporte de 2026-10"
expected_result:
  - "El consolidado no incluye el monto y complete = false"
  - "unconverted = [20.000000 USDT]"
  - "La vista nativa informa 20.000000 USDT"
  - "Nunca se convierte 1:1"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-016 — Un monto sin tasa queda fuera del consolidado, que se marca incompleto, y sigue visible en nativo

## Intención

RISK-017: un consolidado silenciosamente equivocado es peor que uno marcado incompleto.

## Escenario

```gherkin
Dado un gasto de 20.000000 USDT sin tasa vigente
Cuando se calcula el reporte de 2026-10
Entonces el consolidado se marca incompleto e informa 20.000000 USDT excluidos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
