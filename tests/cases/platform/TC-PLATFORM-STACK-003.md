---
id: TC-PLATFORM-STACK-003
title: El reset con seed minimal deja la base con exactamente la Minimal Seed y todas las migraciones aplicadas
spec: platform/local-environment
related_specs: []
requirement: Datos locales persistentes y reiniciables
scenario: Reset con seed
requirement_status: confirmed
fr: []
nfr:
- NFR-PORT-001
- NFR-REL-004
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
- seed
- reset
error_code: null
preconditions:
- Stack core en ejecución y healthy
- Base con datos creados previamente por el desarrollador
input:
  command: pnpm stack:reset -- --seed=minimal
steps:
- Crear datos adicionales a la seed (p. ej. una transacción extra)
- Ejecutar el comando de reset con seed minimal
- Consultar la tabla de control de migraciones
- Comparar el contenido de la base con el dataset esperado de la Minimal Seed
expected_result:
- El comando termina con código 0
- Todas las migraciones del repositorio figuran como aplicadas y no hay pendientes
- La base contiene exactamente los registros de la Minimal Seed (docs/29); los datos extra creados antes ya no existen
- El invariant checker del ledger no reporta violaciones tras el reset
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-STACK-003 — El reset con seed minimal deja la base con exactamente la Minimal Seed y todas las migraciones aplicadas

## Intención

Garantiza que cualquier desarrollador o test E2E pueda volver a un estado conocido y reproducible con un solo comando (docs/19).

## Escenario

```gherkin
Dado que la base local contiene datos creados por el desarrollador
Cuando se ejecuta "pnpm stack:reset -- --seed=minimal"
Entonces la base contiene exactamente el dataset de la Minimal Seed
  Y todas las migraciones están aplicadas
```

## Notas

- La persistencia entre reinicios (scenario "Los datos sobreviven al reinicio") se verifica en el mismo arnés: stack:down + stack:up conserva los datos.
- Dataset esperado: docs/29-seed-datasets.md.
