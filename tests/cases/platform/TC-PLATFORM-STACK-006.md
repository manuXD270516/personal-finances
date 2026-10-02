---
id: TC-PLATFORM-STACK-006
title: El worker que recibe SIGTERM a mitad de un job lo completa o lo devuelve a la cola sin marcarlo completado en falso
spec: platform/local-environment
related_specs: []
requirement: Apagado ordenado
scenario: El worker se detiene a mitad de un job
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-009
invariants: []
priority: high
type: platform
level: container-integration
automation_status: automated
automated_tests: ["scripts/stack/test/stack/stack.stack.test.ts"]
status: automated
regression_suite: false
phase: 1
tags:
- graceful-shutdown
- worker
error_code: null
preconditions:
- Stack core en ejecución y healthy
- Job de prueba del harness que escribe un efecto en la base y tarda ~5 s
- Período de gracia configurado (p. ej. 30 s)
input:
  signal: SIGTERM
  command: docker compose stop finance-worker
  job_duration: 5 s
steps:
- Encolar un job de prueba que sigue en curso al enviar la señal
- Enviar SIGTERM al contenedor del worker mientras el job está en curso
- Esperar el período de gracia y reiniciar el worker
- Inspeccionar el estado del job en la cola y sus efectos en la base
expected_result:
- Tras la señal el worker no toma jobs nuevos
- El job en curso termina dentro del período de gracia, o vuelve a la cola y se reintenta tras el reinicio
- Ningún job figura como completado sin que su efecto esté confirmado en la base
- El efecto del job existe exactamente una vez al final
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-006 — El worker que recibe SIGTERM a mitad de un job lo completa o lo devuelve a la cola sin marcarlo completado en falso

## Intención

Un apagado brusco no debe dejar jobs completados sin efectos ni efectos duplicados (NFR-REL-009).

## Escenario

```gherkin
Dado que el worker procesa un job
Cuando recibe una señal de terminación
Entonces el job se completa o se devuelve a la cola para reintento
  Y ningún job queda marcado como completado sin que sus efectos estén confirmados
```

## Notas

- La API aplica el mismo principio a peticiones HTTP en curso; este TC cubre el caso del worker.
