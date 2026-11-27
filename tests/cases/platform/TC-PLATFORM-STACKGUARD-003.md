---
id: TC-PLATFORM-STACKGUARD-003
title: "El borrado sobre pfos sin terminal se niega aunque haya --yes"
spec: platform/local-environment
related_specs: []
requirement: "Protección del stack de desarrollo del owner"
scenario: "Borrado sobre pfos sin terminal"
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
  - "stack:down --volumes --yes, stack:reset o restore:local sobre pfos sin terminal y sin PF_ALLOW_DEV_STACK_WIPE=pfos"
expected_result:
  - "el comando se niega con un mensaje que explica el motivo"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-STACKGUARD-003 — El borrado sobre pfos sin terminal se niega aunque haya --yes

## Intención

Verifica el scenario "Borrado sobre pfos sin terminal" del requirement "Protección del stack de desarrollo del owner" de platform/local-environment (change fix-stack-project-guard; incidentes 2026-10-08 y 2026-11-27).

## Escenario

```gherkin
Cuando stack:down --volumes --yes, stack:reset o restore:local sobre pfos sin terminal y sin PF_ALLOW_DEV_STACK_WIPE=pfos
Entonces el comando se niega con un mensaje que explica el motivo
```

## Notas

- Automatizado en scripts/stack/test/project-guard.test.ts; no invoca Docker.
