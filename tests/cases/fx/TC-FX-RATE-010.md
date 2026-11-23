---
id: TC-FX-RATE-010
title: "Resolver un lote de tasas no recorre todas las candidatas por cada solicitud"
spec: fx/market-rates
related_specs: ["reporting/financial-reports"]
requirement: "Resolución de tasas por lote con costo acotado"
scenario: "Lote grande con muchas candidatas"
requirement_status: provisional
fr: ["FR-FX-004"]
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
tags: ["fx", "valuation", "perf", "complexity", "fix-trends-report-perf"]
error_code: null
preconditions:
  - "10 000 candidatas: USD/BOB y USDT/BOB PARALLEL y OFFICIAL diarias de 2 providers durante 3 años, más BTC/USD diaria (forma de producción con providers reales, más densa que el Large Seed)"
  - "Cada candidata envuelta para contar las lecturas de su `asOf` (contador del test, sin medir tiempo)"
input:
  requests: 2000
steps:
  - "Construir el resolvedor con las 10 000 candidatas y resolver 2 000 solicitudes (USD, USDT y BTC a BOB en días distintos, con cruzada para BTC)"
  - "Leer el contador de lecturas de `asOf`"
expected_result:
  - "Lecturas de `asOf` ≤ 2 × candidatas + 200 × solicitudes (≤ 420 000); la búsqueda lineal anterior hace más de 20 000 000"
  - "Mismo resultado que el oráculo de TC-FX-RATE-009 para esas 2 000 solicitudes"
created: 2026-11-23
updated: 2026-11-23
---

# TC-FX-RATE-010 — Costo acotado de resolver un lote de tasas

## Intención

La causa principal de la fila `report-trends-24m` cerca del umbral es que cada solicitud del lote recorre y vuelve a interpretar todas las candidatas del rango. Este caso fija, sin depender de la CPU del runner, que el costo deja de ser solicitudes × candidatas.

## Escenario

```gherkin
Dado un resolvedor con 10 000 tasas candidatas de 3 años
Cuando se resuelve un lote de 2 000 solicitudes
Entonces cada candidata se interpreta una vez al construir el índice y cada solicitud lee solo las de su par y su ventana
```

## Notas

- La cota usa un contador y no un tiempo, para que el test no dependa del runner.
- Change `fix-trends-report-perf`.
