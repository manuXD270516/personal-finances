---
id: TC-PLATFORM-THROUGHPUT-012
title: "El nightly publica como informativo el costo por evento de cada consumidor con handler real"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Costo por evento de cada consumidor con handler real publicado"
scenario: "Publicación del costo por consumidor"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-008"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: automated
automated_tests:
  - apps/api/test/perf/perf-report.test.ts
  - apps/api/test/perf/throughput.perf.ts
  - scripts/delivery-policy/test/nightly-policy.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["event-delivery", "throughput", "D301", "nightly", "perf", "D300"]
error_code: null
preconditions:
  - "Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor"
  - "Workspaces ficticios \"W1 Personal Demo\" y \"W2 Familia Demo\""
input: "Datos del scenario \"Publicación del costo por consumidor\" del delta de optimize-consumer-throughput"
steps:
  - "el job de rendimiento mide la ráfaga de 5 000 transacciones importadas"
expected_result:
  - "el resumen publica, para cada uno de los consumidores que reciben esos eventos, la duración p50 y p95 por evento, el ritmo con el consumidor como único activo y las esperas por bloqueos"
  - "cada una de esas filas está marcada como informativa"
created: 2026-10-29
updated: 2026-10-29
---

# TC-PLATFORM-THROUGHPUT-012 — El nightly publica como informativo el costo por evento de cada consumidor con handler real

## Intención

El benchmark nocturno DEBERÍA (SHOULD) publicar, para cada consumidor que recibe los eventos de las transacciones importadas, la duración por evento con su handler real (p50 y p95), el ritmo de procesamiento con ese consumidor como único activo, las esperas por bloqueos de base de datos observadas durante su drenado y, si está agrupado, los eventos por invocación.

## Escenario

```gherkin
Dado Runtime de consumidores de eventos sobre PostgreSQL real (Testcontainers) con inbox por consumidor
  Y Workspaces ficticios "W1 Personal Demo" y "W2 Familia Demo"
Cuando el job de rendimiento mide la ráfaga de 5 000 transacciones importadas
Entonces el resumen publica, para cada uno de los consumidores que reciben esos eventos, la duración p50 y p95 por evento, el ritmo con el consumidor como único activo y las esperas por bloqueos
  Y cada una de esas filas está marcada como informativa
```

## Notas

- Change: `optimize-consumer-throughput` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).

- **Evidencia (2026-11-24, change 63):** Nightlies programados 44760461447 (20-11), 44913986214 (21-11), 45032465801 (22-11), 45231166087 (23-11, cuenta por D449) y 45446974855 (24-11), todos con la migración de ADR-0034 (#246). La fase B de `throughput.perf.ts` (ritmo aislado de cada consumidor con handler real) completó en los cinco: `processed` igual a `pending` en los seis consumidores (p. ej. `reporting.data-version` 15 002 de 15 002 en 5,5 a 9,4 s) y las filas NFR-PERF-008 se publican como informativas sin decidir el veredicto (D300).
