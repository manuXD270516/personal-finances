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
automation_status: automated
automated_tests:
  - "apps/api/test/perf/loan-simulator.perf.ts"
  - "apps/api/test/perf/spendable.perf.ts"
  - "scripts/delivery-policy/test/nightly-policy.test.ts"
status: automated
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
updated: 2026-10-25
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
- Automatizado (2026-10-20): `loan-simulator.perf.ts` y `spendable.perf.ts` configuran la API con `perfApiEnv` (`apps/api/test/perf/perf-env.ts`, cuotas en 1 000 000). Guarda estática en `scripts/delivery-policy/test/nightly-policy.test.ts` (los `.perf.ts` no entran en el escáner de trazabilidad). Sin Docker en la sesión de implementación: la ejecución real queda para la corrida de `nightly` por `workflow_dispatch` (tarea 7.3).
- Verificado en GitHub (2026-10-20, run 39390841971): en el job `perf` las filas del simulador de estrategias y de disponible para gastar no figuran entre las que quedan en rojo; NFR-PERF-002 p95 = 30 ms (OK frente a 400 ms). Quedan en rojo solo la fila de RLS INCLUDE y TC-COMMITMENTS-MATCH-012, ambos fuera de alcance por decisión.
- Verificado en GitHub (2026-10-20, run 39401809245): las filas del simulador de estrategias y de disponible para gastar quedan fuera de las rojas; NFR-PERF-002 p95 = 35,6 ms. Rojas: RLS INCLUDE (real), RLS agregado sintético (informativo), RLS «plan distinto» ×2 (falso positivo, corregido) y TC-COMMITMENTS-MATCH-012.
- Verificado en GitHub (2026-10-21, nightly manual run 39669892721 (2026-10-21 20:23 UTC, commit 68f01e5, tras #154)): loan-simulator pasa (TC-DEBT-AMORT-045 incluido). **El criterio de p95 < 300 ms de disponible para gastar NO se cumple**: por primera vez se mide `spendable.perf.ts` (antes caía con 429 por las cuotas; el helper `perfApiEnv` de #150 las relajó) y dos tests con este TC fallan: `getReportSummary` con el bloque spendable, p95 352,2 ms, y `getSpendable` con 300 ocurrencias, p95 341,1 ms, ambos frente a 300 ms. La parte de este TC (sin rechazos por cuota) sí se cumple; la latencia no. Causa NO determinada: puede ser lentitud real o contención del runner (la suite corre tras benchmarks pesados y con el backlog de ~470 000 eventos del outbox en proceso). Se registra sin maquillar; investigación propuesta en un change aparte junto con `investigate-consumer-throughput` (docs/38 §4). Se mantiene `status: automated` (el test existe y mide); no se considera confirmado en GitHub hasta que el p95 cumpla.
- 2026-10-21 (D290, [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)): el p95 de disponible para gastar sobre 300 ms lo investiga el change `investigate-perf-under-load` (síntoma S2), que reemplaza la propuesta `investigate-consumer-throughput`. Este TC sigue sin darse por confirmado en GitHub hasta que el p95 cumpla.
- 2026-10-25 (informe del change 48, [docs/50](../../../docs/50-perf-under-load-findings.md), síntoma S2): la latencia sobre 300 ms se debe a la contención de CPU del host al empezar la suite (H2), no al código ni a las cuotas: en limpio, p95 de 54,27 ms de mediana para `getSpendable` [50,68, 56,67] (E1 ×3); con carga del host 7,5–7,96, 200–359 ms. Camino: arreglo del benchmark en el grupo 5 del change 48 (purga, quietud del host y orden determinista). Se dará por confirmado en GitHub cuando la tarea 7.2 del change 48 mida el p95 bajo 300 ms.
