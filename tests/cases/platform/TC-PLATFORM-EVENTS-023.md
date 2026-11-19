---
id: TC-PLATFORM-EVENTS-023
title: El apagado deja de tomar jobs aunque el relay tarde en terminar su lote en curso
spec: platform/event-delivery
related_specs: ["platform/local-environment"]
requirement: Apagado ordenado de la entrega de eventos
scenario: El relay tarda en terminar su lote y la cola ya no toma jobs
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-009
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 5
tags:
- graceful-shutdown
- worker
error_code: null
preconditions:
- Worker completo con el relay detenido dentro de un lote (tras encolar y antes de confirmar)
input:
  job: platform.probe encolado después de iniciar el apagado
steps:
- Confirmar un evento y esperar a que el relay quede dentro del lote
- Iniciar el apagado del worker sin esperarlo
- Encolar un job de diagnóstico y esperar más que varios ciclos de sondeo de pg-boss
- Liberar el lote del relay y esperar el fin del apagado
expected_result:
- El job sigue en estado created mientras el relay termina su lote
- El job sigue en created al terminar el apagado y su efecto no existe
created: 2026-11-18
updated: 2026-11-18
---

# TC-PLATFORM-EVENTS-023 — El apagado deja de tomar jobs aunque el relay tarde

## Intención

`close()` detenía el relay antes de la cola: mientras esperaba el lote del relay, pg-boss seguía sondeando y podía tomar jobs encolados tras la señal (NFR-REL-009). Causa del fallo de `[TC-PLATFORM-STACK-006]` en un runner lento (2026-11-18).

## Escenario

```gherkin
Dado un relay con un lote en curso
Cuando el worker inicia su apagado y luego se encola un job
Entonces el worker no lo toma, ni antes ni después de que el relay termine
```

## Notas

- Rojo previo: `expected 'completed' to be 'created'`.
- Change: `fix-worker-shutdown-drain-first`.
