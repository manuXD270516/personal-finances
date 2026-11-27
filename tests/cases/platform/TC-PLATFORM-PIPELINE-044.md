---
id: TC-PLATFORM-PIPELINE-044
title: "WebKit corre dentro del job e2e, sin check obligatorio nuevo y con la duración publicada"
spec: platform/delivery-pipeline
related_specs: ["platform/web-interface"]
requirement: "WebKit dentro del job de E2E sin un check obligatorio nuevo"
scenario: "Duración publicada y dentro del límite"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005", "NFR-MAINT-007"]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: automated
automated_tests:
  - tests/e2e/src/config.test.ts
  - tests/e2e/src/duration-summary.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["ci", "e2e", "webkit"]
error_code: null
preconditions:
  - "proyecto webkit en tests/e2e/playwright.config.ts"
  - "job e2e de .github/workflows/pr.yml con WebKit instalado"
input: {}
steps:
  - "corre el job e2e de un pull request"
  - "se consulta la protección de la rama main"
expected_result:
  - "el resumen del job muestra la duración de chromium y la de webkit"
  - "el job termina dentro de sus 40 minutos"
  - "la lista de checks obligatorios de main es la misma que antes del change"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-PIPELINE-044 — WebKit corre dentro del job e2e, sin check obligatorio nuevo y con la duración publicada

## Intención

D509 pidió WebKit dentro del job e2e existente; cambiar los checks obligatorios requiere al owner.

## Escenario

```gherkin
Dado proyecto webkit en tests/e2e/playwright.config.ts
  Y job e2e de .github/workflows/pr.yml con WebKit instalado
Cuando corre el job e2e de un pull request
  Y se consulta la protección de la rama main
Entonces el resumen del job muestra la duración de chromium y la de webkit
  Y el job termina dentro de sus 40 minutos
  Y la lista de checks obligatorios de main es la misma que antes del change
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
