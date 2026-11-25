---
id: TC-PLATFORM-WEBUI-013
title: "Sin preferencia de movimiento los esqueletos de carga del Home se animan"
spec: platform/web-interface
related_specs: ["reporting/dashboard"]
requirement: "Movimiento reducido declarado por componente"
scenario: "Sin preferencia de movimiento"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["motion"]
error_code: null
preconditions:
  - "Playwright con reducedMotion: 'no-preference'"
  - "las respuestas del Home demoradas"
input: {}
steps:
  - "el usuario abre el Home"
expected_result:
  - "los esqueletos tienen un animation-name distinto de none"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-013 — Sin preferencia de movimiento los esqueletos de carga del Home se animan

## Intención

Evita que, al quitar la regla global, una animación quede desactivada para todos por error.

## Escenario

```gherkin
Dado Playwright con reducedMotion: 'no-preference'
  Y las respuestas del Home demoradas
Cuando el usuario abre el Home
Entonces los esqueletos tienen un animation-name distinto de none
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
