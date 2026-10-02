---
id: TC-PLATFORM-OBS-002
title: Las líneas de log de la API y del worker de una misma petición comparten el identificador de correlación
spec: platform/observability
related_specs: []
requirement: Logs estructurados y correlacionados
scenario: Correlación de una petición
requirement_status: confirmed
fr: []
nfr:
- NFR-OBS-001
- NFR-SEC-015
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- logging
- correlation
error_code: null
preconditions:
- Stack core en ejecución y healthy
- Endpoint de prueba del harness que encola un job asíncrono
input:
  endpoint: POST /test/enqueue
  header: 'X-Request-Id: 0191f0c2-0000-7000-8000-000000000001'
steps:
- Enviar una petición a un endpoint de prueba que encola un job
- Esperar a que el worker procese el job
- Recolectar los logs de finance-api y finance-worker
expected_result:
- Cada línea de log es JSON válido con timestamp, level, service, env y correlationId
- Todas las líneas de la petición en finance-api y del job en finance-worker llevan el mismo correlationId
- Sin header entrante, la API genera uno y lo propaga igualmente
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-OBS-002 — Las líneas de log de la API y del worker de una misma petición comparten el identificador de correlación

## Intención

Sin un identificador compartido no es posible seguir una operación a través de procesos (NFR-OBS-001).

## Escenario

```gherkin
Dada una petición que dispara un job asíncrono en el worker
Cuando la API la procesa y el worker ejecuta el job
Entonces las líneas de log de ambos procesos llevan el mismo identificador de correlación
```

## Notas

- Redacción de datos sensibles: TC-PLATFORM-OBS-003.
