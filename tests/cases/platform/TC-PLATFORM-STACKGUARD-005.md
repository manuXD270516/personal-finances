---
id: TC-PLATFORM-STACKGUARD-005
title: "Los proyectos desechables no pasan por la guarda"
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
  - "el proyecto es pfos-test o pfos-e2e-nombre y no hay terminal"
expected_result:
  - "la operación destructiva con --yes se permite"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-STACKGUARD-005 — Los proyectos desechables no pasan por la guarda

## Intención

Verifica el scenario "Terminal interactiva o proyecto desechable" del requirement "Protección del stack de desarrollo del owner" de platform/local-environment (change fix-stack-project-guard; incidentes 2026-10-08 y 2026-11-27).

## Escenario

```gherkin
Cuando el proyecto es pfos-test o pfos-e2e-nombre y no hay terminal
Entonces la operación destructiva con --yes se permite
```

## Notas

- Automatizado en scripts/stack/test/project-guard.test.ts; no invoca Docker.
