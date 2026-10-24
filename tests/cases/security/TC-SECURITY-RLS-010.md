---
id: TC-SECURITY-RLS-010
title: "La fila saldo por cuenta (índice INCLUDE) del benchmark de RLS se publica como informativa y no falla aunque su brecha esté demostrada"
spec: security/access-control
related_specs: ["platform/delivery-pipeline"]
requirement: "Sobrecosto de RLS de la consulta de índice de saldo por cuenta como dato informativo"
scenario: "La fila de índice con sobrecosto demostrado se informa sin fallar"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["rls", "nightly", "perf"]
error_code: null
preconditions:
  - "Criterio de sobrecosto de RLS vigente (200 pares, IC95, 10 % y piso de 0.5 ms; D286)"
  - "Suite nightly.perf.ts del job perf"
input:
  pairs: 200
  median_without_rls_ms: "1.99"
  median_with_rls_ms: "2.80"
  ci95_ms: "0.800 a 0.811"
  gate: false
steps:
  - "Calcular el resultado de RLS de la fila con los pares de entrada y gate en falso"
  - "Generar el reporte (perf-summary.md y perf-results.json)"
  - "Leer la declaración de la fila en nightly.perf.ts"
expected_result:
  - "El veredicto es brecha demostrada y la fila no cuenta como fallo"
  - "El reporte publica la diferencia y su IC95 con la columna bloqueante en informativo"
  - "En nightly.perf.ts las únicas consultas de RLS informativas son la de índice INCLUDE y el agregado sintético"
created: 2026-10-21
updated: 2026-10-24
---

# TC-SECURITY-RLS-010 — La fila saldo por cuenta (índice INCLUDE) del benchmark de RLS se publica como informativa y no falla aunque su brecha esté demostrada

## Intención

El owner decidió no migrar las políticas (D298): la forma V2 quitaba el sobrecosto de esta fila (~0,8 ms) pero hacía fallar la consulta real de saldos. La fila se sigue midiendo y publicando con el mismo criterio, como el agregado sintético (D43), sin hacer fallar el job `perf`. Este caso lo fija en `unit` con los valores de la línea base y con un test de política sobre la declaración de las filas.

## Escenario

```gherkin
Dada la fila saldo por cuenta (índice INCLUDE) declarada como informativa
Cuando el benchmark mide 1.99 ms sin la política y 2.80 ms con ella, IC95 de 0.800 a 0.811 ms
Entonces el reporte publica la diferencia, su intervalo y el veredicto brecha demostrada como informativo
  Y el benchmark no falla por esa fila
```

## Notas

- Change `optimize-rls-policy-overhead`, reconvertido por D298 ([docs/49](../../../docs/49-rls-no-migration-decision.md)). Antes medía la fila tras la migración en el nightly; ahora es un test unitario y de política en `apps/api/test/perf/perf-report.test.ts` (tarea 4.1).
- **Mediciones de la fila INCLUDE:**
  - Línea base V0, run 39669892721 (2026-10-21): 2,80 frente a 1,99 ms, +0,805 ms, IC95 [0,800, 0,811], brecha demostrada (40–55 % según la corrida). Runs anteriores: 39401809245 +0,599 ms (IC95 [0,596, 0,603]) y 39411997796 +0,813 ms.
  - Experimento de #162 (13 000 postings, PostgreSQL 18.6): V0 +0,268 ms, V1 +0,269 ms, V2 0,000 ms, V3a +0,263 ms, V3b +0,274 ms.
  - Fase b con V2, run 39931324467 (Large Seed, PostgreSQL 18): fila INCLUDE sin brecha (≈ 0 ms), pero `PgBalanceQuery.getAccountBalances` +46,8 % (0,468 > 0,1) y `getBalance` +69 % (0,69 > 0,1), ambas «plan distinto» (`Bitmap Heap/Index Scan` → `Index Scan` sobre `ledger.journal_entry`), antes en OK. Por eso no se migra.
