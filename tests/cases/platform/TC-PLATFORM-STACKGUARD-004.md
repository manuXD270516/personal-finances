---
id: TC-PLATFORM-STACKGUARD-004
title: "PF_ALLOW_DEV_STACK_WIPE=pfos o una terminal interactiva permiten el borrado sobre pfos"
spec: platform/local-environment
related_specs: []
requirement: "Protección del stack de desarrollo del owner"
scenario: "Terminal interactiva o proyecto desechable"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-001"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - scripts/stack/test/project-guard.test.ts
status: automated
regression_suite: true
phase: 8
tags: ["compose","seguridad-operativa"]
error_code: null
preconditions:
  - "Entorno del script stack sin Docker; datos ficticios"
input: {}
steps:
  - "el owner opera en una terminal interactiva, o define PF_ALLOW_DEV_STACK_WIPE=pfos"
expected_result:
  - "la guarda no bloquea la operación"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-STACKGUARD-004 — PF_ALLOW_DEV_STACK_WIPE=pfos o una terminal interactiva permiten el borrado sobre pfos

## Intención

Verifica el scenario "Terminal interactiva o proyecto desechable" del requirement "Protección del stack de desarrollo del owner" de platform/local-environment (change fix-stack-project-guard; incidentes 2026-10-08 y 2026-11-27).

## Escenario

```gherkin
Cuando el owner opera en una terminal interactiva, o define PF_ALLOW_DEV_STACK_WIPE=pfos
Entonces la guarda no bloquea la operación
```

## Notas

- Automatizado en scripts/stack/test/project-guard.test.ts; no invoca Docker.
