---
id: TC-PLATFORM-EVENTS-016
title: El fallo de un trabajo del lote no reintenta los demás
spec: platform/event-delivery
related_specs: []
requirement: Rendimiento sostenido de los consumidores
scenario: Un fallo dentro del lote no reintenta a los demás
requirement_status: provisional
fr: []
nfr:
- NFR-REL-008
- NFR-REL-012
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- batch
- retry
error_code: null
preconditions:
- Consumidor con lotes de 10
input:
  events: 'Un evento por agregado en 10 agregados; el del agregado A falla'
steps:
- Publicar los 10 eventos
- Consumir un lote
expected_result:
- Solo el evento del agregado A queda en reintento
- Los otros 9 se registran en el inbox una sola vez
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-EVENTS-016 — El fallo de un trabajo del lote no reintenta los demás

## Intención

Change `improve-event-throughput` (docs/33 D112): verificar el requirement "Rendimiento sostenido de los consumidores" de `platform/event-delivery`.

## Notas

- Borrador; pasa a `ready` cuando el owner apruebe el change (tarea 1.2).
