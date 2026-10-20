---
id: TC-PLATFORM-PIPELINE-018
title: "Los benchmarks del simulador de estrategias y de disponible para gastar no reciben rechazos por cuota"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Los benchmarks no miden la política de cuotas"
scenario: "El simulador de estrategias no recibe rechazos por cuota"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests:
  - "apps/api/test/perf/loan-simulator.perf.ts"
  - "apps/api/test/perf/spendable.perf.ts"
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "rate-limit"]
error_code: null
preconditions:
  - "API en proceso configurada con el helper compartido de entorno de benchmark"
  - "10 préstamos activos en BOB (simulador)"
input:
  requests: 200
  default_quotas: {"writes_per_min":120,"costly_per_min":10}
  threshold_p95_ms: 300
steps:
  - "Ejecutar las 200 simulaciones de estrategias en menos de un minuto"
  - "Ejecutar el benchmark de disponible para gastar"
expected_result:
  - "Ninguna respuesta es 429"
  - "El benchmark mide el p95 frente a su umbral"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-018 — Los benchmarks del simulador de estrategias y de disponible para gastar no reciben rechazos por cuota

## Intención

loan-simulator.perf (TC-DEBT-AMORT-045) y spendable.perf fallaron con 429 en la corrida #12: medían la política de cuotas, no la latencia.

## Escenario

```gherkin
Dado el benchmark del simulador con el entorno compartido
Cuando envía 200 simulaciones en menos de un minuto
Entonces ninguna respuesta es un rechazo por cuota
  Y se mide el p95 frente a 300 ms
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
