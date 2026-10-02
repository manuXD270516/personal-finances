---
id: TC-TRANSACTIONS-CONVERSION-009
title: "Registrar una tasa nueva no recalcula conversiones históricas"
spec: transactions/conversions
related_specs: ["fx/market-rates"]
requirement: "Las conversiones históricas no se recalculan"
scenario: "Nueva tasa posterior"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-024"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-012","INV-011"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["conversion","history","fast-check"]
error_code: null
preconditions:
  - "Conversión canónica del 2026-09-30 registrada"
input: {"new_rates":[{"pair":"USDT/BOB","value":"7.10","asOf":"2026-10-15"},{"supersede":"R2","value":"6.97"}],"numRuns_pr":100}
steps:
  - "Aplicar una secuencia aleatoria de registros y reemplazos de tasas"
  - "Releer la conversión y su asiento"
expected_result:
  - "targetAmount 685.00 BOB, effectiveRate 6.85, referencia 6.95 (R2) y spread sin cambios"
  - "Los postings del asiento son idénticos"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONVERSION-009 — Registrar una tasa nueva no recalcula conversiones históricas

## Intención

INV-012: los montos y la tasa efectiva de una conversión son hechos, no valoraciones.

## Escenario

```gherkin
Dada la conversión canónica del 2026-09-30
Cuando registro USDT/BOB = 7.10 para el 2026-10-15
Entonces la conversión sigue mostrando 685.00 BOB, efectiva 6.85 y referencia 6.95
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
