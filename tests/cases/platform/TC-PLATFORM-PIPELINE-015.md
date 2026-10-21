---
id: TC-PLATFORM-PIPELINE-015
title: "Una diferencia de RLS de 0.56 ms cuyo intervalo de confianza no alcanza el piso de 0.5 ms no es brecha"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Sobrecosto de RLS con un criterio robusto al ruido de medición"
scenario: "Diferencia pequeña dentro del ruido"
requirement_status: confirmed
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: medium
type: platform
level: performance
automation_status: automated
automated_tests:
  - "apps/api/test/perf/perf-report.test.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "rls"]
error_code: null
preconditions:
  - "Muestras sintéticas de 200 pares con mediana sin RLS 1.02 ms y con RLS 1.58 ms"
  - "Mismo método de acceso e índice en ambos planes"
input:
  median_without_ms: "1.02"
  median_with_ms: "1.58"
  median_diff_ms: "0.56"
  ci95_ms: ["0.31","0.79"]
  floor_ms: "0.5"
  max_ratio: "10 %"
steps:
  - "Calcular el resultado de RLS con las muestras sintéticas"
expected_result:
  - "passed = true"
  - "El veredicto es \"no demostrada sobre el piso absoluto\""
  - "Las notas incluyen ambas medianas, la diferencia y su intervalo"
created: 2026-10-20
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-015 — Una diferencia de RLS de 0.56 ms cuyo intervalo de confianza no alcanza el piso de 0.5 ms no es brecha

## Intención

La fila "saldo por cuenta (índice INCLUDE)" falló con 54.9 % sobre una consulta de 1 ms, donde el 10 % (0.1 ms) está bajo la resolución de EXPLAIN ANALYZE. Una diferencia no demostrada no es brecha.

## Escenario

```gherkin
Dada una consulta bloqueante con 1.02 ms sin RLS y 1.58 ms con RLS
  Y un IC del 95 % de la diferencia de 0.31 a 0.79 ms con el mismo plan
Cuando se evalúa el criterio
Entonces no es brecha porque 0.31 ms no alcanza el piso de 0.5 ms
  Y el reporte muestra el intervalo y el motivo
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- `provisional` hasta que el owner confirme el piso absoluto de 0.5 ms (pregunta 4 de docs/44).
- Automatizado (2026-10-20): `apps/api/test/perf/perf-report.test.ts` con 200 pares sintéticos deterministas (IC95 por bootstrap con semilla fija). `provisional` hasta que el owner confirme el piso de 0.5 ms (pregunta 4 de docs/44; se implementó la recomendación).
- Verificado en GitHub (2026-10-20, run 39390841971): `perf` con el criterio nuevo. Dos filas daban «plan distinto» por falso positivo (`PgBalanceQuery.getAccountBalances`, diferencia 0,093 ms; `getBalance`, 0,039 ms): el plan con RLS añade los nodos de la política (`iam.workspace` e `iam.workspace_membership`). Seguimiento (2026-10-20): la comparación de plan ignora esas tablas y compara el acceso a las tablas de datos (`dataAccessSignature`, `RLS_POLICY_TABLES`). La fila `saldo por cuenta (índice INCLUDE)` dio «brecha demostrada» real (0,599 ms, IC95 [0,597, 0,602] ms, 1,69 vs 1,09 ms): se mantiene fuera de alcance (pregunta 5 de docs/44); el diagnóstico (tarea 5.3) queda abierto y el EXPLAIN ANALYZE con y sin RLS se incluye ahora en `perf-summary.md`. Se revisó el bootstrap: es correcto (un test con diferencias normales de σ = 0,3 ms y 200 pares da el semiancho teórico ≈ 0,05 ms); el IC estrecho refleja diferencias muy consistentes entre pares. Además, el orden dentro del par se alterna para no sesgar por caché.
- Verificado en GitHub (2026-10-20, run 39401809245): `perf` con NFR-PERF-002 p95 = 35,6 ms. Las filas `PgBalanceQuery.getAccountBalances` y `getBalance` seguían en «plan distinto» (0,097 y 0,039 ms): la firma de esas sentencias nombra las tablas SIN esquema (`EXPLAIN (FORMAT JSON)` sin `VERBOSE` no trae `Schema`) y el filtro solo conocía `iam.workspace`. Corregido en la rama de seguimiento 2 (2026-10-20): la captura usa `VERBOSE` y `dataAccessSignature` reconoce la tabla con y sin esquema; test con los planes reales. Pendiente de otra corrida de `nightly` para confirmarlo.
- Verificado en GitHub (2026-10-20, run 39411997796, nightly tras #152, commit db0df05): las filas `PgBalanceQuery.getAccountBalances` y `getBalance` dan veredicto OK (diferencias de 0,159 ms y 0,058 ms): el arreglo de la firma con esquema funcionó y desaparecieron los dos «plan distinto». `perf` siguió en rojo solo por la fila RLS `saldo por cuenta (índice INCLUDE)` (0,813 ms de diferencia, sobrecosto real; pregunta 5 de docs/44).
- Verificado en GitHub (2026-10-21, nightly manual run 39669892721 (2026-10-21 20:23 UTC, commit 68f01e5, tras #154)): `PgBalanceQuery.getAccountBalances` y `getBalance` dan veredicto OK (0,150 ms y 0,060 ms de diferencia); no reaparecen falsos «plan distinto».
- Confirmado (2026-10-21, D286 de [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)): el owner mantiene el piso absoluto de 0.5 ms (pregunta 4 de docs/44); `requirement_status` pasa a `confirmed`.
