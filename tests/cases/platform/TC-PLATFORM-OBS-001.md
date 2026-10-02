---
id: TC-PLATFORM-OBS-001
title: El endpoint de liveness responde 200 aunque la base de datos no sea alcanzable
spec: platform/observability
related_specs:
- platform/local-environment
requirement: Endpoint de liveness
scenario: Liveness independiente de la base de datos
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-011
invariants: []
priority: high
type: platform
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/health.api.test.ts"]
status: automated
regression_suite: false
phase: 1
tags:
- healthcheck
- liveness
error_code: null
preconditions:
- Stack core en ejecución y healthy
input:
  endpoint: GET /health/live
  dependency_to_stop: postgres
steps:
- Detener postgres
- Llamar a GET /health/live de finance-api
- Volver a iniciar postgres
expected_result:
- GET /health/live responde 200 mientras postgres está detenido
- La respuesta no incluye detalles de dependencias ni secretos
- finance-api no es reiniciado por el orquestador durante la caída
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-OBS-001 — El endpoint de liveness responde 200 aunque la base de datos no sea alcanzable

## Intención

Liveness no debe depender de servicios externos para evitar ciclos de reinicio cuando cae una dependencia.

## Escenario

```gherkin
Dado que la base de datos no es alcanzable
Cuando se consulta el endpoint de liveness
Entonces responde éxito
```

## Notas

- Readiness con dependencia caída: TC-PLATFORM-STACK-002.
