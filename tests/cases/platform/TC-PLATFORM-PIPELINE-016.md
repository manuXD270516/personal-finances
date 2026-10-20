---
id: TC-PLATFORM-PIPELINE-016
title: "Un sobrecosto de RLS demostrado sobre el 10 % y el piso absoluto es brecha y hace fallar el benchmark"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Sobrecosto de RLS con un criterio robusto al ruido de medición"
scenario: "Sobrecosto real demostrado"
requirement_status: provisional
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
  - "Muestras sintéticas de 200 pares con mediana sin RLS 10.00 ms y con RLS 13.00 ms"
input:
  median_without_ms: "10.00"
  median_with_ms: "13.00"
  ci95_ms: ["2.70","3.30"]
steps:
  - "Calcular el resultado de RLS con las muestras sintéticas"
  - "Construir el reporte con esa fila como bloqueante"
expected_result:
  - "passed = false con veredicto \"brecha demostrada\""
  - "El reporte lista la brecha con la consulta y la diferencia medida"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-016 — Un sobrecosto de RLS demostrado sobre el 10 % y el piso absoluto es brecha y hace fallar el benchmark

## Intención

El criterio nuevo no puede esconder una regresión real: una diferencia sostenida y grande sigue fallando.

## Escenario

```gherkin
Dada una consulta bloqueante con 10.00 ms sin RLS y 13.00 ms con RLS
  Y un IC del 95 % de la diferencia de 2.70 a 3.30 ms
Cuando se evalúa el criterio
Entonces es brecha y el benchmark falla indicando la consulta
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- `provisional` hasta que el owner confirme el piso absoluto de 0.5 ms (pregunta 4 de docs/44).
- Automatizado (2026-10-20): `perf-report.test.ts`; brecha demostrada con IC95 por encima del 10 % y de 0.5 ms; el reporte lista la fila y la diferencia. `provisional` hasta la respuesta a la pregunta 4 de docs/44.
- Verificado en GitHub (2026-10-20, run 39390841971): la fila `saldo por cuenta (índice INCLUDE)` es la única brecha demostrada por tiempo (0,599 ms, IC95 [0,597, 0,602] ms); `perf` sigue en rojo por ella hasta el change aparte (pregunta 5 de docs/44).
