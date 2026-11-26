---
id: TC-PLATFORM-WEBUI-004
title: "Un enlace del resumen de errores lleva el foco a su campo"
spec: platform/web-interface
related_specs: []
requirement: "Resumen de errores en formularios largos"
scenario: "Ir al campo desde el resumen"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/web-interface.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["a11y","forms","error-summary"]
error_code: null
preconditions:
  - "el resumen de errores del alta de préstamo visible con tres errores"
input:
  enlace: "Tasa"
steps:
  - "el usuario activa con Enter el enlace \"Tasa\" del resumen"
expected_result:
  - "el foco queda en el campo de la tasa"
  - "el campo muestra su mensaje de error"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-004 — Un enlace del resumen de errores lleva el foco a su campo

## Intención

Comprueba que los enlaces del resumen mueven el foco y no solo desplazan la página (Safari no siempre mueve el foco con un ancla).

## Escenario

```gherkin
Dado el resumen de errores del alta de préstamo visible con tres errores
Cuando el usuario activa con Enter el enlace "Tasa" del resumen
Entonces el foco queda en el campo de la tasa
  Y el campo muestra su mensaje de error
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
