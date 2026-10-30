---
id: TC-PLATFORM-THROUGHPUT-014
title: "El reporte del benchmark del import muestra por separado la configuración del código y la del host"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import mide también con la configuración del host"
scenario: "Dos configuraciones en el reporte"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/perf/imports.perf.ts
  - apps/api/test/perf/perf-report.test.ts
  - scripts/delivery-policy/test/nightly-policy.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "nightly", "perf", "D307"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Dos configuraciones en el reporte\" del delta de optimize-consumer-throughput"
steps:
  - "el job de rendimiento corre el benchmark del import"
expected_result:
  - "el reporte muestra una fila con la configuración del código y otra con la de la plantilla del host"
  - "la fila del host declara concurrencia 1, pool de 34 en el worker, 22 en la API y una suma de pools de 67 conexiones frente a 97 útiles"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-014 — El reporte del benchmark del import muestra por separado la configuración del código y la del host

## Intención

El benchmark nocturno del import de 5 000 filas DEBE (MUST) medir, además de la configuración por omisión del código, la configuración de la plantilla del host (concurrencia 1 por consumidor, pool de 34 en el worker y de 22 en la API), con la misma precondición de presupuesto de conexiones y el mismo drenado por consumidor; el reporte DEBE (MUST) mostrar ambas configuraciones por separado; por D311 la fila del host es bloqueante y la del código informativa.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando el job de rendimiento corre el benchmark del import
Entonces el reporte muestra una fila con la configuración del código y otra con la de la plantilla del host
  Y la fila del host declara concurrencia 1, pool de 34 en el worker, 22 en la API y una suma de pools de 67 conexiones frente a 97 útiles
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
- 2026-10-29 (change 52 `add-bulk-imported-transactions`, D359): con la escritura masiva, esta fila bloqueante (configuración del host) es también la fila de la ráfaga del import: exige la persistencia de 5 000 filas ≤ 20 s por omisión (D152) además del drenado ≤ 120 s por consumidor; `throughput.perf.ts` sigue informativa.
