---
id: TC-PLATFORM-EVENTS-019
title: "El worker arranca con el consumidor de observaciones dentro del pool y max_connections ampliados"
spec: platform/event-delivery
related_specs: ["fx/market-rates"]
requirement: "Rendimiento sostenido de los consumidores"
scenario: "Configuración que excede el pool de conexiones"
requirement_status: confirmed
fr: ["FR-FX-011"]
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: automated
automated_tests:
  - apps/api/test/events/event-throughput.int.test.ts
  - packages/platform/src/events/consumers.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["platform", "connections", "worker", "fx"]
error_code: null
preconditions:
  - "Plantilla del host con max_connections = 70 y DATABASE_POOL_MAX del worker = 34"
input: {"consumers": 28, "reserved": 4, "poolMax": 34}
steps:
  - "Arrancar el worker con la plantilla del host"
  - "Arrancar con una concurrencia sumada mayor que DATABASE_POOL_MAX"
expected_result:
  - "Con la plantilla arranca y registra fx.user-conversion-observations con concurrencia 1 (28 consumidores + 4 reservadas = 32 ≤ 34)"
  - "Con una concurrencia mayor que el pool el arranque falla indicando la concurrencia total y el pool"
  - "API 22 + worker 34 = 56 ≤ 70; TC-PLATFORM-EVENTS-018 en verde"
created: 2026-10-13
updated: 2026-10-13
---

# TC-PLATFORM-EVENTS-019 — El worker arranca con el consumidor de observaciones dentro del pool y max_connections ampliados

## Intención

D249: el único consumidor nuevo de la fase entra solo después de subir max_connections y validar el arranque.

## Escenario

```gherkin
Dado max_connections 70 y pool 34
Cuando arranca el worker
Entonces registra el consumidor nuevo
```

## Notas

- Sin Docker local, lo valida CI (test:stack).
