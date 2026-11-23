---
id: TC-REPORTING-REPORTS-057
title: "La matriz de tendencias lee cada hecho una cantidad acotada de veces, sin importar periodos ni series"
spec: reporting/financial-reports
related_specs: []
requirement: "Cálculo de las tendencias sin recorrer los hechos por cada celda"
scenario: "Costo lineal en los gastos leídos"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
nfr: ["NFR-PERF-006"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 7
tags: ["trends", "perf", "complexity", "fix-trends-report-perf"]
error_code: null
preconditions:
  - "20 000 hechos generados (730 días, 12 categorías de primer nivel con subcategorías, BOB, USD, USDT y BTC) y 24 periodos calendario"
  - "La lista de hechos envuelta en un `Proxy` que cuenta las lecturas de elementos por índice y por iteración (contador del test, sin medir tiempo)"
  - "Política de conversión de prueba que cuenta las filas que recibe en cada valoración"
input:
  periods: 24
  facts: 20000
steps:
  - "Calcular la matriz con y sin normalización por día"
  - "Leer el contador de lecturas de hechos y la suma de filas recibidas por la política"
expected_result:
  - "Lecturas de hechos ≤ 2 × 20 000 (la implementación anterior hace más de 4 000 000: 8 series × 24 periodos más el ranking y los totales)"
  - "Filas recibidas por la política ≤ 3 × las agregaciones distintas (serie, día, moneda): una vez en su celda, una en el total de su serie y una en el ranking"
  - "Con 6 periodos las lecturas de hechos son las mismas que con 24"
created: 2026-11-23
updated: 2026-11-23
---

# TC-REPORTING-REPORTS-057 — Costo lineal de la matriz de tendencias

## Intención

La matriz de tendencias filtraba la lista completa de hechos por cada serie y cada periodo (más el ranking por categoría de primer nivel), un costo que crece con hechos × series × periodos y que a escala 1 se lleva el 44 % de la petición. Este caso fija el costo lineal sin depender de la CPU del runner.

## Escenario

```gherkin
Dado 20 000 hechos de gasto de 24 meses
Cuando se calcula la matriz de tendencias
Entonces cada hecho se lee a lo sumo dos veces, con 6 o con 24 periodos
```

## Notas

- Datos ficticios; montos como strings decimales.
- Change `fix-trends-report-perf`.
