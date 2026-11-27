---
id: TC-PLATFORM-STACKGUARD-001
title: "El proyecto sale de PF_COMPOSE_PROJECT, luego de PF_E2E_PROJECT y por último pfos"
spec: platform/local-environment
related_specs: []
requirement: "Protección del stack de desarrollo del owner"
scenario: "PF_E2E_PROJECT elige el proyecto"
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
  - "un comando stack con PF_E2E_PROJECT=pfos-e2e-pwa y sin PF_COMPOSE_PROJECT"
expected_result:
  - "opera sobre pfos-e2e-pwa y no sobre pfos"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-STACKGUARD-001 — El proyecto sale de PF_COMPOSE_PROJECT, luego de PF_E2E_PROJECT y por último pfos

## Intención

Verifica el scenario "PF_E2E_PROJECT elige el proyecto" del requirement "Protección del stack de desarrollo del owner" de platform/local-environment (change fix-stack-project-guard; incidentes 2026-10-08 y 2026-11-27).

## Escenario

```gherkin
Cuando un comando stack con PF_E2E_PROJECT=pfos-e2e-pwa y sin PF_COMPOSE_PROJECT
Entonces opera sobre pfos-e2e-pwa y no sobre pfos
```

## Notas

- Automatizado en scripts/stack/test/project-guard.test.ts; no invoca Docker.
