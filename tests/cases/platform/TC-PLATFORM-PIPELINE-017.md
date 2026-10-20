---
id: TC-PLATFORM-PIPELINE-017
title: "Si la política RLS cambia el método de acceso del plan, la consulta es brecha aunque el tiempo no lo demuestre"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Sobrecosto de RLS con un criterio robusto al ruido de medición"
scenario: "La política cambia el plan de la consulta"
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
tags: ["nightly", "perf", "rls", "plan"]
error_code: null
preconditions:
  - "Plan sin RLS: Index Only Scan sobre el índice de saldos"
  - "Plan con RLS: Seq Scan sobre la tabla de postings"
input:
  plan_without: "Index Only Scan (índice de saldos)"
  plan_with: "Seq Scan (postings)"
  ci95_ms: ["0.05","0.40"]
steps:
  - "Calcular el resultado de RLS con planes distintos y una diferencia de tiempo no demostrada"
expected_result:
  - "passed = false con veredicto \"plan distinto\""
  - "Las notas muestran ambos métodos de acceso"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-017 — Si la política RLS cambia el método de acceso del plan, la consulta es brecha aunque el tiempo no lo demuestre

## Intención

Perder el índice es la regresión más grave que puede introducir una política y no depende del ruido de medición.

## Escenario

```gherkin
Dada la consulta de saldo por cuenta con acceso solo por índice sin RLS
Cuando con RLS el plan pasa a un recorrido secuencial
Entonces es brecha aunque la diferencia de tiempo no esté demostrada
  Y el reporte muestra ambos métodos
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- `provisional` hasta que el owner confirme el piso absoluto de 0.5 ms (pregunta 4 de docs/44).
- Automatizado (2026-10-20): `perf-report.test.ts`; `plan distinto` si cambia el método de acceso o el índice de alguna sentencia; las notas muestran ambos. `provisional` hasta la respuesta a la pregunta 4 de docs/44.
