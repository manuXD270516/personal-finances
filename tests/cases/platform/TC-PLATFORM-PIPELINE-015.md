---
id: TC-PLATFORM-PIPELINE-015
title: "Una diferencia de RLS de 0.56 ms cuyo intervalo de confianza no alcanza el piso de 0.5 ms no es brecha"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Sobrecosto de RLS con un criterio robusto al ruido de medición"
scenario: "Diferencia pequeña dentro del ruido"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-003, NFR-PERF-005]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests:
  - "apps/api/test/perf/perf-report.test.ts"
status: draft
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
updated: 2026-10-20
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
