---
id: TC-PLATFORM-EVENTS-015
title: Concurrencia 4 y lotes de 10 conservan el orden por agregado con un evento en reintento
spec: platform/event-delivery
related_specs: []
requirement: Orden de entrega por agregado
scenario: Un evento anterior en reintento retiene a los siguientes del mismo agregado
requirement_status: provisional
fr: []
nfr:
- NFR-REL-008
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- ordering
- concurrency
error_code: null
preconditions:
- Consumidor con concurrencia 4 y lotes de 10
- El evento v1 del agregado A falla una vez
input:
  events: 'v1..v5 del agregado A intercalados con eventos de otros 9 agregados'
steps:
- Publicar los eventos
- Consumir hasta drenar
expected_result:
- v2 del agregado A no se procesa antes de completar v1
- Los demás agregados avanzan mientras v1 está en reintento
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-EVENTS-015 — Concurrencia 4 y lotes de 10 conservan el orden por agregado con un evento en reintento

## Intención

Change `improve-event-throughput` (docs/33 D112): verificar el requirement "Orden de entrega por agregado" de `platform/event-delivery`.

## Notas

- Borrador; pasa a `ready` cuando el owner apruebe el change (tarea 1.2).
