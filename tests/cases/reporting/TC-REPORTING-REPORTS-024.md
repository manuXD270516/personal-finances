---
id: TC-REPORTING-REPORTS-024
title: "El reporte responde 304 con la misma versión y refleja de inmediato una transacción nueva"
spec: reporting/financial-reports
related_specs: []
requirement: "Frescura y lectura condicional de los reportes"
scenario: "Lectura repetida sin cambios"
requirement_status: provisional
fr: ["FR-REPORTING-007"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["etag", "freshness"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Reporte de 2026-10 ya pedido una vez con su ETag"
input: {}
steps:
  - "Repetir con If-None-Match"
  - "Registrar un gasto de 80.00 BOB en \"Supermercado\" el 2026-10-20 y volver a pedir"
expected_result:
  - "304 sin cuerpo"
  - "La nueva lectura sube \"Supermercado\" en 80.00 BOB aunque el consumidor de versión de datos vaya atrasado"
  - "meta trae dataVersion, latestEntryAt y generatedAt"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-024 — El reporte responde 304 con la misma versión y refleja de inmediato una transacción nueva

## Intención

FR-REPORTING-007: frescura expuesta y read-your-writes por leer la fuente de verdad.

## Escenario

```gherkin
Dado un reporte ya leído
Cuando se repite con la misma versión
Entonces la respuesta es 304 sin cuerpo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
