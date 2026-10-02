---
id: TC-PLATFORM-STACK-001
title: "El perfil core de compose arranca y todos los servicios quedan saludables"
spec: platform/local-environment
related_specs: ["platform/observability"]
requirement: "Stack local con un solo comando"
scenario: "Clon limpio levanta el stack completo"
requirement_status: confirmed
fr: []
nfr: [NFR-PORT-001, NFR-PORT-002, NFR-PORT-003]
invariants: []
priority: high
type: platform
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["compose", "windows", "healthcheck"]
error_code: null
preconditions:
  - "Docker Desktop con WSL2 (Windows) o Docker Engine (CI en Linux)"
  - "Imágenes finance-api y finance-web construidas"
  - ".env creado a partir de .env.example"
input:
  command: "docker compose --profile core up -d"
  timeout: "5 min"
steps:
  - "Ejecutar el comando"
  - "Consultar docker compose ps periódicamente hasta que todos los servicios reporten estado"
  - "Inspeccionar el código de salida de migrate"
  - "Verificar los usuarios de los contenedores"
expected_result:
  - "postgres, redis, object-storage, mailpit, keycloak, finance-api, finance-worker, finance-web están healthy"
  - "migrate terminó con código 0"
  - "finance-api /health/ready = 200 y /health/live = 200"
  - "Los contenedores finance-* se ejecutan como non-root"
  - "Mismo resultado mediante pnpm stack:up en Windows"
created: 2026-10-01
updated: 2026-10-02
---

# TC-PLATFORM-STACK-001 — El perfil core de compose arranca y todos los servicios quedan saludables

## Intención

La paridad local es un requisito de primer nivel (ADR-0011/0012) y la base de las pruebas E2E.

## Escenario

```gherkin
Dado que las imágenes están construidas
Cuando se ejecuta "docker compose --profile core up"
Entonces todos los servicios del perfil core quedan healthy en menos de 5 minutos
```
