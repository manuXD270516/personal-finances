---
id: TC-REPORTING-REPORTS-055
title: "Las tendencias optimizadas devuelven exactamente la misma respuesta que la implementación anterior sobre datos generados"
spec: reporting/financial-reports
related_specs: ["fx/market-rates"]
requirement: "Cálculo de las tendencias sin recorrer los hechos por cada celda"
scenario: "Misma respuesta que antes con gastos en varias monedas"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-009"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/trend-matrix.equivalence.test.ts
  - packages/contexts/reporting/src/application/extended-reports.queries.test.ts
  - packages/contexts/transactions/src/infrastructure/nominal-amount.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["trends", "perf", "pbt", "equivalence", "fix-trends-report-perf"]
error_code: null
preconditions:
  - "Oráculo: copia literal de `TrendMatrix.build` de `main` 4cdc7689 (antes de este change), conservada solo en el archivo de test"
  - "Generador de hechos: 0 a 3 000 hechos (fecha, categoría, monto) en BOB, USD, USDT y BTC con la escala de cada moneda, montos positivos y negativos (reembolsos), fechas dentro y en el borde de los periodos"
  - "Árbol generado con 1 a 15 categorías de primer nivel y subcategorías (también hechos de categorías fuera del árbol), con empates de monto entre categorías de distinto nombre"
  - "Política de conversión de fecha de transacción y de fecha de corte, con tasas presentes y ausentes por (moneda, día)"
input:
  periods: [6, 12, 24]
  normalize: ["NONE", "PER_DAY"]
steps:
  - "Para cada caso generado (fast-check, ≥ 300 corridas, semilla fija y timeout explícito) calcular la matriz con el oráculo y con la implementación nueva"
  - "Comparar series, orden, nombres, celdas y totales: `byCurrency`, `consolidated`, `exact` (como texto decimal), `complete` y `unconverted`"
  - "Repetir en la capa de aplicación (`ExtendedReportsQueries.getTrends`) con dobles de los puertos: el DTO completo, incluidos `meta.conversion.ratesUsed` en el mismo orden, `meta.complete` y `meta.unconverted`"
expected_result:
  - "Igualdad profunda en todos los casos (mismo `exact` decimal, sin tolerancia)"
  - "Los casos de 9 categorías y de febrero y marzo normalizados de TC-REPORTING-REPORTS-041 siguen en verde sin cambios"
created: 2026-11-23
updated: 2026-11-23
---

# TC-REPORTING-REPORTS-055 — Equivalencia de las tendencias optimizadas con la implementación anterior

## Intención

`fix-trends-report-perf` cambia cómo se calcula la matriz de tendencias (una sola pasada sobre los hechos en lugar de filtrarlos por serie y periodo) sin cambiar el comportamiento. Este caso fija que la respuesta es idéntica a la de la implementación anterior, celda por celda y con la suma exacta, sobre datos generados.

## Escenario

```gherkin
Dado un conjunto generado de gastos en BOB, USD, USDT y BTC sobre 6, 12 o 24 meses, con tasas presentes y ausentes
Cuando se calcula la matriz de tendencias con la implementación anterior y con la nueva
Entonces ambas devuelven las mismas series, en el mismo orden, con las mismas celdas, totales y completitud
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` (TZ America/La_Paz).
- El oráculo vive solo en el archivo de test y se conserva como regresión mientras el test exista.
- Change `fix-trends-report-perf`.
