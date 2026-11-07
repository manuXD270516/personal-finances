---
id: TC-REPORTING-REPORTS-041
title: "Tendencias mensuales con siete series más \"Otras categorías\" y normalización por día"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de tendencias mensuales"
scenario: "Febrero y marzo normalizados por día"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-REPORTING-009"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/extended-reports.domain.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
  - apps/web/src/ui/reports/extended-reports.test.tsx
status: automated
regression_suite: true
phase: 7
tags: ["trends"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Supermercado\": 2800.00 BOB en 2026-02 y 3100.00 BOB en 2026-03"
  - "Gasto en 9 categorías en el rango"
input:
  normalize: "PER_DAY"
steps:
  - "Calcular tendencias de 12 periodos normalizadas"
  - "Calcular sin normalizar"
expected_result:
  - "\"Supermercado\" 100.00 BOB por día en 2026-02 y 2026-03"
  - "7 series de categoría y una \"Otras categorías\" con las 2 restantes"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-041 — Tendencias mensuales con siete series más "Otras categorías" y normalización por día

## Intención

Evolución comparable entre meses de distinta longitud.

## Escenario

```gherkin
Dado 2800.00 BOB en febrero y 3100.00 BOB en marzo
Cuando se normaliza por día
Entonces ambos periodos informan 100.00 BOB por día
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
