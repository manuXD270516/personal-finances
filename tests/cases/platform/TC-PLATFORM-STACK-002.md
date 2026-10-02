---
id: TC-PLATFORM-STACK-002
title: "finance-api no está listo hasta que PostgreSQL y el object storage (y Valkey, solo si está habilitado) responden"
spec: platform/observability
related_specs: ["platform/local-environment"]
requirement: "Readiness refleja dependencias críticas"
scenario: "API no lista sin base de datos"
requirement_status: confirmed
fr: []
nfr: [NFR-REL-011]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/health.api.test.ts", "packages/platform/src/health/readiness.test.ts", "scripts/stack/test/stack/stack.stack.test.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["healthcheck", "readiness"]
error_code: null
preconditions: ["Stack core en ejecución y healthy"]
input:
  dependency_to_stop: ["postgres", "object-storage"]
steps:
  - "Detener una dependencia"
  - "Llamar a /health/ready y /health/live"
  - "Volver a iniciar la dependencia"
  - "Llamar a /health/ready"
expected_result:
  - "Con una dependencia caída: /health/ready = 503 indicando la dependencia que falla (sin secretos), /health/live = 200"
  - "Tras reiniciarla: /health/ready devuelve 200 sin reiniciar finance-api"
  - "En un arranque limpio, finance-api no reporta ready antes de que las dependencias estén healthy"
created: 2026-10-01
updated: 2026-10-02
---

# TC-PLATFORM-STACK-002 — finance-api no está listo hasta que PostgreSQL y el object storage (y Valkey, solo si está habilitado) responden

## Intención

ARCHITECTURE §10: finance-api está healthy solo si PG y el storage responden (Valkey solo cuando `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`, perfil `valkey`); liveness es independiente para evitar ciclos de reinicio.

## Escenario

```gherkin
Dado que el stack core está healthy
Cuando se detiene el servicio "postgres"
Entonces "/health/ready" devuelve 503
  Y "/health/live" devuelve 200
```
