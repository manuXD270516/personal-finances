---
id: TC-PLATFORM-STACK-005
title: El código de aplicación y las definiciones de contenedores no contienen direcciones localhost ni 127.0.0.1 fijas
spec: platform/local-environment
related_specs: []
requirement: Configuración por entorno sin secretos en el repositorio
scenario: Sin localhost fijo
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-007
- NFR-PORT-005
invariants: []
priority: high
type: platform
level: architecture
automation_status: automated
automated_tests: ["scripts/stack/test/hosts-check.test.ts"]
status: automated
regression_suite: false
phase: 1
tags:
- config
- portability
error_code: null
preconditions:
- Chequeo estático de hosts fijos configurado en el quality gate
- 'Exclusiones declaradas: documentación (docs/, *.md), fixtures y arneses de test, bloques healthcheck de Compose / HEALTHCHECK de Dockerfile (loopback del propio contenedor) y líneas marcadas pf-allow-loopback'
input:
  patterns:
  - localhost
  - 127.0.0.1
  scope:
  - apps/**
  - packages/**
  - docker/**
  - deploy/compose/**
  excluded:
  - docs/**
  - '**/*.md'
  - '**/__fixtures__/**'
  - '**/test/**'
  - '**/*.test.ts'
steps:
- Ejecutar el chequeo estático de hosts fijos sobre el repositorio
- Ejecutar el chequeo contra un fixture que contiene una URL http://localhost:5432 fija en código de aplicación
expected_result:
- 'Sobre el repositorio real: cero ocurrencias y código de salida 0'
- 'Sobre el fixture: el chequeo falla e indica archivo y línea de la ocurrencia'
- Las direcciones de servicios se leen de variables de entorno documentadas en .env.example
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-005 — El código de aplicación y las definiciones de contenedores no contienen direcciones localhost ni 127.0.0.1 fijas

## Intención

Las direcciones de servicios deben resolverse por configuración para que el mismo artefacto funcione en local, CI y cloud (NFR-PORT-005).

## Escenario

```gherkin
Dado el código de aplicación y las definiciones de contenedores
Cuando se buscan direcciones "localhost" o "127.0.0.1" fijas fuera de documentación y fixtures de test
Entonces no se encuentra ninguna ocurrencia
```

## Notas

- El scenario "El archivo de ejemplo no contiene secretos" lo verifica el escaneo de secretos del quality gate (TC-PLATFORM-PIPELINE-001).
