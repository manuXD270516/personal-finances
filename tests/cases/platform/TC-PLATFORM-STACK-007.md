---
id: TC-PLATFORM-STACK-007
title: El perfil deps levanta solo las dependencias y no inicia ningún contenedor de aplicación
spec: platform/local-environment
related_specs: []
requirement: Perfiles seleccionables del stack
scenario: Solo dependencias
requirement_status: confirmed
fr: []
nfr:
- NFR-PORT-001
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
- compose
- profiles
error_code: null
preconditions:
- Stack detenido
- .env creado a partir de .env.example
input:
  command: docker compose --profile deps up -d
steps:
- Ejecutar el comando con el perfil deps
- Listar los contenedores en ejecución y su estado de salud
- Levantar core sin observability y listar los servicios de telemetría
expected_result:
- postgres, redis, object-storage, keycloak y mailpit quedan healthy
- No existe ningún contenedor finance-api, finance-worker ni finance-web en ejecución
- Levantar core sin observability no inicia ningún servicio de telemetría
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-007 — El perfil deps levanta solo las dependencias y no inicia ningún contenedor de aplicación

## Intención

El perfil deps habilita el flujo con hot reload en el host (mitigación de SPIKE-08 en Windows/WSL2).

## Escenario

```gherkin
Dado que el stack está detenido
Cuando el desarrollador levanta el perfil "deps"
Entonces solo arrancan los servicios de dependencias y quedan healthy
  Y no se inicia ningún contenedor de aplicación
```

## Notas

- El scenario "Observabilidad opcional" se verifica parcialmente con el último paso; la visibilidad de telemetría en la UI local se comprueba manualmente.
