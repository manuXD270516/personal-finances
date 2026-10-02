---
id: TC-PLATFORM-STACK-008
title: Si el job de migración falla, la API y el worker no se inician y el fallo es visible en los logs
spec: platform/local-environment
related_specs: []
requirement: Arranque ordenado por salud
scenario: Las migraciones condicionan a la API
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-011
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
- compose
- migrations
- healthcheck
error_code: null
preconditions:
- Stack detenido con volúmenes limpios
- Migración fixture que falla deliberadamente (error SQL)
input:
  command: docker compose --profile core up -d
  logs_command: pnpm stack:logs
steps:
- Levantar el perfil core con la migración defectuosa
- Listar el estado de los contenedores
- Ejecutar el comando de logs del stack
expected_result:
- El servicio migrate termina con código distinto de cero
- finance-api y finance-worker nunca pasan a estado running
- La salida de pnpm stack:logs muestra el error de la migración
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-008 — Si el job de migración falla, la API y el worker no se inician y el fallo es visible en los logs

## Intención

Ninguna versión de la aplicación debe arrancar sobre un schema a medio migrar (depends_on con service_completed_successfully).

## Escenario

```gherkin
Dado que el job de migración falla
Cuando se levanta el perfil core
Entonces los contenedores de API y worker no se inician
  Y el fallo de migración es visible en la salida del comando de logs
```

## Notas

- La espera por dependencias healthy en un arranque limpio también se observa en TC-PLATFORM-STACK-001 y TC-PLATFORM-STACK-002.
