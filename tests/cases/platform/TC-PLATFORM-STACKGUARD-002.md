---
id: TC-PLATFORM-STACKGUARD-002
title: "Variables de proyecto contradictorias o fuera de convención se rechazan"
spec: platform/local-environment
related_specs: []
requirement: "Protección del stack de desarrollo del owner"
scenario: "Variables contradictorias o fuera de convención"
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
  - "PF_E2E_PROJECT no empieza con pfos-e2e, o PF_COMPOSE_PROJECT y PF_E2E_PROJECT difieren"
expected_result:
  - "el comando falla antes de invocar Docker"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-STACKGUARD-002 — Variables de proyecto contradictorias o fuera de convención se rechazan

## Intención

Verifica el scenario "Variables contradictorias o fuera de convención" del requirement "Protección del stack de desarrollo del owner" de platform/local-environment (change fix-stack-project-guard; incidentes 2026-10-08 y 2026-11-27).

## Escenario

```gherkin
Cuando PF_E2E_PROJECT no empieza con pfos-e2e, o PF_COMPOSE_PROJECT y PF_E2E_PROJECT difieren
Entonces el comando falla antes de invocar Docker
```

## Notas

- Automatizado en scripts/stack/test/project-guard.test.ts; no invoca Docker.
